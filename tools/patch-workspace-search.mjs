#!/usr/bin/env node
/**
 * 把「全历史全文命中」内联进工作区侧栏放大镜搜索框的结果区。
 *
 * 目标文件：
 *   resources/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js
 *
 * 用法：
 *   node tools/patch-workspace-search.mjs            打补丁（幂等）
 *   node tools/patch-workspace-search.mjs --revert   按标记剥离注入内容
 *   node tools/patch-workspace-search.mjs --dry-run  只校验锚点，不写文件
 *   node tools/patch-workspace-search.mjs --check    只看当前状态
 *
 * 设计：纯文本插入。两块注入各自带标记（/* HSR:BEGIN *\/ … /* HSR:END *\/、
 * /* HSR:BEGIN-RENDER *\/ … /* HSR:END-RENDER *\/），--revert 靠标记剥离。
 * 写文件前先备份到 D:\AIBOX\_TEMP，再用 tmp + rename 原子替换；补丁结果在写
 * 盘之前先过 node --check，语法不通直接退出 1，绝不半途写坏文件。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const TARGET =
	process.env.HSR_CLIENT_JS ||
	"D:\\AIBOX\\deepseekharness\\resources\\app\\dsh\\node_modules\\@deepseek-ai\\dsh-client-ui-workspace\\lib\\client.js";
const BACKUP_DIR = process.env.HSR_BACKUP_DIR || "D:\\AIBOX\\_TEMP";

const MARK_FN_BEGIN = "/* HSR:BEGIN */";
const MARK_FN_END = "/* HSR:END */";
const MARK_RENDER_BEGIN = "/* HSR:BEGIN-RENDER */";
const MARK_RENDER_END = "/* HSR:END-RENDER */";
const MOUNT_CALL = "(0, react_jsx_runtime.jsx)(HistoryHits, { query, open, t })";

const T = (n) => "\t".repeat(n);

// ---------------------------------------------------------------- 锚点
const FN_ANCHOR = "\t\t/** Flat search body: local metadata matches plus the current Host result page. */";
const RENDER_ANCHOR_RE =
	/results\.hasMore && \(0, react_jsx_runtime\.jsx\)\("div", \{\r?\n\t+className: WorkspaceBrowser_module_css_default\.searchStatus,\r?\n\t+children: t\("search\.hasMore", \{ n: resultLimit \}\)\r?\n\t+\}\)\r?\n\t+\]/;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------- 注入内容
function historyHitsLines() {
	const L = [];
	const a = (n, s) => L.push(T(n) + s);

	a(2, MARK_FN_BEGIN);
	a(2, "/**");
	a(2, " * Cross-workspace full-text history hits, appended under the local title/content results.");
	a(2, " * Reads the Host route of the `dsh-history-search` plugin. A missing or failing");
	a(2, " * route degrades to one hint row, so a bad fetch never breaks the search panel.");
	a(2, " * @param props.query - normalized search query.");
	a(2, " * @param props.open - open a session by id (the browser's search-result opener).");
	a(2, " * @param props.t - Workspace-browser translation seat.");
	a(2, " * @returns the history section element, or null when there is nothing to show.");
	a(2, " */");
	a(2, "function HistoryHits({ query, open, t }) {");
	a(3, 'const route = "/dsh-history-search/api/search";');
	a(3, "const [state, setState] = (0, react.useState)({");
	a(4, 'phase: "idle",');
	a(4, "sessions: [],");
	a(4, "hitTotal: 0,");
	a(4, "error: null");
	a(3, "});");
	a(3, "const [reader, setReader] = (0, react.useState)(null);");
	a(3, "(0, react.useEffect)(() => {");
	a(4, 'const text = typeof query === "string" ? query.trim() : "";');
	a(4, 'if (text === "") {');
	a(5, "setState({");
	a(6, 'phase: "idle",');
	a(6, "sessions: [],");
	a(6, "hitTotal: 0,");
	a(6, "error: null");
	a(5, "});");
	a(5, "return;");
	a(4, "}");
	a(4, "const controller = new AbortController();");
	a(4, "let live = true;");
	a(4, "const timer = window.setTimeout(() => {");
	a(5, "if (!live) return;");
	a(5, "setState({");
	a(6, 'phase: "loading",');
	a(6, "sessions: [],");
	a(6, "hitTotal: 0,");
	a(6, "error: null");
	a(5, "});");
	a(5, 'fetch(route + "?q=" + encodeURIComponent(text) + "&limit=12&per=2", {');
	a(6, "signal: controller.signal,");
	a(6, 'headers: { accept: "application/json" }');
	a(5, "}).then((response) => {");
	a(6, 'if (!response.ok) throw new Error("HTTP " + response.status);');
	a(6, "return response.json();");
	a(5, "}).then((payload) => {");
	a(6, "if (!live) return;");
	a(6, "const sessions = Array.isArray(payload && payload.sessions) ? payload.sessions : [];");
	a(6, "setState({");
	a(7, 'phase: "ready",');
	a(7, "sessions,");
	a(7, "hitTotal: Number((payload && payload.hitTotal) || 0),");
	a(7, "error: null");
	a(6, "});");
	a(5, "}).catch((error) => {");
	a(6, 'if (!live || (error && error.name === "AbortError")) return;');
	a(6, "setState({");
	a(7, 'phase: "failed",');
	a(7, "sessions: [],");
	a(7, "hitTotal: 0,");
	a(7, "error: String((error && error.message) || error)");
	a(6, "});");
	a(5, "});");
	a(4, "}, 280);");
	a(4, "return () => {");
	a(5, "live = false;");
	a(5, "controller.abort();");
	a(5, "window.clearTimeout(timer);");
	a(4, "};");
	a(3, "}, [query]);");
	a(3, "try {");
	a(4, 'if (state.phase === "idle") return null;');
	a(4, "const hint = (label) =>");
	a(5, '(0, react_jsx_runtime.jsx)("div", {');
	a(6, 'style: { padding: "2px 8px 8px", fontSize: "12px", lineHeight: "17px", color: "var(--dsw-alias-label-caption)" },');
	a(6, "children: label");
	a(5, "});");
	a(4, 'const heading = (0, react_jsx_runtime.jsxs)("div", {');
	a(5, "style: {");
	a(6, 'display: "flex",');
	a(6, 'alignItems: "center",');
	a(6, 'gap: "6px",');
	a(6, 'padding: "10px 8px 2px",');
	a(6, 'marginTop: "4px",');
	a(6, 'borderTop: "0.5px solid var(--dsw-alias-border-l4)",');
	a(6, 'color: "var(--dsw-alias-label-tertiary)",');
	a(6, 'fontSize: "12px",');
	a(6, 'lineHeight: "17px"');
	a(5, "},");
	a(5, "children: [");
	a(6, '(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-secondary)" }, children: "全历史" }),');
	a(6, '(0, react_jsx_runtime.jsx)("span", { children: "跨全部工作区" }),');
	a(6, 'state.phase === "ready" && (0, react_jsx_runtime.jsx)("span", { style: { marginLeft: "auto" }, children: String(state.sessions.length) + " 会话 · " + String(state.hitTotal) + " 段命中" })');
	a(5, "]");
	a(4, "});");
	a(4, 'if (state.phase === "failed") return (0, react_jsx_runtime.jsxs)("div", {');
	a(5, '"data-hsr": "failed",');
	a(5, 'children: [heading, hint("全历史命中读取失败 · 已跳过")]');
	a(4, "});");
	a(4, 'if (state.phase === "loading") return (0, react_jsx_runtime.jsxs)("div", {');
	a(5, '"data-hsr": "loading",');
	a(5, 'children: [heading, hint("读取中…")]');
	a(4, "});");
	a(4, "const readTranscript = (id) => {");
	a(5, "setReader({ id, phase: \"loading\", records: [], total: 0, meta: void 0, error: null });");
	a(5, 'fetch("/dsh-history-search/api/session?id=" + encodeURIComponent(id) + "&limit=400", { headers: { accept: "application/json" } }).then((response) => {');
	a(6, 'if (!response.ok) throw new Error("HTTP " + String(response.status));');
	a(6, "return response.json();");
	a(5, "}).then((payload) => {");
	a(6, "setReader({ id, phase: \"ready\", records: Array.isArray(payload && payload.records) ? payload.records : [], total: Number((payload && payload.total) || 0), eventTotal: Number((payload && payload.eventTotal) || 0), meta: payload && payload.meta, error: null });");
	a(5, "}).catch((error) => {");
	a(6, 'setReader({ id, phase: "failed", records: [], total: 0, meta: void 0, error: String((error && error.message) || error) });');
	a(5, "});");
	a(4, "};");
	a(4, "const openSession = (id) => {");
	a(5, 'if (typeof open === "function") {');
	a(6, "try {");
	a(7, "const result = open(id);");
	a(7, 'if (result && typeof result.then === "function") {');
	a(8, "result.then(void 0, () => {");
	a(9, "readTranscript(id);");
	a(8, "});");
	a(8, "return;");
	a(7, "}");
	a(7, "return;");
	a(6, "} catch (error) {");
	a(7, "void error;");
	a(6, "}");
	a(5, "}");
	a(5, "readTranscript(id);");
	a(4, "};");
	a(4, "const rows = state.sessions.map((session, index) => {");
	a(5, "const hits = session && Array.isArray(session.hits) ? session.hits : [];");
	a(5, "const first = hits.length > 0 ? hits[0] : void 0;");
	a(5, "const snippet = first && first.snippet ? first.snippet : void 0;");
	a(5, 'const id = session && session.sessionId !== void 0 ? String(session.sessionId) : "hsr-" + String(index);');
	a(5, 'const name = session && session.title ? String(session.title) : typeof t === "function" ? t("session.untitled") : "(未命名会话)";');
	a(5, "const count = session && session.hitCount !== void 0 ? Number(session.hitCount) : hits.length;");
	a(5, "const trimmed = Boolean(session && session.truncated);");
	a(5, 'const titleRow = (0, react_jsx_runtime.jsxs)("div", {');
	a(6, 'style: { display: "flex", alignItems: "baseline", gap: "6px", minWidth: "0" },');
	a(6, "children: [");
	a(7, '(0, react_jsx_runtime.jsx)("span", {');
	a(8, 'style: { flex: "0 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px", lineHeight: "18px", color: "var(--dsw-alias-label-primary)" },');
	a(8, "children: name");
	a(7, "}),");
	a(7, '(0, react_jsx_runtime.jsx)("span", {');
	a(8, 'style: { flex: "none", marginLeft: "auto", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)" },');
	a(8, 'children: (trimmed ? "≥" : "") + String(count) + " 条"');
	a(7, "}),");
	a(7, '(0, react_jsx_runtime.jsx)("span", {');
	a(8, 'style: { flex: "none", cursor: "pointer", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-link)" },');
	a(8, "onClick: (event) => {");
	a(9, "event.stopPropagation();");
	a(9, "readTranscript(id);");
	a(8, "},");
	a(8, 'children: "原文"');
	a(7, "})");
	a(6, "]");
	a(5, "});");
	a(5, 'const snippetRow = (0, react_jsx_runtime.jsxs)("div", {');
	a(6, 'style: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", lineHeight: "17px", color: "var(--dsw-alias-label-caption)" },');
	a(6, "children: [");
	a(7, '(0, react_jsx_runtime.jsx)("span", { children: snippet ? String(snippet.pre || "") : "(标题命中)" }),');
	a(7, 'snippet && (0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-link)", fontWeight: 600 }, children: String(snippet.match || "") }),');
	a(7, 'snippet && (0, react_jsx_runtime.jsx)("span", { children: String(snippet.post || "") })');
	a(6, "]");
	a(5, "});");
	a(5, 'return (0, react_jsx_runtime.jsx)("div", {');
	a(6, 'role: "button",');
	a(6, "tabIndex: 0,");
	a(6, '"data-hsr-session": id,');
	a(6, 'style: { display: "flex", flexDirection: "column", alignItems: "stretch", boxSizing: "border-box", width: "100%", padding: "4px 8px", borderRadius: "8px", cursor: "pointer", color: "var(--dsw-alias-label-primary)", background: "transparent" },');
	a(6, "onClick: () => openSession(id),");
	a(6, "onKeyDown: (event) => {");
	a(7, 'if (event.key === "Enter" || event.key === " ") {');
	a(8, "event.preventDefault();");
	a(8, "openSession(id);");
	a(7, "}");
	a(6, "},");
	a(6, "onMouseEnter: (event) => {");
	a(7, 'event.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover)";');
	a(6, "},");
	a(6, "onMouseLeave: (event) => {");
	a(7, 'event.currentTarget.style.background = "transparent";');
	a(6, "},");
	a(6, "children: [titleRow, snippetRow]");
	a(5, "}, id);");
	a(4, "});");
	a(4, "const readerEl = reader === null ? null : (0, react_jsx_runtime.jsxs)(\"div\", {");
	a(5, '"data-hsr": "reader",');
	a(5, 'style: { margin: "4px 8px 8px", padding: "6px 8px", borderRadius: "8px", border: "0.5px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-interactive-bg-hover)" },');
	a(5, "children: [");
	a(6, '(0, react_jsx_runtime.jsxs)("div", {');
	a(7, 'style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" },');
	a(7, "children: [");
	a(8, '(0, react_jsx_runtime.jsx)("span", {');
	a(9, 'style: { flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)" },');
	a(9, "children: (reader.meta && reader.meta.title) || reader.id");
	a(8, "}),");
	a(8, '(0, react_jsx_runtime.jsx)("span", {');
	a(9, 'style: { flex: "none", cursor: "pointer", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-link)" },');
	a(9, "onClick: () => setReader(null),");
	a(9, 'children: "关闭原文"');
	a(8, "})");
	a(7, "]");
	a(6, "}),");
	a(6, 'reader.phase === "loading" ? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "17px", color: "var(--dsw-alias-label-secondary)" }, children: "原文读取中…" }) : null,');
	a(6, 'reader.phase === "failed" ? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "17px", color: "var(--dsw-alias-label-secondary)" }, children: "原文读取失败：" + String(reader.error || "") }) : null,');
	a(6, '(0, react_jsx_runtime.jsxs)("div", {');
	a(7, 'style: { maxHeight: "320px", overflow: "auto", paddingRight: "4px" },');
	a(7, "children: [");
	a(8, '(reader.records || []).map((record, index) => (0, react_jsx_runtime.jsxs)("div", {');
	a(9, 'style: { marginBottom: "6px", fontSize: "12px", lineHeight: "18px", whiteSpace: "pre-wrap", wordBreak: "break-word" },');
	a(9, "children: [");
	a(10, '(0, react_jsx_runtime.jsx)("span", { style: { marginRight: "4px", fontSize: "10px", color: "var(--dsw-alias-label-caption)" }, children: String((record && record.role) || "") }),');
	a(10, '(0, react_jsx_runtime.jsx)("span", { children: String((record && record.text) || "") })');
	a(9, "],");
	a(8, '}, "hsr-rec-" + String(index))),');
	a(8, '(0, react_jsx_runtime.jsx)("div", { style: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)" }, children: "共 " + String(reader.total || (reader.records || []).length) + " 条对话记录" + (reader.eventTotal ? "（原始事件 " + String(reader.eventTotal) + " 条）" : "") + "，这里展示前 " + String((reader.records || []).length) + " 条" })');
	a(7, "]");
	a(6, "})");
	a(5, "]");
	a(4, "});");
	a(4, 'return (0, react_jsx_runtime.jsxs)("div", {');
	a(5, '"data-hsr": "ready",');
	a(5, 'children: (state.sessions.length === 0 ? [heading, hint("无命中")] : [heading].concat(rows)).concat(readerEl === null ? [] : [readerEl])');
	a(4, "});");
	a(3, "} catch (error) {");
	a(4, 'return (0, react_jsx_runtime.jsx)("div", {');
	a(5, '"data-hsr": "broken",');
	a(5, 'style: { padding: "6px 8px 8px", fontSize: "12px", lineHeight: "17px", color: "var(--dsw-alias-label-caption)" },');
	a(5, 'children: "全历史命中渲染失败"');
	a(4, "});");
	a(3, "}");
	a(2, "}");
	a(2, MARK_FN_END);
	return L;
}

// ---------------------------------------------------------------- 工具
function die(message) {
	process.stderr.write("error: " + message + "\n");
	process.exit(1);
}

function hashText(text) {
	return crypto.createHash("sha256").update(text).digest("hex");
}

function hashFile(file) {
	return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function stamp() {
	const d = new Date();
	const p = (n, w) => String(n).padStart(w || 2, "0");
	return (
		String(d.getFullYear()) +
		p(d.getMonth() + 1) +
		p(d.getDate()) +
		"-" +
		p(d.getHours()) +
		p(d.getMinutes()) +
		p(d.getSeconds()) +
		"-" +
		p(d.getMilliseconds(), 3)
	);
}

function backup(file, tag) {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const dest = path.join(BACKUP_DIR, path.basename(file) + ".bak-" + tag + "-" + stamp());
	fs.copyFileSync(file, dest);
	return dest;
}

function atomicWrite(file, text) {
	const tmp = file + ".hsr-tmp";
	fs.writeFileSync(tmp, text, "utf8");
	let lastError = null;
	for (let attempt = 0; attempt < 8; attempt += 1) {
		try {
			fs.renameSync(tmp, file);
			return;
		} catch (error) {
			lastError = error;
			const until = Date.now() + 80;
			while (Date.now() < until) {
				/* 句柄可能被杀软或 IDE 短暂占用 */
			}
		}
	}
	fs.writeFileSync(file, text, "utf8");
	fs.rmSync(tmp, { force: true });
	if (lastError) process.stderr.write("warn: rename 退化为原地写入 (" + lastError.code + ")\n");
}

function count(text, needle) {
	let n = 0;
	let at = text.indexOf(needle);
	while (at !== -1) {
		n += 1;
		at = text.indexOf(needle, at + needle.length);
	}
	return n;
}

function parenBalance(text) {
	let n = 0;
	let at = text.indexOf("(");
	while (at !== -1) {
		n += 1;
		at = text.indexOf("(", at + 1);
	}
	at = text.indexOf(")");
	while (at !== -1) {
		n -= 1;
		at = text.indexOf(")", at + 1);
	}
	return n;
}

function detectEol(text) {
	return text.indexOf("\r\n") !== -1 ? "\r\n" : "\n";
}

function syntaxOk(text, label) {
	const tmp = path.join(os.tmpdir(), "hsr-syntax-" + stamp() + ".js");
	fs.writeFileSync(tmp, text, "utf8");
	const result = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
	fs.rmSync(tmp, { force: true });
	if (result.status !== 0) {
		process.stderr.write((result.stderr || "") + "\n");
		die(label + ": node --check 失败，未写盘");
	}
	return true;
}

// ---------------------------------------------------------------- 打补丁
function applyPatch(text) {
	const eol = detectEol(text);

	if (text.indexOf(MARK_FN_BEGIN) !== -1 || text.indexOf(MARK_RENDER_BEGIN) !== -1) {
		return { changed: false, reason: "already patched" };
	}
	if (text.indexOf("function HistoryHits(") !== -1) {
		die("HistoryHits 已存在但没有标记，拒绝猜测状态");
	}

	// 1) 组件：插在 SearchResults 的文档注释之前
	if (count(text, FN_ANCHOR) !== 1) die("组件锚点计数 = " + count(text, FN_ANCHOR) + "（期望 1）");
	const block = historyHitsLines().join(eol) + eol;
	text = text.replace(FN_ANCHOR, () => block + FN_ANCHOR);

	// 2) 调用元素：追加到 SearchResults 的 children 数组末尾
	const m = RENDER_ANCHOR_RE.exec(text);
	if (!m) die("调用锚点未找到");
	if (RENDER_ANCHOR_RE.test(text.slice(m.index + 1))) die("调用锚点不唯一");
	const matched = m[0];
	if (!matched.startsWith("results.hasMore")) die("调用锚点漂移");
	const lastBracket = matched.lastIndexOf("]");
	const pre = matched.slice(0, lastBracket);
	const indBracket = (/([\t]*)$/.exec(pre) || ["", "\t\t\t\t\t"])[1];
	const rowInd = indBracket + "\t";
	const core = pre.slice(0, pre.length - indBracket.length);
	const coreTrim = core.endsWith(eol) ? core.slice(0, core.length - eol.length) : core;
	const replacement =
		coreTrim +
		"," +
		eol +
		rowInd +
		MARK_RENDER_BEGIN +
		eol +
		rowInd +
		MOUNT_CALL +
		eol +
		rowInd +
		MARK_RENDER_END +
		eol +
		indBracket +
		"]";
	text = text.slice(0, m.index) + replacement + text.slice(m.index + matched.length);

	return { changed: true, text, eol };
}

function selfCheck(text, baseline) {
	const expect = [
		[count(text, MARK_FN_BEGIN), 1, "HSR:BEGIN"],
		[count(text, MARK_FN_END), 1, "HSR:END"],
		[count(text, MARK_RENDER_BEGIN), 1, "HSR:BEGIN-RENDER"],
		[count(text, MARK_RENDER_END), 1, "HSR:END-RENDER"],
		[count(text, "function HistoryHits("), 1, "HistoryHits 声明"],
		[count(text, MOUNT_CALL), 1, "HistoryHits 调用"],
		[count(text, "function SearchResults("), 1, "SearchResults 声明"],
		[count(text, "function deriveSearchResults("), 1, "deriveSearchResults 声明"],
		[count(text, "function SearchResultItem("), 1, "SearchResultItem 声明"]
	];
	for (const entry of expect) {
		if (entry[0] !== entry[1]) die("自检失败：" + entry[2] + " 计数 = " + entry[0] + "（期望 " + entry[1] + "）");
	}
	if (parenBalance(text) !== parenBalance(baseline)) die("自检失败：括号平衡漂移");
	return true;
}

// ---------------------------------------------------------------- 还原
function applyRevert(text) {
	if (text.indexOf(MARK_FN_BEGIN) === -1 && text.indexOf(MARK_RENDER_BEGIN) === -1) {
		return { changed: false, reason: "not patched" };
	}
	const before = text.length;
	const fnRe = new RegExp("\\t*" + escRe(MARK_FN_BEGIN) + "[\\s\\S]*?" + escRe(MARK_FN_END) + "\\r?\\n", "g");
	const renderRe = new RegExp(",\\s*" + escRe(MARK_RENDER_BEGIN) + "[\\s\\S]*?" + escRe(MARK_RENDER_END), "g");
	text = text.replace(fnRe, "");
	text = text.replace(renderRe, "");
	if (text.indexOf("HSR:") !== -1) die("还原后仍残留标记");
	if (count(text, "function HistoryHits(") !== 0) die("还原后仍残留 HistoryHits");
	if (count(text, "function SearchResults(") !== 1) die("还原破坏了 SearchResults");
	if (count(text, "function deriveSearchResults(") !== 1) die("还原破坏了 deriveSearchResults");
	return { changed: true, text, removed: before - text.length };
}

function statusOf(text) {
	return {
		component: text.indexOf(MARK_FN_BEGIN) !== -1,
		mount: text.indexOf(MARK_RENDER_BEGIN) !== -1,
		sha: hashText(text),
		bytes: text.length
	};
}

// ---------------------------------------------------------------- main
function main() {
	const argv = process.argv.slice(2);
	const revert = argv.includes("--revert");
	const dryRun = argv.includes("--dry-run");
	const check = argv.includes("--check");

	if (!fs.existsSync(TARGET)) die("目标不存在：" + TARGET);
	const original = fs.readFileSync(TARGET, "utf8");
	const srcHash = hashText(original);

	if (check) {
		const st = statusOf(original);
		process.stdout.write("target: " + TARGET + "\n");
		process.stdout.write("component block: " + (st.component ? "inserted" : "absent") + "\n");
		process.stdout.write("mount block: " + (st.mount ? "inserted" : "absent") + "\n");
		process.stdout.write("sha256: " + st.sha + "  bytes: " + st.bytes + "\n");
		process.exit(st.component && st.mount ? 0 : 1);
	}

	const result = revert ? applyRevert(original) : applyPatch(original);
	if (!result.changed) {
		process.stdout.write(result.reason + " -> no write\n");
		process.stdout.write("sha256: " + srcHash + "\n");
		process.exit(0);
	}
	if (!revert) selfCheck(result.text, original);
	syntaxOk(result.text, revert ? "revert" : "patch");

	if (dryRun) {
		process.stdout.write("dry-run ok: 将写入 " + result.text.length + " 字节（原 " + original.length + "）\n");
		process.exit(0);
	}

	const bak = backup(TARGET, revert ? "pre-revert" : "pre-patch");
	atomicWrite(TARGET, result.text);
	const newHash = hashFile(TARGET);

	process.stdout.write((revert ? "reverted" : "patched") + ": " + TARGET + "\n");
	process.stdout.write("backup: " + bak + "\n");
	process.stdout.write("bytes: " + original.length + " -> " + result.text.length + " (" + (result.text.length - original.length >= 0 ? "+" : "") + (result.text.length - original.length) + ")\n");
	process.stdout.write("sha256: " + srcHash + " -> " + newHash + "\n");
}

main();
