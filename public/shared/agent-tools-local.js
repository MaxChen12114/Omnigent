/**
 * agent-tools-local.js — 浏览器/桌面端本地能力工具集（agent-kernel 工具注册表）
 * 与沙盒验证过的参考实现 (harness: agent-tools-local.mjs) 同构。
 * 桌面端(Tauri)：绑定 invoke 调用原生命令；纯网页：仅暴露 fetch_url（走 worker 代理）。
 *
 * P1（4.69，无需新 exe，复用 4.68 既有命令）：
 *   fetch_url -> http_request | read_file -> read_text_file | write_file -> export_text_file(导出) | open_path -> open_external
 * P2（折进同一 4.69.0 exe，需新增 Rust 命令）：
 *   write_file -> 原生静默落盘 | run_command -> 命令白名单
 */
import { createToolRegistry } from "./agent-kernel.js"

function tauriInvoke() {
	const t = typeof window !== "undefined" && window.__TAURI__
	return t && t.core && typeof t.core.invoke === "function" ? t.core.invoke.bind(t.core) : null
}
export function isDesktop() {
	return !!tauriInvoke()
}

export function buildLocalToolRegistry(opts = {}) {
	const {
		registry = createToolRegistry(),
		fetchProxyEndpoint = "/api/fetch", // 纯网页用 worker 代理抓取，绕过 CORS
		workdir = "",                       // P2 原生落盘的工作目录闸门
		commandWhitelist = ["node", "ls", "cat", "echo", "head", "wc"],
		nativeWrite = false,                // P2 开关：原生 write_file 是否可用
		nativeCommand = false,              // P2 开关：原生 run_command 是否可用
	} = opts
	const invoke = tauriInvoke()

	// fetch_url —— 桌面端走 Rust http_request（无 CORS），网页走 worker 代理
	registry.define({
		name: "fetch_url",
		description: "抓取一个网页/接口的文本内容。",
		parameters: { type: "object", properties: { url: { type: "string" }, max_chars: { type: "integer" }, timeout_ms: { type: "integer" } }, required: ["url"], additionalProperties: false },
		// 4.79 #6: 两条路径(原生 http_request / 网页 fetch 代理)都加超时,防止单次抓取挂死拖垄整个 agent 循环
		async run({ url, max_chars = 4000, timeout_ms = 20000 }) {
			let text, status
			if (invoke) {
				const r = await withTimeout(invoke("http_request", { url, method: "GET" }), timeout_ms, "抓取超时")
				text = typeof r === "string" ? r : (r && (r.body ?? r.text)) || ""
				status = (r && r.status) || 200
			} else {
				const ctrl = new AbortController()
				const timer = setTimeout(() => ctrl.abort(), timeout_ms)
				try {
					const r = await fetch(fetchProxyEndpoint + "?url=" + encodeURIComponent(url), { signal: ctrl.signal })
					text = await r.text()
					status = r.status
				} finally { clearTimeout(timer) }
			}
			return { ok: true, status, url, text: String(text).slice(0, max_chars), bytes: String(text).length }
		},
	})

	// read_file —— 复用 4.68 既有 read_text_file
	if (invoke)
		registry.define({
			name: "read_file",
			description: "读取本地文本文件内容。",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
			async run({ path }) {
				const text = await invoke("read_text_file", { path })
				return { ok: true, path, text: String(text || ""), bytes: String(text || "").length }
			},
		})

	// write_file —— P1: 导出对话(export_text_file 弹保存框)；P2: 原生静默落盘(需 workdir 闸门)
	if (invoke)
		registry.define({
			name: "write_file",
			description: nativeWrite ? "把内容写入工作目录下的文件（原生）。" : "把内容导出为文件（弹出保存对话框）。",
			destructive: true,
			parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["content"], additionalProperties: false },
			async run({ path = "agent-output.txt", content }) {
				if (nativeWrite) {
					const safe = resolveInWorkdir(workdir, path)
					await invoke("write_file", { path: safe, contents: content })
					return { ok: true, path: safe, bytes: String(content).length, mode: "native" }
				}
				// 4.79 #3: 原生命令 export_text_file 的参数名是 { suggestedName, content }(与 dev.js / tools.js 一致),
				// 旧代码传 { defaultName, contents } 参数对不上 → 导出静默失败
				await invoke("export_text_file", { suggestedName: basename(path), content: content })
				return { ok: true, path: basename(path), bytes: String(content).length, mode: "export-dialog" }
			},
		})

	// open_path —— open_external（打开文件/URL）
	if (invoke)
		registry.define({
			name: "open_path",
			description: "用系统默认程序打开一个文件路径或 URL。",
			parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"], additionalProperties: false },
			async run({ target }) {
				await invoke("open_external", { url: target })
				return { ok: true, target }
			},
		})

	// run_command —— P2 原生，命令白名单
	if (invoke && nativeCommand)
		registry.define({
			name: "run_command",
			description: "在白名单内执行一条本地命令。",
			destructive: true,
			parameters: { type: "object", properties: { cmd: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["cmd"], additionalProperties: false },
			async run({ cmd, args = [] }) {
				if (!commandWhitelist.includes(cmd)) return { ok: false, error: `命令不在白名单: ${cmd}` }
				const out = await invoke("run_command", { cmd, args, cwd: workdir })
				return { ok: true, cmd, args, output: typeof out === "string" ? out : (out && out.stdout) || "" }
			},
		})

	return registry
}

// 4.79 #6: 给可能挂起的异步操作加超时(原生 http_request 无 CORS 但也无超时;超时则 reject 让 loop 能继续)
function withTimeout(promise, ms, label) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error((label || "操作") + "：超过 " + ms + "ms 未返回")), ms)),
	])
}

function basename(p) {
	return String(p).split(/[\\/]/).pop() || "file.txt"
}
function resolveInWorkdir(workdir, p) {
	const name = String(p)
	if (!workdir) return basename(name)
	if (name.includes("..")) throw new Error("路径越界：不允许 ..")
	if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
		if (!name.startsWith(workdir)) throw new Error("路径越界：必须在工作目录内")
		return name
	}
	return workdir.replace(/[\\/]$/, "") + "/" + name
}