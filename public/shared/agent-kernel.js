/**
 * agent-kernel.js — Omnigent 网页内核（魂）· 工具调用内核 SDK
 *
 * 定位：传输无关 / 模式无关的 agent 内核。只负责
 *   1) 工具注册表（name -> { schema, run, 危险标记 }）
 *   2) agent while 循环（模型 -> tool_calls -> 执行 -> 回灌 -> 重复）
 * 不负责：调模型（由宿主注入 callModel）、本地能力（壳 / Tauri）、UI。
 *
 * 对标 Claude Code 精髓：loop 本身很朴素，价值在它周围的注册表 / 权限 / 回灌。
 * 参考文档：Notion「Claude Code 源码精髓拆解 · 内核落地参考」。
 *
 * 用法见文件底部 DEMO。可在 Cloudflare Worker 与浏览器中运行（无 DOM 依赖）。
 */

/** 创建一个工具注册表 */
export function createToolRegistry() {
	const tools = new Map()

	/**
	 * 注册一个工具
	 * @param {object} def
	 * @param {string} def.name              工具名（模型据此调用）
	 * @param {string} def.description       给模型看的说明，越准越好
	 * @param {object} def.parameters        JSON Schema（OpenAI function 参数格式）
	 * @param {(args:object, ctx:object)=>Promise<any>} def.run  实际执行函数
	 * @param {boolean} [def.destructive]    是否破坏性（执行前过权限闸门）
	 */
	function define(def) {
		if (!def || !def.name || typeof def.run !== "function") {
			throw new Error("[agent-kernel] define 需要 { name, run }")
		}
		tools.set(def.name, {
			name: def.name,
			description: def.description || "",
			parameters: def.parameters || { type: "object", properties: {} },
			run: def.run,
			destructive: !!def.destructive,
		})
		return registry
	}

	function get(name) {
		return tools.get(name)
	}

	function list() {
		return [...tools.values()]
	}

	/** 导出成 OpenAI / DeepSeek 兼容的 tools 数组 */
	function toSchemas() {
		return list().map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			},
		}))
	}

	const registry = { define, get, list, toSchemas }
	return registry
}

/** 当前在跑的 agent 工作 loop 计数(供 autopilot 互斥锁探测,决策 L) */
let _activeLoops = 0
/** 是否有 agent 工作 loop 正在运行(autopilot.whoElseDriving 用) */
export function isRunning() {
	return _activeLoops > 0
}

/**
 * 运行 agent 主循环。
 *
 * @param {object} opts
 * @param {Array}  opts.messages          OpenAI 风格消息数组（会被原地追加）
 * @param {object} opts.registry         createToolRegistry() 的返回值
 * @param {(messages:Array, schemas:Array)=>Promise<object>} opts.callModel
 *        宿主注入的模型调用。需返回 { content?:string, tool_calls?:Array }
 *        （DeepSeek / OpenAI 的 choices[0].message 即是此形状）
 * @param {number}  [opts.maxIterations=8]   最大轮数（防失控 / 防烧钱）
 * @param {object}  [opts.context={}]        透传给每个 tool.run 的上下文
 * @param {(toolName:string,args:object)=>Promise<boolean>} [opts.ensurePermission]
 *        破坏性工具执行前的权限闸门；返回 false 则拒绝执行
 * @param {(event:object)=>void} [opts.onEvent]  观测钩子（trace / UI 用）
 * @returns {Promise<{finalText:string, messages:Array, iterations:number, stopReason:string}>}
 */
export async function runAgentLoop(opts) {
	const {
		messages,
		registry,
		callModel,
		maxIterations = 8,
		context = {},
		ensurePermission,
		onEvent = () => {},
	} = opts || {}

	if (!Array.isArray(messages)) throw new Error("[agent-kernel] messages 必须是数组")
	if (!registry || typeof registry.toSchemas !== "function")
		throw new Error("[agent-kernel] 需要合法 registry")
	if (typeof callModel !== "function")
		throw new Error("[agent-kernel] 需要注入 callModel")

	const schemas = registry.toSchemas()

	_activeLoops++
	try {
	for (let i = 0; i < maxIterations; i++) {
		onEvent({ type: "model_call", iteration: i })
		let res
		try {
			res = (await callModel(messages, schemas)) || {}
		} catch (e) {
			// 模型调用失败（上下文超限 / 上游 4xx-5xx / 超时）——不再静默抛穿掀翻整个 loop。
			// 发 model_error 事件 + 带着已有进度优雅收尾，让 UI 能看到真实原因而不是“卡在第 N 轮”。
			const errMsg = String(e && e.message ? e.message : e)
			onEvent({ type: "model_error", iteration: i, error: errMsg })
			const finalText = `（第 ${i + 1} 轮模型调用失败，已中止：${errMsg}）`
			messages.push({ role: "assistant", content: finalText })
			return { finalText, messages, iterations: i + 1, stopReason: "model_error" }
		}
		const toolCalls = res.tool_calls || []

		// 没有工具调用 = 模型觉得说完了 -> 收尾
		if (toolCalls.length === 0) {
			const finalText = res.content || ""
			messages.push({ role: "assistant", content: finalText })
			onEvent({ type: "final", iteration: i, text: finalText })
			return { finalText, messages, iterations: i + 1, stopReason: "stop" }
		}

		// 先把模型这条 assistant（含 tool_calls）记进上下文
		messages.push({ role: "assistant", content: res.content || "", tool_calls: toolCalls })

		// 逐个执行工具，结果（含报错）回灌
		for (const call of toolCalls) {
			const fn = call.function || {}
			const name = fn.name
			let args = {}
			try {
				args = fn.arguments ? JSON.parse(fn.arguments) : {}
			} catch (e) {
				pushToolResult(messages, call, { error: `参数 JSON 解析失败: ${e.message}` })
				onEvent({ type: "tool_error", name, error: "bad_json" })
				continue
			}

			const tool = registry.get(name)
			if (!tool) {
				pushToolResult(messages, call, { error: `未知工具: ${name}` })
				onEvent({ type: "tool_error", name, error: "unknown_tool" })
				continue
			}

			// 权限闸门：破坏性操作执行前确认
			if (tool.destructive && typeof ensurePermission === "function") {
				const ok = await ensurePermission(name, args)
				if (!ok) {
					pushToolResult(messages, call, { error: "用户拒绝了该操作" })
					onEvent({ type: "tool_denied", name })
					continue
				}
			}

			try {
				onEvent({ type: "tool_run", name, args })
				const result = await tool.run(args, context)
				pushToolResult(messages, call, result)
				onEvent({ type: "tool_done", name })
			} catch (e) {
				// 报错也回灌，让模型下一轮自己读错误再改（这正是 loop 的魔法）
				pushToolResult(messages, call, { error: String(e && e.message ? e.message : e) })
				onEvent({ type: "tool_error", name, error: "throw" })
			}
		}
	}

	// 触顶：是否再给模型一次收尾机会由宿主决定。
	// 4.79 #5：旧代码返回 finalText:"" 且不入栈 → UI 只看到空白；此处与 model_error 一致，给出可见收尾文案并入栈。
	onEvent({ type: "max_iterations" })
	const finalText = `（已达到最大工具调用轮数 ${maxIterations} 轮，已自动停止。如果任务尚未完成，可缩小范围或分步重试。）`
	messages.push({ role: "assistant", content: finalText })
	return { finalText, messages, iterations: maxIterations, stopReason: "max_iterations" }
	} finally {
		_activeLoops--
	}
}

/** 单条工具结果回灌上限（字符）：防止大网页/搜索结果整段回灌撑爆上下文，导致后续轮次 400/超时 */
const MAX_TOOL_RESULT_CHARS = 8000

/** 把一次工具结果按 OpenAI 格式塞回消息流 */
function pushToolResult(messages, call, result) {
	let content = typeof result === "string" ? result : JSON.stringify(result)
	if (content && content.length > MAX_TOOL_RESULT_CHARS) {
		const omitted = content.length - MAX_TOOL_RESULT_CHARS
		content =
			content.slice(0, MAX_TOOL_RESULT_CHARS) +
			`\n…[结果过长已截断，省略 ${omitted} 字。如需完整内容请缩小范围或分页/分段获取]`
	}
	messages.push({
		role: "tool",
		tool_call_id: call.id,
		content,
	})
}

// 兼容非模块环境（浏览器 <script> 直接引入）：挂到全局
if (typeof globalThis !== "undefined") {
	globalThis.AgentKernel = { createToolRegistry, runAgentLoop, isRunning }
}

/* ───────── DEMO（伪代码，勿在生产直接打开） ─────────
import { createToolRegistry, runAgentLoop } from "./agent-kernel.js"

const registry = createToolRegistry()

// 例：把现有「发图」内联信号升级成工具（生产里直接用 tools.js 的 OmnigentTools.buildRegistry）
registry.define({
	name: "generate_image",
	description: "根据提示词生成一张配图，在合适的剧情节点调用",
	parameters: {
		type: "object",
		properties: { prompt: { type: "string", description: "绘图提示词" } },
		required: ["prompt"],
	},
	destructive: false,
	run: async ({ prompt }, ctx) => {
		const url = await ctx.imageBackend(prompt)   // 由宿主注入真正的生图后端
		return { image_url: url }
	},
})

// callModel：由 worker.js 注入，内部 fetch DeepSeek（OpenAI 兼容）
const callModel = async (messages, tools) => {
	const r = await fetch(DEEPSEEK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
		body: JSON.stringify({ model: "deepseek-chat", messages, tools, tool_choice: "auto" }),
	})
	const data = await r.json()
	return data.choices[0].message   // { content, tool_calls }
}

const messages = [
	{ role: "system", content: SYSTEM_PROMPT },   // 解限 base 作稳定前缀，勿改
	{ role: "user", content: userInput },
]
const { finalText } = await runAgentLoop({
	messages, registry, callModel,
	context: { imageBackend: genImage },
	ensurePermission: async (name) => confirm(`允许执行 ${name}?`),
})
───────────────────────────── */