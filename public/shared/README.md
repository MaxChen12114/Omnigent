# `public/shared/` · Omnigent 浏览器 Agent 内核（魂）

对标 Claude Code 的内核层：把原本散落在文本里的内联信号（`[[发图:场景]]` / `[好感+N]` / 道具指令）升级为正规 **function calling + agent 循环**。本目录是与「壳」（形态层）解耦的独立 SDK，默认不改变现有单轮流式链路。

## 文件

| 文件 | 导出 | 加载方式 |
| --- | --- | --- |
| `agent-kernel.js` | `globalThis.AgentKernel = { createToolRegistry, runAgentLoop }` | **`<script type="module">`**（用了 ES `export`，经典脚本会抛 SyntaxError，全局永不挂载） |
| `tools.js` | `globalThis.OmnigentTools = { defineTools, buildRegistry }` | 经典 `<script>`（IIFE，顺序在 agent-kernel 之后即可，运行时才引用 AgentKernel） |

## 工具注册表（createToolRegistry）

```js
const reg = AgentKernel.createToolRegistry()
reg.define({
  name: "send_image",
  description: "...",
  schema: { type: "object", properties: { /* ... */ } },
  run: async (args, ctx) => { /* ... */ },   // ⚠️ 回调键是 run，不是 execute
})
// reg.get(name) / reg.list() / reg.toSchemas()
```

- 回调签名 **`run(args, ctx)`**。早期用 `execute` 会在 `define` 时抛 `define 需要 { name, run }`。

## Agent 循环（runAgentLoop）

```js
const result = await AgentKernel.runAgentLoop({
  messages,                                        // [{ role, content }, ...]
  registry,                                        // createToolRegistry / buildRegistry 产物
  callModel: async (messages, schemas) => { /* ... */ }, // ⚠️ 位置传参
  maxIterations: 8,                                // 默认 8
  context: {},                                     // 透传给 tool.run 的 ctx
  ensurePermission: async (name, args) => true,    // 仅破坏性工具；省略 = 自动放行
  onEvent: (evt) => { /* ... */ },
})
// → { finalText, messages, iterations, stopReason }
```

- `callModel(messages, schemas)` **位置传参**；返回上游 `choices[0].message`（含 `tool_calls`）。
- 有 `tool_calls` → 查表执行 → 把 assistant(tool_calls) + 每个 `role:"tool"`(tool_call_id, content 字符串化) 回填 messages → 继续；无 tool_calls / 触达 maxIterations 即停。
- `onEvent` 事件：`model_call` / `final` / `tool_run` / `tool_done` / `tool_error` / `tool_denied` / `max_iterations`。
- `ensurePermission(name, args)` 位置传参，仅破坏性工具弹确认；v1 接线未传 = 自动放行。

## 内置工具（OmnigentTools.buildRegistry）

`buildRegistry({ onImage })` 一键注册 3 个工具，全部 `run` 绑定真实前端 API：

| 工具 | 绑定 | 参数 |
| --- | --- | --- |
| `send_image` | `window.__chatImage.sendPhoto` | `{ type: "selfie" | "scene", scene_prompt }`，`onImage` 回调负责渲染气泡 |
| `adjust_affinity` | `window.__character.adjustActiveAffection` | `{ delta, reason }` |
| `use_prop` | `window.__props.useProp` | `{ action: "list" | "use" | "remove", card_id }` |

## 接线（v1 · 灰度）

前端三处接线（已落 Notion 权威副本，随仓库同步）：

1. **worker.js** — `/api/chat` 在 `stream:false` 分支透传 `tools`/`tool_choice`，直接回传完整 JSON（`choices[].message`，含 `tool_calls`）；`stream` 省略/true 仍走原 SSE 流式。
2. **index.html** — 在 `app.js` 之后加载本目录两个 SDK（`agent-kernel.js` 必须 `type="module"`）。
3. **app.js** — 新增 `sendOneAgent(opts)`（buildRegistry → callModel 非流式 → runAgentLoop → 渲染 finalText）；`sendOne` 顶部 `if (isAgentModeOn()) return await sendOneAgent(opts)` 灰度守卫。

### dev 开关

```js
__dev.setAgentMode(true)   // 开 Agent 循环（LS cfw_agent_mode_v1 = "1"）
__dev.setAgentMode(false)  // 回退原流式 sendOne
__dev.isAgentMode()
```

`isAgentModeOn()` 还会校验 `window.AgentKernel` + `window.OmnigentTools` 已加载，缺失自动回退流式。**默认关 → 零回归。**

## 红线

- PROMPT_1/2/3 解限 base + META 基线层一字未改；工具调用走独立通道，不碰 base。
- 内核为独立模块，「魂」（内核层，本目录）与「壳」（Tauri 形态层 + 本地能力三件套）解耦推进。
