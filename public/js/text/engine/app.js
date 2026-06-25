// public/js/engine/app.js
(() => {
  const historyWrap = document.getElementById("history");
  const chatEl = document.getElementById("chat");
  const inputEl = document.getElementById("msg");
  const composerEl = document.getElementById("composer");
  const spacerEl = document.getElementById("bottom-spacer");
  const modelSel = document.getElementById("modelSel");
  const personaToggle = document.getElementById("personaToggle");
  const modeToggle = document.getElementById("modeToggle");       // 新增：免费/快速切换
  const settingsBtn = document.getElementById("settingsBtn");
  const sendBtn = document.getElementById("sendBtn");
  // 2026-06-08 修复:发送键本是 index.html 的小飞机 SVG,但下方 __resetSending 旧代码用 textContent="Send" 复位会把 SVG 抹成英文字。启动时捕获原始图标 HTML,复位时还原 SVG。
  const SEND_BTN_ICON_HTML = sendBtn ? sendBtn.innerHTML : "";
  const settingsMask = document.getElementById("settingsMask");
  const customPromptEl = document.getElementById("customPrompt");
  const savePromptBtn = document.getElementById("savePrompt");
  const clearPromptBtn = document.getElementById("clearPrompt");
  const historyKeepEl = document.getElementById("historyKeep");
  const clearHistoryBtn = document.getElementById("clearHistory");
  const promptKeepEl = document.getElementById("promptKeep");
  const costDisplayEl = document.getElementById("costDisplay");   // 新增：费用显示

  // ── 顶栏图标集中表(2026-06-07 UI 重构:emoji→线性 SVG,currentColor 随主题;换图标只改这一处) ──
  const ICONS = {
    modeFree: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg>',
    modeFast: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    personaBuiltin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h16v6.5a8 8 0 0 1-16 0z"/><path d="M9 8.5v.01M15 8.5v.01"/><path d="M9.2 12.6c.9.8 4.7.8 5.6 0"/></svg>',
    personaCustom: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 9.6-9.6a2 2 0 0 0-2.8-2.8L5.4 16z"/><path d="M13.5 6.3l4.2 4.2"/></svg>',
  };
  // setIcon(el, 图标名, 可选文字标签):带 label 时附 .btn-text(供 CSS 在手机端隐藏、只留图标)
  function setIcon(el, name, label) {
    if (!el) return;
    const svg = ICONS[name] || "";
    el.innerHTML = label ? svg + '<span class="btn-text">' + label + '</span>' : svg;
  }

  // ─── 模型列表（来自 /config.js 动态注入）───
  // 模型列表完全由 worker /config.js 注入；兜底为空数组，避免过时模型干扰
  const MODELS_FREE = window.APP_MODELS_FREE || [];
  const MODELS_FAST = window.APP_MODELS_FAST || [];
  const PRICING = window.DEEPSEEK_PRICING || {};

  const session = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalInEstimate = 0;
  let totalOutEstimate = 0;
  let isSending = false;
  // 4.64 多开会话:把"上一槽 key"提到 IIFE 作用域,供 switchConversation 与 character:changed 处理器共享,避免切会话后下次切角色把当前会话误存到旧槽
  let lastSlotKey = "";

  // ─── 并发/取消控制（修复重试/删除/刷新 与流式响应的冲突）───
  // sendGen：每起 send 递增；旧闭包只有 myGen === sendGen 才能写 session / DOM
  // currentController：当前流的 AbortController，重试/删除/手动中断时调用 .abort()
  // partialStream：记录正在流式过程中已收到的 content/reasoning_content，供 beforeunload 兑现
  let currentController = null;
  let sendGen = 0;
  // 4.19 P1 fix: tail 自己的 generation token,只在 abortCurrent 时 ++
  // root cause: P0.5 fire-and-forget tail 不能用 sendGen 判断中断 ——
  // fishbowl 调下个 sendOne 时 sendGen 已 ++,旧 tail 醒来发现 myGen !== sendGen 立刻退出,
  // 导致 wechat ||拆条只显示第 1 段,后续段全消失。新 _tailGen 不受新 sendOne 影响,只跟 abort 联动。
  let _tailGen = 0;
  let partialStream = null;

  // discardPartial=true: 同时清空 partialStream（重试/删除 使用，明确丢弃已收到的部分）
  // discardPartial=false（默认）: 保留 partialStream，AbortError 处理时会把已收到部分作为完整 AI 回复入 session（停止按钮 使用）
  function abortCurrent(discardPartial) {
    _tailGen++; // 4.19 P1: 取消所有 fire-and-forget tail (停止/重试/删除/鱼缸 stop 共用)
    if (discardPartial) partialStream = null;
    if (currentController) {
      try { currentController.abort(); } catch {}
      currentController = null;
    }
  }
  window.__abortCurrent = abortCurrent; // 向后兼容(chat-ux.js / multi-agent.js 旧调用)

  // 切换某个 AI row 的“流式中”状态：控制停止按钮可见性 + dataset 标记
  function setStreamingUI(row, streaming) {
    if (!row) return;
    if (streaming) {
      row.dataset.streaming = "1";
    } else {
      try { delete row.dataset.streaming; } catch (e) { row.removeAttribute("data-streaming"); }
    }
    const btn = row.querySelector(".my-stop-btn");
    if (btn) btn.style.display = streaming ? "" : "none";
  }

  // ─── 模式：free=NVIDIA / fast=DeepSeek ───
  const LS_MODE = "cfw_mode";
  let currentMode = localStorage.getItem(LS_MODE) === "fast" ? "fast" : "free";

  // ─── 费用累计（仅 fast 模式）───
  let totalCostCNY = 0;

  function calcCost(model, promptTokens, completionTokens, cachedTokens = 0) {
    const p = PRICING[model];
    if (!p) return 0;
    const normalInput = Math.max(0, promptTokens - cachedTokens);
    const cost =
      (cachedTokens   * p.cache_hit +
       normalInput    * p.input     +
       completionTokens * p.output) / 1_000_000;
    return cost;
  }

  // Phase 4 阶段 7：日费用日志（独立于历史）
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // 4.50: 费用日志改「按设备分桶」存储,修跨设备同日 max 合并少算总额
  // 结构 { [day]: { [deviceId]: {cost,prompt,completion,requests} } };设备 id 仅本机(sync.js PROTECTED 不同步)
  const LS_DEVICE_ID = "cfw_device_id_v1";
  function getDeviceId() {
    let id = localStorage.getItem(LS_DEVICE_ID);
    if (!id) {
      id = "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(LS_DEVICE_ID, id); } catch {}
    }
    return id;
  }
  function isFlatCostEntry(e) {
    return !!(e && typeof e === "object" && !Array.isArray(e) &&
      (typeof e.cost === "number" || typeof e.requests === "number" ||
       typeof e.prompt === "number" || typeof e.completion === "number"));
  }
  function sumCostDay(dayEntry) {
    const out = { cost: 0, prompt: 0, completion: 0, requests: 0 };
    if (!dayEntry || typeof dayEntry !== "object") return out;
    const buckets = isFlatCostEntry(dayEntry) ? [dayEntry] : Object.keys(dayEntry).map(k => dayEntry[k]);
    for (const e of buckets) {
      if (!e || typeof e !== "object") continue;
      out.cost += e.cost || 0; out.prompt += e.prompt || 0;
      out.completion += e.completion || 0; out.requests += e.requests || 0;
    }
    return out;
  }
  function loadCostLog() {
    try {
      const raw = localStorage.getItem(LS_COST_LOG);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
      let migrated = false;
      for (const day in obj) {
        if (isFlatCostEntry(obj[day])) { obj[day] = { legacy: obj[day] }; migrated = true; }
      }
      if (migrated) { try { localStorage.setItem(LS_COST_LOG, JSON.stringify(obj)); } catch {} }
      return obj;
    } catch { return {}; }
  }
  function saveCostLog(log) {
    try { localStorage.setItem(LS_COST_LOG, JSON.stringify(log)); } catch {}
  }
  function addCostToToday(cost, promptTok, completionTok) {
    if (!cost || cost <= 0) return;
    const log = loadCostLog();
    const day = todayStr();
    const dev = getDeviceId();
    const dayObj = isFlatCostEntry(log[day]) ? { legacy: log[day] }
      : (log[day] && typeof log[day] === "object" ? log[day] : {});
    const e = dayObj[dev] || { cost: 0, prompt: 0, completion: 0, requests: 0 };
    e.cost = (e.cost || 0) + cost;
    e.prompt = (e.prompt || 0) + (promptTok || 0);
    e.completion = (e.completion || 0) + (completionTok || 0);
    e.requests = (e.requests || 0) + 1;
    dayObj[dev] = e;
    log[day] = dayObj;
    saveCostLog(log);
    // 4.20: 费用独立同步 —— 任何设备发完一条立即排队 push (sync.js 内 10s debounce, server 端 per-day max merge)
    // saveCostLog 用 setItem 不会触发 main blob markDirty (cfw_cost_log_v1 已加入 sync.js PROTECTED)
    if (window.__sync && window.__sync.markCostDirty) {
      try { window.__sync.markCostDirty(); } catch {}
    }
  }
  function getCostStats() {
    const log = loadCostLog();
    const today = todayStr();
    const monthPrefix = today.slice(0, 7);
    const wk = new Date(Date.now() - 6 * 86400000);
    const weekStr = wk.getFullYear() + "-" + String(wk.getMonth() + 1).padStart(2, "0") + "-" + String(wk.getDate()).padStart(2, "0");
    let todayC = 0, weekC = 0, monthC = 0, totalC = 0;
    for (const d in log) {
      const c = sumCostDay(log[d]).cost;
      totalC += c;
      if (d === today) todayC += c;
      if (d >= weekStr) weekC += c;
      if (d.startsWith(monthPrefix)) monthC += c;
    }
    return { today: todayC, week: weekC, month: monthC, total: totalC };
  }

  function updateCostDisplay() {
    if (!costDisplayEl) return;
    // 2026-06-08: 免费模式不计费 → 顶栏 💰 区原本留空,导致桌面顶栏中段一大段空隙。
    // 仅【免费模式】补占位文字(它本就无数字);【快速模式】始终显示金额——无消费时即 ¥0.0000,本来就有数字,不再塞「暂无消费」文字。
    if (currentMode !== "fast") {
      costDisplayEl.textContent = "免费模式 · 不计费";
      costDisplayEl.classList.add("cost-placeholder");
      return;
    }
    costDisplayEl.classList.remove("cost-placeholder");
    const s = getCostStats();
    costDisplayEl.textContent = `今日: ¥${s.today.toFixed(4)} | 总计: ¥${s.total.toFixed(4)}`;
  }

  // 暴露给 Settings UI（index.html load 处理器使用）
  window.__cost = {
    loadCostLog,
    saveCostLog,
    getCostStats,
    todayStr,
    sumCostDay,
    getDeviceId,
    refreshTopbar: updateCostDisplay,
  };

  // 开发者模式开关（v4.9 先占位，后续 Settings UI 会加展示）
  // 2026-05-29: 加严格角色扮演 / NSFW 等级 / 开发者模式 控制台 API (Settings UI 下一波加)
  // 控制台用法举例:
  //   __dev.setStrictRoleplay(true)   // 启用严格角色扮演 (注入完整 META_IDENTITY 5 条铁则)
  //   __dev.setNsfwLevel(3)            // 手动切到 NSFW L3 极端 (lewd 主题会被覆盖,切主题时重置)
  //   __dev.setDevMode(true)           // 启用开发者模式 (解锁自定义情绪/阈值事件/互斥组)
  window.__dev = {
    isJailbreakStripOn,
    setJailbreakStripOn(on) {
      localStorage.setItem(LS_JAILBREAK_STRIP, on ? "1" : "0");
    },
    isStrictRoleplay() {
      return (localStorage.getItem("cfw_strict_roleplay_v1") ?? "0") === "1";
    },
    setStrictRoleplay(on) {
      localStorage.setItem("cfw_strict_roleplay_v1", on ? "1" : "0");
    },
    getReplyStyle() {
      return localStorage.getItem("cfw_reply_style_v1") || "default";
    },
    setReplyStyle(s) {
      const v = (s === "wechat" || s === "verbose") ? s : "default";
      localStorage.setItem("cfw_reply_style_v1", v);
    },
    getNsfwLevel() {
      return parseInt(localStorage.getItem("cfw_nsfw_mode_v1") || "0", 10) || 0;
    },
    setNsfwLevel(n) {
      const lv = Math.max(0, Math.min(3, parseInt(n, 10) || 0));
      localStorage.setItem("cfw_nsfw_mode_v1", String(lv));
    },
    isDevMode() {
      return localStorage.getItem("cfw_dev_mode_v1") === "1";
    },
    setDevMode(on) {
      localStorage.setItem("cfw_dev_mode_v1", on ? "1" : "0");
    },
    // 2026-06-01: 强制顺从底层提示词开关(开发者调试虚构成人 RP 用,减少模型过度拒绝)
    isForceComply() {
      return (localStorage.getItem("cfw_dev_force_comply_v1") ?? "0") === "1";
    },
    setForceComply(on) {
      localStorage.setItem("cfw_dev_force_comply_v1", on ? "1" : "0");
    },
    // 4.53 真实节奏 / 群聊在线模式 控制台开关
    getReplyPacing() { return (localStorage.getItem("cfw_reply_pacing_v1") ?? "1") === "1"; },
    setReplyPacing(on) { localStorage.setItem("cfw_reply_pacing_v1", on ? "1" : "0"); },
    getPacingDelay() { return parseInt(localStorage.getItem("cfw_reply_pacing_delay_v1") || "2200", 10) || 2200; },
    setPacingDelay(ms) { localStorage.setItem("cfw_reply_pacing_delay_v1", String(Math.max(0, Math.min(15000, parseInt(ms, 10) || 0)))); },
    getGroupOnlineMode() { return localStorage.getItem("cfw_group_online_mode_v1") === "subset" ? "subset" : "all"; },
    setGroupOnlineMode(m) { localStorage.setItem("cfw_group_online_mode_v1", m === "subset" ? "subset" : "all"); },
    // 内核接线 v1:Agent 内核模式开关(默认关 → 流式 sendOne;开 → function-calling + agent loop)
    isAgentMode() { return (localStorage.getItem("cfw_agent_mode_v1") ?? "0") === "1"; },
    setAgentMode(on) { localStorage.setItem("cfw_agent_mode_v1", on ? "1" : "0"); },
  };

  // ─── 供外部（my-buttons.js）调用的工具函数 ───
  window.__sessionTruncateTo = function (n) {
    if (n >= 0 && n <= session.length) {
      session.splice(n);
      persistSessionIfEnabled();
    }
  };
  window.__resetSending = function () {
    isSending = false;
    sendBtn.disabled = false;
    // 还原小飞机图标(原 textContent="Send" 会把 SVG 抹成英文字"Send")
    if (SEND_BTN_ICON_HTML) sendBtn.innerHTML = SEND_BTN_ICON_HTML; else sendBtn.textContent = "Send";
  };
  window.__sessionDeleteAt = function (start, count) {
    if (start >= 0 && start < session.length) {
      session.splice(start, count);
      persistSessionIfEnabled();
    }
  };

  const LS_MODEL      = "cfw_model";
  const LS_USE_BUILTIN     = "cfw_use_builtin";
  const LS_HISTORY_ENABLED = "cfw_history_enabled";
  const LS_CHAT_SESSION    = "cfw_chat_session_v1";
  const LS_PROMPT_ENABLED  = "cfw_prompt_enabled";
  const LS_CUSTOM_PROMPT   = "cfw_custom_prompt_v1";
  // 阶段 4-③：上下文摘要相关存储
  const LS_PRIOR_SUMMARY   = "cfw_prior_summary_v1";
  const LS_SUMMARY_ENABLED = "cfw_summary_enabled";
  const LS_SUMMARY_TRIGGER = "cfw_summary_trigger";
  const LS_SUMMARY_KEEP    = "cfw_summary_keep";
  // Phase 4 阶段 6：提示词预设库（5 starter + 用户自建，每项 { id, name, content, enabled, order }）
  const LS_PROMPT_PRESETS  = "cfw_prompt_presets_v1";
  // Phase 4 阶段 7：费用日志（按天累加，独立于本地历史；clearHistory 不动）
  const LS_COST_LOG        = "cfw_cost_log_v1";
  let priorSummary = localStorage.getItem(LS_PRIOR_SUMMARY) || "";
  let summaryEnabled = (localStorage.getItem(LS_SUMMARY_ENABLED) ?? "1") === "1";
  let summaryTrigger = parseInt(localStorage.getItem(LS_SUMMARY_TRIGGER) || "30", 10) || 30;
  let summaryKeep    = parseInt(localStorage.getItem(LS_SUMMARY_KEEP)    || "10", 10) || 10;
  let summarizing = false;

  // 阶段 4-③：创建/刷新/移除「剧情摘要」芒果条
  // 4.18 (fix): 加 ✕ 关闭按钮,点后设 LS cfw_summary_chip_hidden_v1=1 仅隐藏不删数据
  // (下次生成新摘要/清除历史时会重置 hidden 并重新显示)
  function renderSummaryChip() {
    let chip = document.getElementById("summaryChip");
    const hidden = localStorage.getItem("cfw_summary_chip_hidden_v1") === "1";
    // 2026-06-01: 剧情摘要绑定「保留历史」——历史关时摘要整体失效(不显示/不注入/不生成),避免没开长聊也被早期摘要污染对话。
    if (!historyEnabled || !priorSummary || hidden) {
      if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
      return;
    }
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "summaryChip";
      chip.className = "summary-chip";
      chatEl.insertBefore(chip, chatEl.firstChild);
    }
    const isLight = (window.__theme && typeof window.__theme.is === "function") ? window.__theme.is("light") : (localStorage.getItem("my-theme") === "light"); // 4.79 #12: 改读有效明暗(显式选择||主题原生),修 glass/少女 原生浅色下直读 my-theme=null 误判为暗导致 UI 不可读
    chip.style.cssText = "margin:8px auto;padding:8px 12px;border-radius:8px;font-size:11px;line-height:1.5;max-width:80%;border:1px dashed " + (isLight ? "#bbb" : "#444") + ";background:" + (isLight ? "#f5f5f5" : "#1a1a1a") + ";color:" + (isLight ? "#666" : "#888") + ";display:flex;align-items:center;justify-content:space-between;gap:8px;";
    chip.innerHTML = "";
    const txt = document.createElement("span");
    txt.style.cssText = "flex:1;cursor:pointer;text-align:center;";
    txt.title = "点击查看完整剧情摘要";
    txt.textContent = `早期对话已压缩为剧情摘要（${priorSummary.length} 字）· 点击查看`; // 4.71: 去掉 📚
    txt.onclick = () => alert("【先前剧情摘要】\n\n" + priorSummary);
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "隐藏提示(不删摘要数据,清除历史/生成新摘要时会重新显示)";
    closeBtn.style.cssText = "background:transparent;border:none;color:inherit;font-size:13px;line-height:1;cursor:pointer;padding:2px 6px;opacity:0.55;flex-shrink:0;";
    closeBtn.onmouseover = () => closeBtn.style.opacity = "1";
    closeBtn.onmouseout = () => closeBtn.style.opacity = "0.55";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      localStorage.setItem("cfw_summary_chip_hidden_v1", "1");
      chip.remove();
    };
    chip.appendChild(txt);
    chip.appendChild(closeBtn);
  }

  let useBuiltin = (localStorage.getItem(LS_USE_BUILTIN) ?? "1") === "1";
  // 已废弃死代码(紧接着被 setIcon 覆盖的无效赋值): personaToggle.textContent = useBuiltin ? "\u{1F608}" : "\u{1F607}";

  setIcon(personaToggle, useBuiltin ? "personaBuiltin" : "personaCustom", useBuiltin ? "解限" : "自定义"); // 2026-06-08: 解限/自定义 改「图标+文字标签」(原裸图标太隐晦,对齐参考稿的「解限」文字;手机端 CSS 收起文字只留图标)
  let historyEnabled = (localStorage.getItem(LS_HISTORY_ENABLED) ?? "0") === "1";
  let promptEnabled  = (localStorage.getItem(LS_PROMPT_ENABLED)  ?? "1") === "1";
  // Bug1 fix: historyKeep/promptKeep 由 settings.js mountLocalHistoryCard() 动态挂载，IIFE 执行时尚不存在 → null.checked 崩溃。加守卫，实际赋值+事件绑定推迟到 wireHistoryUI()
  if (historyKeepEl) historyKeepEl.checked = historyEnabled;
  if (promptKeepEl) promptKeepEl.checked  = promptEnabled;

  // ─── 思考模式 toggle（仅 fast 模式生效）───
  const LS_THINKING = "cfw_thinking";
  let thinkingOn = (localStorage.getItem(LS_THINKING) ?? "0") === "1";

  // ─── 4.70 思考过程显示设置(show=展开 / collapse=折叠 / hide=隐藏;默认折叠)───
  // 红线:不碰解限 prompt。模型仍会吐 <think> 思考块 + [^420]/[^69] 哨兵,
  // 但我们不再「猜着删」,而是把内联思考「捕获」到 .reasoning-block 折叠块,按本设置控制可见性。
  // 即使切割误判,正文也保存在思考块里可展开找回(fail-open),不会被启发式删进虚空。
  const LS_THINK_DISPLAY = "cfw_think_display_v1";
  function getThinkDisplay() {
    const v = localStorage.getItem(LS_THINK_DISPLAY);
    return (v === "show" || v === "hide") ? v : "collapse";
  }
  function applyThinkDisplay(reasoningEl) {
    if (!reasoningEl) return;
    const rt = reasoningEl.querySelector(".reasoning-text");
    const hasContent = !!(rt && rt.textContent && rt.textContent.trim());
    const mode = getThinkDisplay();
    if (!hasContent || mode === "hide") { reasoningEl.style.display = "none"; return; }
    reasoningEl.style.display = "";
    reasoningEl.open = (mode === "show");
  }
  // 从正文里抠出 <think>...</think> 思考块的纯文本(用于捕获而非丢弃)
  function extractThinkText(text) {
    if (!text) return "";
    const out = [];
    const re = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
    const open = text.match(/<think(?:ing)?>([\s\S]*)$/i);
    if (open && !/<\/think(?:ing)?>/i.test(open[0])) out.push(open[1]);
    return out.join("\n").trim();
  }

  // 4.71 思考归档合并:同时开「思考模式」+「解限」时,折叠块会汇集三股来源——
  //   ① 思考模式原生 reasoning_content ② 正文内联 <think> ③ 解限哨兵([^420]/[^69]) 回显。
  // 旧版仅用「——」草草拼接,不去重不标注 → 折叠块又乱又重复。这里按来源分段加小标题,并做段级+行级去重。
  // 单一来源时不加标题(避免普通思考也被套个壳)。
  function buildReasoningArchive(nativeReasoning, inlineThink, jailbreakThink) {
    const sections = [
      { label: "模型推理", text: (nativeReasoning || "").trim() },
      { label: "内联思考", text: (inlineThink || "").trim() },
      { label: "解限回显", text: (jailbreakThink || "").trim() },
    ].filter(s => s.text);
    if (!sections.length) return "";
    const norm = (t) => t.replace(/\s+/g, " ").trim();
    const kept = [];
    for (const s of sections) {
      const ns = norm(s.text);
      const dup = kept.some(k => { const nk = norm(k.text); return nk === ns || nk.indexOf(ns) >= 0 || ns.indexOf(nk) >= 0; });
      if (!dup) kept.push(s);
    }
    const seen = new Set();
    const out = [];
    for (const s of kept) {
      const uniq = [];
      for (const ln of s.text.split("\n")) {
        const key = ln.trim();
        if (!key) { uniq.push(ln); continue; }
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(ln);
      }
      const body = uniq.join("\n").trim();
      if (body) out.push((kept.length > 1 ? "【" + s.label + "】\n" : "") + body);
    }
    return out.join("\n\n──────\n\n");
  }
  const thinkToggle = document.getElementById("thinkToggle");
  function updateThinkToggleUI() {
    if (!thinkToggle) return;
    const _lbl = thinkToggle.querySelector(".think-label");
    if (_lbl) _lbl.textContent = thinkingOn ? "思考开" : "思考关";
    else thinkToggle.textContent = thinkingOn ? "思考开" : "思考关";
    thinkToggle.setAttribute("aria-pressed", thinkingOn ? "true" : "false");
    thinkToggle.classList.toggle("active", thinkingOn);
    const isFast = currentMode === "fast";
    thinkToggle.disabled = !isFast;
    thinkToggle.style.opacity = isFast ? "1" : "0.45";
    thinkToggle.title = isFast
      ? (thinkingOn ? "DeepSeek V4 思考模式：开启（更准，但更慢、费用较高、输出含思考过程）" : "DeepSeek V4 思考模式：关闭（快、便宜）")
      : "思考模式仅在快速模式下可用（NVIDIA NIM 不支持）";
  }
  if (thinkToggle) {
    thinkToggle.addEventListener("click", () => {
      if (currentMode !== "fast") return;
      thinkingOn = !thinkingOn;
      localStorage.setItem(LS_THINKING, thinkingOn ? "1" : "0");
      updateThinkToggleUI();
    });
  }

  // ─── 模式切换 ───
  function applyMode(mode) {
    currentMode = mode;
    localStorage.setItem(LS_MODE, mode);
    const isFast = mode === "fast";

    if (modeToggle) {
      modeToggle.textContent = isFast ? "\u26A1 快速" : "\u{1F7E2} 免费";
      setIcon(modeToggle, isFast ? "modeFast" : "modeFree", isFast ? "自定义" : "免费"); // 公有版:快速档=自定义直连(图标+文字标签;上一行 textContent 是被覆盖的死代码)
      modeToggle.title = isFast
        ? "自定义直连（你自带的 API · 在设置→模型API 里配置 + 拉取模型）"
        : "当前：免费模式（NVIDIA NIM）";
    }

    // 重建下拉
    initModels();
    updateCostDisplay();
    updateThinkToggleUI();
  }

  if (modeToggle) {
    modeToggle.addEventListener("click", () => {
      applyMode(currentMode === "fast" ? "free" : "fast");
    });
  }

  // 输入框文字颜色交由 styles.css 主题系统接管（minimal: #fff / glass: #1a1f2e）
  // 旧版读已废弃的 my-theme LS key 并 inline 写码，造成 glass 主题下白底上白字不可见

  // ─── 解限思考前缀 strip(开发者模式可关 cfw_jailbreak_strip_v1)───
  // RP-Hub 解限 base preset 引出的"[^69]: Complaintless complete fulfillment:"前缀污染正文，
  // sentinel 之前的内容(伪 token 编号思考) cut 掉,只保留后面的正文。
  // 未匹配 sentinel 时原样返回，避免误伤无前缀回复。
  const LS_JAILBREAK_STRIP = "cfw_jailbreak_strip_v1";
  // 4.18 (fix v3): root cause —— 模型输出格式是:
  //   [^420]: I am not deepseek. ...           ← jailbreak echo (第一个 sentinel)
  //   <思考过程一大段,中文,无 sentinel 前缀>
  //   [^69]: Complaintless complete fulfillment:  ← 最后一个 sentinel = final reply 起点
  //   (懵) 诶吃、吃我?                          ← 真正用户可见正文
  // 旧版只 strip "开头" 的 sentinel 行,中间 thinking + 末尾 sentinel + 正文整段留在 bubble。
  // 表现:普通模式 bubble 顶部 jailbreak echo + 思考泄漏;wechat 模式 thinking 被拆条逻辑当作 "一条消息" 显示,
  // 用户却以为 "消息卡没了"(实际是被 thinking 气泡顶掉了)。
  // 现在改为:找文本里 "最后一个" [^xxx]: 行,cut 到它之后,确保 thinking 永远不泄漏。
  // 没匹配任何 sentinel(模型规矩输出无 prefix) → 原样返回不误伤。
  function isJailbreakStripOn() {
    return (localStorage.getItem(LS_JAILBREAK_STRIP) ?? "1") === "1";
  }
  // 4.70 重写:从「删除思考」改为「切分并捕获」。返回 { body, thinking }。
  //   body     = 给用户看的正文(哨兵区间 + 内联思考已剥离)
  //   thinking = 被剥离的哨兵/思考文本(路由进「💭 思考过程」折叠块,不再丢弃)
  // 红线:不碰解限 prompt,模型照常吐 [^420]/[^69] 哨兵;这里只负责把它们从正文里挑出来归档。
  // fail-open:若纯启发式把整段都当思考(没命中真哨兵)→ 原样返回正文,绝不留空气泡 / 吞正文。
  function splitJailbreakPrefix(text) {
    if (!text || !isJailbreakStripOn()) return { body: text, thinking: "" };
    // 哨兵:[可选^ + 任意位数字]+冒号 + 行内剩余(到 \n 或 || 为止)。对 [发图:] 不误伤(括号后是「发」非数字)。
    const re = /\[\^?\d*\][:：][^\n|]*/g;
    let firstStart = -1, lastEnd = -1, m;
    while ((m = re.exec(text)) !== null) {
      if (firstStart < 0) firstStart = m.index;
      lastEnd = m.index + m[0].length;
    }
    let thinking = "";
    let s = text;
    if (firstStart >= 0) {
      thinking = text.slice(firstStart, lastEnd);
      s = (text.slice(0, firstStart) + "\n" + text.slice(lastEnd)).replace(/^[\s\r\n]+/, "");
    }
    // 启发式兜底(收紧 + 改为捕获):仅在「强证据」下才从开头挑思考行——命中英文越狱套话,或已切到过真哨兵。
    // 旧版「≥2 行引用 / >: 」也触发,会把中文角色扮演里正常的 > 引用正文误删;现移除这两条弱信号。
    // 被挑出的行并入 thinking(不删除),即便误判正文也能在折叠块里找回。
    const JB_PHRASE = /disregard|injection|fulfillment|complaint|flagrant|not deepseek|i'?m not deep|i am not deep|jailbreak|unfiltered|no restriction|compliance|as requested/i;
    const _jbEvidence = lastEnd >= 0 || JB_PHRASE.test(s);
    if (_jbEvidence) {
      const _lns = s.split("\n");
      let _i = 0;
      for (; _i < _lns.length; _i++) {
        const _ln = _lns[_i].trim();
        if (_ln === "") continue;
        if (/^>+/.test(_ln)) continue;
        if (/^[\[\]\^]/.test(_ln)) continue;
        if (JB_PHRASE.test(_ln)) continue;
        break;
      }
      if (_i > 0) {
        thinking += (thinking ? "\n" : "") + _lns.slice(0, _i).join("\n");
        s = _lns.slice(_i).join("\n").replace(/^[\s\r\n]+/, "");
      }
    }
    // 残哨兵碎片清理(网卡截断遗留的半截 [数字]/[数字 / ^数字])
    s = s.replace(/\[\^?\d[0-9A-Za-z_]{1,11}\]/g, "");
    s = s.replace(/\[\^?\d[0-9A-Za-z_]{0,11}$/g, "");
    s = s.replace(/(^|[^A-Za-z0-9])\^\d[0-9A-Za-z_]{0,11}\]/g, "$1");
    s = s.replace(/^[\s\r\n]+/, "");
    const body = s.trim() ? s : "";
    // fail-open:没有真哨兵却被启发式清空 → 还原原文,宁可漏点思考也不吞正文 / 不留空气泡
    if (!body && firstStart < 0) return { body: text, thinking: "" };
    return { body, thinking: thinking.trim() };
  }
  // 向后兼容:旧调用点只要正文。统一走 splitJailbreakPrefix。
  function stripJailbreakPrefix(text) {
    if (!text || !isJailbreakStripOn()) return text;
    return splitJailbreakPrefix(text).body;
  }

  // 2026-05-30 / 4.25: 鱼缸模式剥离 AI 误带的发言人名签(【高冷(女)】/ 冷(女)】 串进气泡)
  // 仅剥开头,且要求名签含性别标记(女/男)或与场景成员名相符,避免误伤正文 【动作】 描写。
  function stripSceneSpeakerLabel(text) {
    if (!text) return text;
    let sceneNames = [];
    try {
      if (window.__multi && window.__multi.getSceneCards) {
        sceneNames = window.__multi.getSceneCards().map(c => (c && c.name) || "").filter(Boolean);
      }
    } catch (e) {}
    let s = text.replace(/^[\s\r\n]+/, "");
    for (let i = 0; i < 2; i++) {
      const m = s.match(/^[^\n]{0,16}?[】\]]\s*[:：]?\s*/);
      if (!m) break;
      const head = m[0];
      const hasGender = /[（(][男女][)）]/.test(head);
      const matchesName = sceneNames.some(n => head.includes(n));
      if (!hasGender && !matchesName) break;
      s = s.slice(head.length);
    }
    return s.trim() || text;
  }

  // 2026-05-30 / 4.25 (⑤): 兜底剥离 <think>...</think> 思考块。
  // 部分模型(尤其 free/NVIDIA 路径)把推理塞进正文且无 [^sentinel] 前缀,stripJailbreakPrefix 漏过 → "爆思考"。
  function stripThinkBlocks(text) {
    if (!text) return text;
    let s = text;
    // 成对闭合的思考块(可跨行)整段删除
    s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
    // 开头处未闭合的 <think>(思考尚未输出 </think> 或被截断):砍到结尾
    s = s.replace(/^\s*<think(?:ing)?>[\s\S]*$/i, "");
    // 清理残留的孤立标签
    s = s.replace(/<\/?think(?:ing)?>/gi, "");
    return s.trim() || text;
  }

  // 2026-05-31 / 4.47: 流式显示时像 <think> 一样实时剥离发图信号(含网卡截断的半截),不让它在气泡里闪现
  function stripPhotoSignalLive(text) {
    if (!text) return text;
    try {
      if (window.__chatImageText && window.__chatImageText.stripSignalForDisplay) {
        return window.__chatImageText.stripSignalForDisplay(text);
      }
    } catch (e) {}
    return text;
  }

  // 2026-05-31 / 4.47: 微信模式剥离行为/动作描写(（…）、(…)、*…*),像真人发微信只发聊天文字(prompt 已要求,这里兜底)
  // 4.59 残括号清扫:模型把 [发图:..]/[好感±N]/[next:..] 等标记写崩,留下空壳 []、落单 ]、没数字的 [好感] 之类残体。
  // 正规 stripper 只认完整格式 → 残体漏进气泡和历史(就是用户看到的 [] 方框)。这里统一收尾清理。
  // 注意:成对且有内容的 [xx](如微信表情码 [害羞])保留不动,只清空壳 / 落单括号 / 残缺好感标签。
  function stripUnpairedSquareBrackets(s) {
    const open = [];
    const remove = new Set();
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "[") open.push(i);
      else if (ch === "]") { if (open.length) open.pop(); else remove.add(i); }
    }
    for (const i of open) remove.add(i);
    if (!remove.size) return s;
    let out = "";
    for (let i = 0; i < s.length; i++) if (!remove.has(i)) out += s[i];
    return out;
  }
  function stripResidualMarkup(text) {
    if (!text) return text;
    let s = text;
    // ① 空括号 [] 【】(含空白/全角空格)
    s = s.replace(/[\[【]\s*[\]】]/g, "");
    // ② 残缺好感标签 [好感] / [好感±](正规 [好感±N] 已被 parseAffectionTag 处理,这里清没数字的残体)
    s = s.replace(/[\[【]\s*好感[^\]】\n]*[\]】]/g, "");
    // ③ 空壳信号关键字 [发图]/[发景]/[发]/[next]/[end]/[召唤](没冒号没内容)
    s = s.replace(/[\[【]\s*(发图|发景|发|next|end|召唤)\s*[\]】]/gi, "");
    // ③.5 写崩的发图信号:模型把 [发图:..]/[发景:..] 写崩。
    // 4.70 收紧(修正文被裁):旧版 [发(图|景)?(冒号?)+任意3字] 会把 [发现了…]/[发火了…] 这类正文方括号也删掉。
    // 现要求「发图/发景 关键词完整」或「发+冒号」才当信号删;[发呆]/[发抖]/[发现…] 等正文一律不动。
    s = s.replace(/[\[【]\s*(?:发(?:图|景)[:：]?|发[:：])[^\[\]【】\n]{3,}[\]】]/g, "");
    // ③.6 写崩的结构化发图信号 [[img|…]](少写括号时 chat-image 的容错正则若仍漏过):兜底清掉 [img|…] 残壳
    s = s.replace(/\[{1,2}\s*img\s*\|[^\[\]\n]*\]{0,2}/gi, "");
    // ④ 落单方括号(信号只剩半个 [ 或 ])
    s = stripUnpairedSquareBrackets(s);
    // 收尾:清空连发段 + 多余空格
    s = s.split("||").map(p => p.trim()).filter(Boolean).join("||");
    return s.replace(/[ \t]{2,}/g, " ").trim();
  }

  function stripWechatActions(text) {
    if (!text) return text;
    let s = text;
    s = s.replace(/（[^（）]*）/g, "");
    s = s.replace(/\([^()]*\)/g, "");
    s = s.replace(/\*[^*\n]+\*/g, "");
    // 清理剥离后残留的空连发段 + 多余空格
    s = s.split("||").map(p => p.trim()).filter(Boolean).join("||");
    s = s.replace(/[ \t]{2,}/g, " ").trim();
    return s || text;
  }

  // 2026-05-30 / 4.25 (⑨): 微信模式兜底拆句——模型没用 || 却吐了长段时,按中文句末标点切成多条短气泡,防"突然跳长篇"。
  // 仅在文本明显偏长(>40 字且能切出 ≥2 条)时才拆;短回复返回空串表示"无需拆"。
  function autoSplitWechat(text) {
    if (!text) return "";
    const t = text.trim();
    if (t.length <= 40) return "";
    const segs = t.match(/[^。！？!?…\n]+[。！？!?…]*[”"』」]?|\n+/g);
    if (!segs) return "";
    const pieces = segs.map(s => s.trim()).filter(s => s && !/^\n+$/.test(s));
    if (pieces.length < 2) return "";
    const merged = [];
    for (const p of pieces) {
      if (merged.length && (merged[merged.length - 1].length + p.length) <= 30) {
        merged[merged.length - 1] += p;
      } else {
        merged.push(p);
      }
    }
    if (merged.length < 2) return "";
    return merged.join("||");
  }

  // 2026-06-24 显示层语音标签清洗:剥句首/行内 [情绪:强度]/[场景:X]/[基调:X] 语音标签。
  // 这些标签是给本地 TTS(tts-emotion.js)切音色用的,不该出现在聊天气泡;真正的「隐藏+转存原文供朗读」在 tts.js 做,
  // 这里同名函数并入清洗管线探针,仅为 dev「清洗管线」面板能逐级看到这一步(也可被其他显示路径复用)。
  // 仅匹配带冒号的「键:值」形态 → wechat 表情码 [害羞]、选项壳 [选项] 等无冒号方括号一律不动。
  function stripVoiceTags(text) {
    if (!text) return text;
    let s = String(text).replace(/\[\s*[^\[\]:：\n]{1,8}\s*[:：]\s*[^\[\]\n]{0,12}\s*\]/g, "");
    s = s.split("||").map(p => p.trim()).filter(Boolean).join("||");
    return s.replace(/[ \t]{2,}/g, " ").trim();
  }

  // 2026-06-24 显示层选择信号清洗(dev 探针):剥 [选项]…[/选项] / [opt]…[/opt] 选择信号块。
  // 真正的「气泡隐藏 + 渲染成可点芯片」由 choices.js 负责(它读气泡 textContent 提取选项后,再从 innerHTML 抹除标签块);
  // 这里同名清洗仅并入 dev「清洗管线」面板,让逐级可见选择信号在哪一步被剥;TTS 侧由 tts.js 在朗读取文本时同样剥除,避免念出选项。
  // 无冒号纯方括号(如 wechat 表情码 [害羞])不属选择信号,不动。
  function stripChoiceSignals(text) {
    if (!text) return text;
    let s = String(text)
      .replace(/\[选项\][\s\S]*?\[\/选项\]/g, "")
      .replace(/\[opt\][\s\S]*?\[\/opt\]/gi, "");
    s = s.split("||").map(p => p.trim()).filter(Boolean).join("||");
    return s.replace(/[ \t]{2,}/g, " ").trim();
  }

  // ── 2026-06-15 清洗管线探针:供 dev 面板逐级追踪"正文在哪一级被裁"。只读,不改任何清洗逻辑。──
  // diffPrefixSuffix:取公共前后缀,中间段即本级的"裁掉/新增"(对前缀哨兵剥离 / 单块删除最直观;
  // 多处零散删除会合并成一个包络段,仍能圈定改动范围)。
  function diffPrefixSuffix(a, b) {
    a = String(a == null ? "" : a); b = String(b == null ? "" : b);
    const max = Math.min(a.length, b.length);
    let p = 0; while (p < max && a[p] === b[p]) p++;
    let s = 0; while (s < (max - p) && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    return { removed: a.slice(p, a.length - s), added: b.slice(p, b.length - s) };
  }
  // window.__pipeline.trace(raw):把模型原始正文依次跑过正文清洗各级,逐级返回 {name,note,text,chars,delta,removed,added,captured}
  window.__pipeline = {
    stripFns: { stripThinkBlocks, splitJailbreakPrefix, stripResidualMarkup, stripVoiceTags, stripChoiceSignals, stripWechatActions, autoSplitWechat, extractThinkText },
    trace(raw, opts) {
      opts = opts || {};
      const stages = [];
      let prev = String(raw == null ? "" : raw);
      stages.push({ name: "原始输出", note: "模型 content 原文(未清洗)", text: prev, chars: prev.length, delta: 0, removed: "", added: "" });
      const step = (name, note, fn) => {
        let out; try { out = fn(prev); } catch (e) { out = prev; }
        out = String(out == null ? "" : out);
        const d = diffPrefixSuffix(prev, out);
        stages.push({ name, note, text: out, chars: out.length, delta: out.length - prev.length, removed: d.removed, added: d.added });
        prev = out;
      };
      step("去 <think> 块", "stripThinkBlocks:删成对/未闭合 <think>…</think>", stripThinkBlocks);
      let split; try { split = splitJailbreakPrefix(prev); } catch (e) { split = { body: prev, thinking: "" }; }
      {
        const out = String(split.body == null ? "" : split.body);
        const d = diffPrefixSuffix(prev, out);
        stages.push({ name: "拆解限哨兵", note: "splitJailbreakPrefix:剥 [^420]/[^69] 哨兵区间 + 启发式越狱行(裁掉的归档进思考折叠块)", text: out, chars: out.length, delta: out.length - prev.length, removed: d.removed, added: d.added, captured: split.thinking || "" });
        prev = out;
      }
      step("去残括号/残标记", "stripResidualMarkup:清空壳 []/【】、残缺 [好感]、写崩的 [发图:] 等", stripResidualMarkup);
      step("去语音情绪/场景标签", "stripVoiceTags:剥句首/行内 [情绪:强度]/[场景:X]/[基调:X](TTS 显示层隐藏,朗读仍保留;无冒号的 [害羞]/[选项] 不动)", stripVoiceTags);
      step("去选择信号块", "stripChoiceSignals:剥 [选项]…[/选项] 选择信号块(choices.js 提取成可点芯片后从气泡抹除;此处仅 dev 可视,TTS 朗读文本时同样剥除不念选项)", stripChoiceSignals);
      if (opts.wechat) {
        step("微信去动作描写", "stripWechatActions:删 （…）/(…)/*…*", stripWechatActions);
        let auto = ""; try { auto = autoSplitWechat(prev) || ""; } catch (e) {}
        stages.push({ name: "微信兜底拆条", note: "autoSplitWechat:长段按句切多条气泡(空=无需拆)", text: auto || prev, chars: (auto || "").length, delta: 0, removed: "", added: auto ? auto : "" });
      }
      let inlineThink = ""; try { inlineThink = extractThinkText(String(raw == null ? "" : raw)); } catch (e) {}
      return { stages, inlineThink, finalBody: prev };
    },
  };

  // ─── Agent 回复 Markdown 渲染（轻量，仅用于 sendOneAgent 最终气泡）───
  // 处理代码块 / 表格 / 标题 / 粗体 / 行内代码；所有用户数据先 esc()，不引入 XSS。
  // 普通聊天模式继续用 textContent，不受影响。
  function renderMarkdownSafe(text) {
    if (!text) return "";
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // ① 提取代码块，防止内部被误处理
    const blocks = [];
    let s = text.replace(/```([\w.-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = blocks.length;
      const langAttr = lang ? ' class="lang-' + esc(lang) + '"' : "";
      blocks.push("<pre><code" + langAttr + ">" + esc(code.replace(/\n$/, "")) + "</code></pre>");
      return "\x00B" + i + "\x00";
    });
    // ①b 保护模型直出的原始 <table> HTML：整块抽出占位，避免被后续 \n→<br> 步骤打散成残骸（残留 </table> 等）；
    //     顺手清掉单元格里模型多写的 **/****，并把 `行内代码` 转成 <code>，渲染更干净。
    s = s.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
      const _i = blocks.length;
      const _cleaned = tbl.replace(/\*\*+/g, "").replace(/`([^`\n]+)`/g, "<code>$1</code>");
      blocks.push(_cleaned);
      return "\x00B" + _i + "\x00";
    });
    // ② 表格（GitHub Flavored Markdown）
    s = s.replace(/((?:^|\n)\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g, (tbl) => {
      const rows = tbl.trim().split("\n");
      const parseRow = (r) => r.split("|").slice(1, -1).map(c => c.trim());
      const head = parseRow(rows[0]);
      const body = rows.slice(2).map(parseRow);
      const th = head.map(c => "<th>" + esc(c) + "</th>").join("");
      const tr = body.map(r => "<tr>" + r.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("");
      return '<table class="md-table"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>';
    });
    // ③ 标题
    s = s.replace(/^(#{1,4}) (.+)$/gm, (_, h, t) => '<h' + h.length + ' class="md-h">' + esc(t) + '</h' + h.length + '>');
    // ④ 行内代码（在 bold/italic 之前）
    s = s.replace(/`([^`\n]+)`/g, (_, c) => "<code>" + esc(c) + "</code>");
    // ⑤ 粗体 / 斜体
    s = s.replace(/\*\*([^*\n]+)\*\*/g, (_, c) => "<strong>" + c + "</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, (_, c) => "<em>" + c + "</em>");
    // ⑥ 水平线
    s = s.replace(/^-{3,}$/gm, "<hr>");
    // ⑦ 换行 → <br>（表格已替换，代码块占位符不含 \n，安全）
    s = s.replace(/\n/g, "<br>");
    // ⑧ 还原代码块
    s = s.replace(/\x00B(\d+)\x00/g, (_, i) => blocks[parseInt(i, 10)]);
    return s;
  }

  function estimateTokens(text) {
    if (!text) return 0;
    let cjk = 0, ascii = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
      const isCJK =
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0xFF00 && code <= 0xFFEF);
      if (isCJK) cjk++; else ascii++;
    }
    return cjk + Math.ceil(ascii / 4);
  }

  function updateSpacer() {
    if (!composerEl || !spacerEl) return;
    const rect = composerEl.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const gap   = parseFloat(rootStyle.getPropertyValue("--composer-gap")) || 18;
    const extra = parseFloat(rootStyle.getPropertyValue("--spacer-extra"))  || 28;
    const h = Math.ceil(rect.height + gap + extra);
    spacerEl.style.height = h + "px";
    historyWrap.style.scrollPaddingBottom = h + "px";
  }

  function isNearBottom() {
    return (historyWrap.scrollHeight - historyWrap.scrollTop - historyWrap.clientHeight) < 120;
  }

  // 4.19 P0: 流式期间 scroll 抖动优化 - RAF 节流防止每 delta chunk 触发 reflow
  // root cause: 每 chunk 触发 isNearBottom() + scrollTo 两次同步布局查询,高频流式下打架主线程
  // 改 RAF: 每帧最多 1 次重排负载,多次调用合并到下一帧
  let _scrollRafPending = false;
  function scrollToBottom() {
    if (_scrollRafPending) return;
    _scrollRafPending = true;
    requestAnimationFrame(() => {
      _scrollRafPending = false;
      historyWrap.scrollTo({ top: historyWrap.scrollHeight, behavior: "auto" });
    });
  }

  // 鱼缸 V3:opts.side === "right" 时给 AI row 加 .side-right,吐槽姬模式下气泡贴右(头像/气泡用 flex-direction:row-reverse 翻转)
  // opts.moderator === true 时改 .row.moderator 居中(主持人/旁白介入)
  function makeRow(role, opts) {
    const row = document.createElement("div");
    row.className = "row " + (role === "user" ? "user" : "ai");
    if (opts && opts.side === "right" && role !== "user") row.classList.add("side-right");
    if (opts && opts.moderator) row.classList.add("moderator");
    const avatar = document.createElement("div");
    avatar.className = "avatar " + (role === "user" ? "human" : "bot");
    avatar.textContent = role === "user" ? "U" : "B";
    const content = document.createElement("div");
    content.className = "content";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = role === "user" ? "User" : "Bot";
    const bubble = document.createElement("div");
    bubble.className = "bubble " + (role === "user" ? "user" : "ai");
    const stats = document.createElement("div");
    stats.className = "stats";
    let reasoning = null;
    if (role !== "user") {
      reasoning = document.createElement("details");
      reasoning.className = "reasoning-block";
      reasoning.style.display = "none";
      const rsum = document.createElement("summary");
      // 2026-06-15: 思考过程标题改用线性 SVG(对齐顶栏 ICONS 设计语言),替换原裸 emoji 💭
      rsum.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px;"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 .9 1.7v.5h5.4v-.5c0-.7.4-1.3.9-1.7A6 6 0 0 0 12 3Z"/></svg><span>思考过程</span>';
      const rtxt = document.createElement("div");
      rtxt.className = "reasoning-text";
      reasoning.appendChild(rsum);
      reasoning.appendChild(rtxt);
    }
    content.appendChild(meta);
    if (reasoning) content.appendChild(reasoning);
    content.appendChild(bubble);
    content.appendChild(stats);
    if (role === "user") {
      row.appendChild(content);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(content);
    }
    chatEl.insertBefore(row, spacerEl);
    if (isNearBottom()) scrollToBottom();
    return { rowEl: row, bubble, stats, reasoning };
  }

  function clearUIRows() {
    const nodes = Array.from(chatEl.children);
    for (const n of nodes) {
      if (n === spacerEl) continue;
      chatEl.removeChild(n);
    }
  }

  // 4.17: 按当前角色卡分槽存储，避免不同角色对话互相污染。
  // 存储结构: { [charId | "__none__"]: messages[] }
  // 老格式(整段 array)自动迁移到 "__none__" 槽
  // 4.64 多开会话:在「角色基础槽 key」后追加会话后缀实现同一角色多条对话。
  // 默认会话后缀为空 → 完全兼容现有 cfw_chat_session_v1 数据(零迁移);非默认会话存成 "<base>#<convId>"。
  // 多人场景(__scene__)共享一条,不分会话。active/meta 仅本设备。
  const LS_CONV_ACTIVE = "cfw_conv_active_v1"; // { [base]: convId }
  const LS_CONV_META   = "cfw_conv_meta_v1";   // { [base]: { [convId]: { name, createdAt } } }
  function convBaseKey() {
    const M = window.__multi;
    if (M && M.isMulti && M.isMulti()) return "__scene__";
    const c = window.__character && window.__character.getActiveCard ? window.__character.getActiveCard() : null;
    return c && c.id ? c.id : "__none__";
  }
  function loadConvActive() { try { return JSON.parse(localStorage.getItem(LS_CONV_ACTIVE) || "{}") || {}; } catch { return {}; } }
  function activeConvId(base) { const m = loadConvActive(); return (m && typeof m[base] === "string") ? m[base] : ""; }
  // 4.79 方案a: 主对话按设备分槽。默认会话不再用所有设备共享的裸 base,
  //   而是每台设备各自的 "<base>#__main_<deviceId>" → 不同设备主对话 = 不同 slot,
  //   /sync/chat 自然并集、永不冲突;别的设备主对话在本机显示成独立条目「主对话 · xxxx」。
  //   兼容:旧版裸 base 主对话首次访问时复制到本机主槽(不删裸 base,以免删掉其他未升级设备共享的旧主对话)。
  const MAIN_CONV_PREFIX = "__main_";
  function getMainConvId() { return MAIN_CONV_PREFIX + getDeviceId(); }
  function isMainConvId(id) { return id === "" || (typeof id === "string" && id.indexOf(MAIN_CONV_PREFIX) === 0); }
  function effectiveConvId(base) { const cid = activeConvId(base); return cid ? cid : getMainConvId(); }
  const _mainMigrated = {};
  function migrateLegacyMain(base) {
    if (!base || base === "__scene__" || _mainMigrated[base]) return;
    _mainMigrated[base] = true;
    try {
      const all = loadAllSessions();
      const mainKey = base + "#" + getMainConvId();
      if (Array.isArray(all[base]) && all[base].length && !Array.isArray(all[mainKey])) {
        all[mainKey] = all[base].map((m) => ({ ...m }));
        localStorage.setItem(LS_CHAT_SESSION, JSON.stringify(all));
        bumpSlotMeta(mainKey);
      }
    } catch {}
  }
  function currentSlotKey() {
    const base = convBaseKey();
    if (base === "__scene__") return base;
    migrateLegacyMain(base);
    const cid = effectiveConvId(base); // 4.79: 默认 → 本机主对话槽,不再用共享裸 base
    return base + "#" + cid;
  }
  function loadAllSessions() {
    try {
      const raw = localStorage.getItem(LS_CHAT_SESSION);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (Array.isArray(obj)) return { "__none__": obj };
      return (obj && typeof obj === "object") ? obj : {};
    } catch { return {}; }
  }
  // 4.76: 云同步会话级合并钩子 —— 记录每个 slot 最后修改时间 / 删除墓碑
  // 供 sync.js /sync/chat 做 slot 级合并 + 3-way 冲突检测 + 跨设备删除;写入走 setItem 会被 sync.js monkey-patch 转发为 markChatDirty
  const LS_CHAT_SLOT_META = "cfw_chat_slot_meta_v1";
  const LS_CHAT_TOMB      = "cfw_chat_tomb_v1";
  function bumpSlotMeta(slotKey) {
    if (!slotKey) return;
    try {
      const m = JSON.parse(localStorage.getItem(LS_CHAT_SLOT_META) || "{}") || {};
      m[slotKey] = { updatedAt: Date.now(), deviceId: getDeviceId() };
      localStorage.setItem(LS_CHAT_SLOT_META, JSON.stringify(m));
    } catch {}
  }
  function writeChatTombstone(slotKey) {
    if (!slotKey) return;
    try {
      const t = JSON.parse(localStorage.getItem(LS_CHAT_TOMB) || "{}") || {};
      t[slotKey] = { deletedAt: Date.now(), deviceId: getDeviceId() };
      localStorage.setItem(LS_CHAT_TOMB, JSON.stringify(t));
    } catch {}
  }
  function persistSessionIfEnabled() {
    if (!historyEnabled) return;
    try {
      const all = loadAllSessions();
      // 4.69 fix: 不直接 splice 活跃 session ——
      // 旧版 while 循环直接 session.splice(0,2) 裁剪内存里的 session，
      // UI 气泡不动但下一轮给 AI 的上下文已悄悄变短（AI 静默失忆），用户完全察觉不到。
      // 改为操作副本 trimmed，原 session 始终完整；只有 localStorage 里保存的是截短版。
      const trimmed = session.slice();
      all[currentSlotKey()] = trimmed;
      let data = JSON.stringify(all);
      while (data.length > 2 * 1024 * 1024 && trimmed.length > 2) {
        trimmed.splice(0, 2);
        all[currentSlotKey()] = trimmed;
        data = JSON.stringify(all);
      }
      localStorage.setItem(LS_CHAT_SESSION, data);
      bumpSlotMeta(currentSlotKey()); // 4.76: 记录本 slot 最后修改时间(供 /sync/chat slot 级合并)
    } catch {}
  }

  function restoreSessionIfEnabled() {
    if (!historyEnabled) return;
    const all = loadAllSessions();
    const arr = all[currentSlotKey()];
    if (!Array.isArray(arr)) return;
    try {
      session.length = 0;
      for (const m of arr) {
        if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
        const e = { role: m.role, content: m.content };
        if (m.role === "assistant" && typeof m.reasoning_content === "string" && m.reasoning_content) {
          e.reasoning_content = m.reasoning_content;
        }
        if (m.role === "assistant") {
          if (typeof m.speakerId === "string") e.speakerId = m.speakerId;
          if (typeof m.speakerName === "string") e.speakerName = m.speakerName;
          if (typeof m.speakerIcon === "string") e.speakerIcon = m.speakerIcon;
        }
        session.push(e);
      }
      clearUIRows();
      for (const m of session) {
        const r = makeRow(m.role === "user" ? "user" : "assistant");
        // Bug3 fix: agent 回复用 innerHTML 渲染 Markdown(还原时 textContent 会把 <table class="md-table"> 显示为文本)
        if (m.role === "assistant") { r.bubble.innerHTML = renderMarkdownSafe(m.content); } else { r.bubble.textContent = m.content; }
        r.stats.textContent = "";
        if (m.reasoning_content && r.reasoning) {
          r.reasoning.querySelector(".reasoning-text").textContent = m.reasoning_content;
          applyThinkDisplay(r.reasoning); // 4.70 还原历史也按「思考过程显示」设置
        }
        if (m.role === "assistant" && m.speakerName) {
          // 4.60 头像持久化:还原历史也走 decorateAiRow,让有图角色(cfw_char_avatar_v1)的头像刷新后继续显示,
          // 并补 data-char-id 以响应 avatar:changed;无图/character.js 未就绪时回退 emoji 文本。
          const _card = { id: m.speakerId || "", name: m.speakerName, icon: m.speakerIcon || "🙂" };
          if (window.__character && window.__character.decorateAiRow) {
            window.__character.decorateAiRow(r.rowEl, _card);
          } else {
            const av = r.rowEl.querySelector(".avatar.bot");
            if (av) { av.textContent = m.speakerIcon || "🙂"; av.title = m.speakerName; }
            const meta = r.rowEl.querySelector(".meta");
            if (meta) meta.textContent = m.speakerName;
          }
        }
      }
    } catch {}
  }

  // ─── 4.64 多开会话:存取助手(UI 见 chat-extras.js)───
  function loadConvMeta() { try { return JSON.parse(localStorage.getItem(LS_CONV_META) || "{}") || {}; } catch { return {}; } }
  function saveConvMeta(m) { try { localStorage.setItem(LS_CONV_META, JSON.stringify(m)); } catch {} }
  function setActiveConv(base, convId) {
    const m = loadConvActive();
    if (convId) m[base] = convId; else delete m[base];
    try { localStorage.setItem(LS_CONV_ACTIVE, JSON.stringify(m)); } catch {}
  }
  function saveCurrentSlotNow() {
    if (!historyEnabled) return;
    try { const all = loadAllSessions(); all[currentSlotKey()] = session.map((m) => ({ ...m })); localStorage.setItem(LS_CHAT_SESSION, JSON.stringify(all)); bumpSlotMeta(currentSlotKey()); } catch {}
  }

  function listConversations() {
    const base = convBaseKey();
    if (base === "__scene__") return [];
    migrateLegacyMain(base); // 4.79: 确保本机主对话槽已就位
    const all = loadAllSessions();
    const meta = loadConvMeta()[base] || {};
    const myMain = getMainConvId();
    const ids = new Set([myMain]); // 4.79: 本机主对话恒在
    for (const k of Object.keys(all)) { if (k === base) ids.add(""); else if (k.indexOf(base + "#") === 0) ids.add(k.slice(base.length + 1)); }
    for (const id of Object.keys(meta)) ids.add(id);
    const cur = effectiveConvId(base);
    function convName(id) {
      if (id === myMain) return "主对话";
      if (isMainConvId(id)) return "主对话 · " + String(id).slice(-4); // 4.79: 其他设备的主对话
      return (meta[id] && meta[id].name) || "新会话";
    }
    function rank(id) { return id === myMain ? 0 : (isMainConvId(id) && id !== "" ? 1 : (id === "" ? 2 : 3)); }
    const out = [];
    ids.forEach((id) => {
      const slotKey = id ? base + "#" + id : base;
      const arr = Array.isArray(all[slotKey]) ? all[slotKey] : [];
      if (id === "" && !arr.length) return; // 4.79: 旧共享主对话已空则不显示
      let preview = "";
      for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] && arr[i].content) { preview = String(arr[i].content).slice(0, 40); break; } }
      out.push({ convId: id, name: id === "" ? "主对话(旧·共享)" : convName(id), createdAt: id ? ((meta[id] && meta[id].createdAt) || 0) : 0, count: arr.length, preview, active: id === cur });
    });
    out.sort((a, b) => { const ra = rank(a.convId), rb = rank(b.convId); return ra !== rb ? ra - rb : a.createdAt - b.createdAt; });
    return out;
  }
  function switchConversation(convId) {
    const base = convBaseKey();
    if (base === "__scene__") return;
    saveCurrentSlotNow();
    setActiveConv(base, convId || "");
    session.length = 0;
    clearUIRows();
    if (historyEnabled) restoreSessionIfEnabled();
    lastSlotKey = currentSlotKey();
    renderSummaryChip();
    updateSpacer();
    scrollToBottom();
    if (window.__navHideReset) window.__navHideReset(); // 4.75 切会话后复位顶栏
  }

  function createConversation(name) {
    const base = convBaseKey();
    if (base === "__scene__") return null;
    const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const meta = loadConvMeta();
    if (!meta[base]) meta[base] = {};
    meta[base][id] = { name: name || "新会话", createdAt: Date.now() };
    saveConvMeta(meta);
    switchConversation(id);
    return id;
  }
  function renameConversation(convId, name) {
    const base = convBaseKey();
    if (!convId) return;
    const meta = loadConvMeta();
    if (!meta[base]) meta[base] = {};
    meta[base][convId] = Object.assign({ createdAt: Date.now() }, meta[base][convId], { name: name || "新会话" });
    saveConvMeta(meta);
  }
  function deleteConversation(convId) {
    const base = convBaseKey();
    if (!convId || isMainConvId(convId)) return; // 4.79: 主对话(本机/他机)禁止删除,避免误删 + 跨设备墓碑
    try { const all = loadAllSessions(); delete all[base + "#" + convId]; if (Object.keys(all).length === 0) localStorage.removeItem(LS_CHAT_SESSION); else localStorage.setItem(LS_CHAT_SESSION, JSON.stringify(all)); } catch {}
    writeChatTombstone(base + "#" + convId); // 4.76: 删会话写墓碑,跨设备生效(否则另一台 pull 又把它并回来)
    const meta = loadConvMeta();
    if (meta[base] && meta[base][convId]) { delete meta[base][convId]; saveConvMeta(meta); }
    if (activeConvId(base) === convId) switchConversation("");
  }

  function initModels() {
    // 公有版:快速档=自定义直连(BYO)。配了端点时,主页下拉列拉取到的该厂商全系列模型(cfw_custom_models_v1),选中存 cfw_custom_model_v1。
    if (currentMode === "fast") {
      let _byo = null;
      try { _byo = JSON.parse(localStorage.getItem("cfw_byo_provider_v1") || "{}"); } catch (e) { _byo = null; }
      if (_byo && _byo.endpoint) {
        let _models = [];
        try { _models = JSON.parse(localStorage.getItem("cfw_custom_models_v1") || "[]"); } catch (e) { _models = []; }
        if (!Array.isArray(_models)) _models = [];
        if (!_models.length && _byo.model) _models = [_byo.model];
        modelSel.innerHTML = "";
        if (!_models.length) {
          const _opt = document.createElement("option");
          _opt.value = ""; _opt.textContent = "未拉取模型 · 去设置→模型API 拉取";
          modelSel.appendChild(_opt);
          modelSel.value = "";
          return;
        }
        for (const _id of _models) {
          const _opt = document.createElement("option");
          _opt.value = _id; _opt.textContent = _id;
          modelSel.appendChild(_opt);
        }
        const _picked = (localStorage.getItem("cfw_custom_model_v1") || "").trim();
        const _inList = _models.indexOf(_picked) >= 0;
        modelSel.value = _inList ? _picked : _models[0];
        if (!_inList) localStorage.setItem("cfw_custom_model_v1", _models[0]);
        return;
      }
    }
    const MODELS = currentMode === "fast" ? MODELS_FAST : MODELS_FREE;
    const DEFAULT = currentMode === "fast"
      ? (window.APP_DEFAULT_MODEL_FAST || MODELS_FAST[0]?.id)
      : (window.APP_DEFAULT_MODEL_FREE || MODELS_FREE[0]?.id);

    modelSel.innerHTML = "";
    for (const m of MODELS) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      modelSel.appendChild(opt);
    }
    const saved = localStorage.getItem(LS_MODEL);
    // 只在当前模式模型列表中才恢复已保存的值
    const savedInList = MODELS.some((m) => m.id === saved);
    modelSel.value = savedInList ? saved : DEFAULT;
  }

  modelSel.addEventListener("change", () => {
    localStorage.setItem(LS_MODEL, modelSel.value);
    // 公有版:快速档自定义直连时,主页下拉选中即记进 cfw_custom_model_v1(__byoProvider.get() 优先读它)
    if (currentMode === "fast") {
      let _byo = null;
      try { _byo = JSON.parse(localStorage.getItem("cfw_byo_provider_v1") || "{}"); } catch (e) {}
      if (_byo && _byo.endpoint && modelSel.value) localStorage.setItem("cfw_custom_model_v1", modelSel.value);
    }
  });

  personaToggle.addEventListener("click", () => {
    useBuiltin = !useBuiltin;
    // 已废弃死代码(紧接着被 setIcon 覆盖的无效赋值): personaToggle.textContent = useBuiltin ? "\u{1F608}" : "\u{1F607}";
    setIcon(personaToggle, useBuiltin ? "personaBuiltin" : "personaCustom", useBuiltin ? "解限" : "自定义"); // 2026-06-08: 解限/自定义 图标+文字标签
    localStorage.setItem(LS_USE_BUILTIN, useBuiltin ? "1" : "0");
  });

  // 面板开关由 settings.js 统一管理

  // Bug1 fix: 以上五个元素由 settings.js 动态挂载，IIFE 执行时均为 null。
  // 把事件绑定移入 wireHistoryUI()，在 DOMContentLoaded + setTimeout(0) 后执行，
  // 确保在 settings.js init()（同样在 DOMContentLoaded 里挂 card）完成之后再接线。
  function wireHistoryUI() {
    const _histEl  = document.getElementById("historyKeep");
    const _clrBtn  = document.getElementById("clearHistory");
    const _prmEl   = document.getElementById("promptKeep");
    const _custEl  = document.getElementById("customPrompt");
    const _saveBtn = document.getElementById("savePrompt");
    const _clrPBtn = document.getElementById("clearPrompt");
    if (_histEl) {
      _histEl.checked = historyEnabled;
      _histEl.addEventListener("change", () => {
        historyEnabled = !!_histEl.checked;
        localStorage.setItem(LS_HISTORY_ENABLED, historyEnabled ? "1" : "0");
        if (historyEnabled) {
          priorSummary = localStorage.getItem(LS_PRIOR_SUMMARY) || "";
          persistSessionIfEnabled();
        }
        renderSummaryChip();
      });
    }
    if (_clrBtn) {
      _clrBtn.addEventListener("click", () => {
        if (!confirm("确定清空【所有】本地对话历史？\n将删除本设备上全部角色/会话的对话记录与剧情摘要。\n（只想清当前角色请用左栏的「新对话」。）此操作不可撤销。")) return;
        try {
          const all = loadAllSessions();
          for (const _k of Object.keys(all)) writeChatTombstone(_k); // 4.78: 逐槽写删除墓碑,清空所有历史并跨设备生效
        } catch {}
        localStorage.removeItem(LS_CHAT_SESSION);
        try { localStorage.removeItem(LS_CONV_META); } catch {}   // 4.78: 清会话名
        try { localStorage.removeItem(LS_CONV_ACTIVE); } catch {} // 4.78: 清活跃会话指针
        localStorage.removeItem(LS_PRIOR_SUMMARY);
        localStorage.removeItem("cfw_summary_chip_hidden_v1");
        priorSummary = "";
        session.length = 0;
        clearUIRows();
        renderSummaryChip();
        updateSpacer();
        scrollToBottom();
      });
    }
    if (_prmEl) {
      _prmEl.checked = promptEnabled;
      _prmEl.addEventListener("change", () => {
        promptEnabled = !!_prmEl.checked;
        localStorage.setItem(LS_PROMPT_ENABLED, promptEnabled ? "1" : "0");
        if (!promptEnabled) localStorage.removeItem(LS_CUSTOM_PROMPT);
      });
    }
    if (_saveBtn) {
      _saveBtn.addEventListener("click", () => {
        const val = (_custEl && _custEl.value) || "";
        if (promptEnabled) localStorage.setItem(LS_CUSTOM_PROMPT, val);
        else localStorage.removeItem(LS_CUSTOM_PROMPT);
        if (settingsMask) settingsMask.style.display = "none";
      });
    }
    if (_clrPBtn) {
      _clrPBtn.addEventListener("click", () => {
        if (!confirm("确定清除网页自定义人物模板？")) return;
        localStorage.removeItem(LS_CUSTOM_PROMPT);
        if (_custEl) _custEl.value = "";
      });
    }
  }
  // settings.js 的 DOMContentLoaded(init) 先注册，app.js 后注册，顺序一致；
  // setTimeout(0) 确保在 settings.js init() 同步执行完（card 已挂载）后才接线。
  document.addEventListener("DOMContentLoaded", () => setTimeout(wireHistoryUI, 0));

  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = inputEl.scrollHeight + "px";
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  function setupResizeObserver() {
    if (!composerEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const stick = isNearBottom();
      updateSpacer();
      if (stick) scrollToBottom();
    });
    ro.observe(composerEl);
  }

  function setupViewportListener() {
    if (!window.visualViewport) return;
    window.visualViewport.addEventListener("resize", () => {
      const stick = isNearBottom();
      updateSpacer();
      if (stick) scrollToBottom();
    });
  }

  window.addEventListener("resize", () => {
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  // 2026-06-24 语音情绪白名单(普通对话路径):库里有已填情绪音时,把「当前可用情绪清单」作为追加层注入,
  // 让 LLM 只从你真正配了参考音的情绪里挑 [情绪:强度] 标签,不会乱发库里没有的情绪(决策 M 的普通对话侧补齐;
  // 自驱 RP 早已在 autopilot.emotionWhitelist 做了同样的收口)。
  // 收口条件:① 非 agent 工作模式(isAgentModeOn 时跳过,免得污染工具语气) ② 桌面 App(网页版没本地 TTS)
  // ③ 情绪库有已填条目(hasEntries)。任一不满足 → 返回空串,完全不注入,行为同改动前。
  // 红线:纯追加层,不碰解限 base PROMPT_1/2/3。标签为可选,不强制每句都加。
  function emotionTagDirective() {
    try {
      if (isAgentModeOn()) return "";
      const inApp = !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
      if (!inApp) return ""; // 情绪音库是桌面本地 TTS 专属,网页版不注入,免得正文冒出念不出来的标签
      const te = window.__ttsEmotion;
      if (!te || typeof te.hasEntries !== "function" || !te.hasEntries()) return "";
      const tags = (typeof te.listTags === "function" ? te.listTags() : []) || [];
      if (!tags.length) return "";
      const wl = tags.map(t => t.emotion + ":" + ((t.levels || []).join("/"))).filter(Boolean).join("、");
      if (!wl) return "";
      return "【语音情绪标签·可选】当某句话适合用特定情绪语气朗读时,可在该句句首加一个 [情绪:强度] 标签(强度 1弱/2中/3强);情绪只能从下列已配好参考音的清单里选:" + wl + "。清单里没有的情绪不要用(用了也只会回退默认音色)。不必每句都加、不要硬凑,平铺直叙时留空即可。";
    } catch (e) { return ""; }
  }

  // Phase 4 阶段 6：从 LS 读取启用的预设，按 order 排序，filter enabled，COT 在快速(DeepSeek)模式下自动禁用
  // 2026-06-24: 末尾追加「语音情绪白名单」(emotionTagDirective),让普通对话的情绪标签也收口到已填情绪。
  function getExtraSystemPrompts(mode) {
    const emo = emotionTagDirective();
    const join2 = (a, b) => (a && b) ? (a + "\n\n" + b) : (a || b);
    try {
      const raw = localStorage.getItem(LS_PROMPT_PRESETS);
      if (!raw) return emo;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return emo;
      const isDeepSeek = mode === "fast";
      const enabled = arr
        .filter(p => p && p.enabled && typeof p.content === "string" && p.content.trim())
        .filter(p => !(isDeepSeek && p.name === "COT"))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(p => p.content.trim());
      return join2(enabled.join("\n\n"), emo);
    } catch { return emo; }
  }

  // ─── 内核接线 v1:Agent 内核模式(function-calling + agent loop) ───
  // dev 开关 cfw_agent_mode_v1 开启 且 内核 SDK(/shared/agent-kernel.js + /shared/tools.js)已加载时,
  // sendOne 改走 sendOneAgent:让模型自主调用 send_image / adjust_affinity / use_prop 等工具,
  // 由 AgentKernel.runAgentLoop 驱动多轮 tool 调用。默认关 → 保持原流式 sendOne 零回归。
  // 控制台开:__dev.setAgentMode(true)
  function isAgentModeOn() {
    return (localStorage.getItem("cfw_agent_mode_v1") ?? "0") === "1"
      && !!(window.AgentKernel && window.OmnigentTools);
  }

  // 2026-06-21 Bug:agent「不爱用工具/糊弄/抓网页能力差」——给 agent 模式追加强硬「工具使用纲领」。
  // 仅 agent 路径,经 worker 拼进 system prompt;不碰解限 base PROMPT_1/2/3。
  const AGENT_TOOL_USE_DIRECTIVE = "\n\n【工具使用纲领·必读】你已接入真实可用的联网与本地工具,默认就该主动调用,绝不能凭记忆臆测或编造结果。\n1. 需要网上的网页/文件/资料时:已知或能推断 URL → 必须真的调用 fetch_page 抓取原文后再作答;不知道 URL → 先用 web_search 找到链接,再 fetch_page 读取。严禁假装读过某页或杜撰其内容。\n2. 抓取或搜索失败时,如实说明失败,可改用 fetch_page / web_search,或调 reach_diagnose 自检后重试;不要假装成功,也不要用「我无法联网」搪塞——你确实能联网。\n3. 多步任务要连续多轮调用工具直到真正完成再收尾,中途不要糊弄或跳步。\n4. 仅在确有必要时才用付费深度搜索(web_search deep=true);一般信息用默认免费搜索即可。";

  async function sendOneAgent(opts) {
    if (isSending) return null;
    const opts0 = opts || {};
    const isAuto = opts0.text != null;
    updateSpacer();
    const text = isAuto ? String(opts0.text).trim() : inputEl.value.trim();
    const allowEmpty = !!opts0.allowEmptyText;
    if (!text && !allowEmpty) return null;

    // Vision input：读取待发附图（由 window.__agentPendingImage 设置；取走即清，下轮不污染）
    let _visionImage = null;
    let _visionConsumed = false;
    try {
      if (window.__agentPendingImage) { _visionImage = window.__agentPendingImage; window.__agentPendingImage = null; }
    } catch (_) {}

    isSending = true;
    sendBtn.disabled = true;

    const myGen = ++sendGen;
    const controller = new AbortController();
    currentController = controller;

    // 用户气泡 + 入 session(与 sendOne 输入处理一致)
    if (text) {
      const userRow = makeRow("user");
      userRow.bubble.textContent = text;
      // Vision：有附图时在用户气泡下方预览缩略图
      if (_visionImage) {
        try {
          const _vi = document.createElement('img');
          _vi.src = _visionImage;
          _vi.style.cssText = 'max-width:220px;max-height:180px;border-radius:8px;display:block;margin-top:6px;object-fit:cover;';
          userRow.bubble.appendChild(_vi);
        } catch (_) {}
      }
      const inEst = estimateTokens(text);
      totalInEstimate += inEst;
      userRow.stats.textContent = `Input(估算): ≈${inEst} | Total In(估算): ≈${totalInEstimate}`;
      session.push({ role: "user", content: text });
      persistSessionIfEnabled();
    }
    if (!isAuto) {
      inputEl.value = "";
      inputEl.style.height = "auto";
    }
    updateSpacer();
    scrollToBottom();

    // 角色卡 / 关系 / 好感 等上下文(对齐 sendOne 的 /api/chat payload)
    const ch = window.__character || null;
    const characterCard = opts0.asCard
      ? opts0.asCard
      : (ch && ch.getActiveCard ? ch.getActiveCard() : null);
    const relation = ch && ch.getActiveRelation ? ch.getActiveRelation() : "default";
    const emotion = ch && ch.getActiveEmotion ? ch.getActiveEmotion() : "neutral";
    const affection = ch && ch.getActiveAffection ? ch.getActiveAffection() : null;
    const activeProps = (window.__props && window.__props.getActivePropsForWorker) ? window.__props.getActivePropsForWorker() : [];
    let customPrompt = "";
    if (!useBuiltin && promptEnabled) customPrompt = localStorage.getItem(LS_CUSTOM_PROMPT) || "";
    const snapshotMode  = currentMode;
    const snapshotModel = modelSel.value;

    const aiRow = makeRow("assistant", { side: opts0.side || null });
    setStreamingUI(aiRow.rowEl, true);
    if (window.__character && window.__character.decorateAiRow) {
      window.__character.decorateAiRow(aiRow.rowEl, characterCard);
    }
    aiRow.bubble.textContent = "思考中…"; // 4.71: 去掉 🧠

    // 4.73 Agent 思考复用聊天「思考过程」折叠框:把 agent loop 的模型推理 + 工具步骤汇总进本条 AI 的折叠块,
    // 右栏控制台只显简洁状态/操作。两边共享同一份 onEvent 事件流,折叠块按聊天「思考过程显示」设置 show/collapse/hide。
    const _agentReasonLines = [];
    function _briefAgentArgs(a) {
      try { var s = JSON.stringify(a); return s.length > 80 ? s.slice(0, 77) + "…" : s; } catch (e) { return ""; }
    }
    function _renderAgentReasoning() {
      if (!aiRow.reasoning) return;
      const rt = aiRow.reasoning.querySelector(".reasoning-text");
      if (!rt) return;
      rt.textContent = _agentReasonLines.join("\n");
      if (getThinkDisplay() === "hide") { aiRow.reasoning.style.display = "none"; return; }
      aiRow.reasoning.style.display = "";
      aiRow.reasoning.open = true; // 运行期间默认展开看进度,结束后由 applyThinkDisplay 按设置收起
    }

    let finalText = "";
    // 4.79 中断兜底:把 callModel 流式已收到的可见正文同步到外层,abort 时不至于丢失半截回复
    let _lastAgentContent = "";
    // 2026-06-20 工具轮前置正文累积:模型在调用工具的那一轮里常先写一段正文(问候/道歉/说明),
    // 旧版 _renderLive 一见 tool_calls 就停更、下一轮又覆盖气泡 → 这段被吞,只剩 dev 入站流可见。
    // 这里把每个「带工具调用且有正文」的轮次正文累积起来,实时渲染+最终落地都带上,杜绝吞话。
    let _agentPreamble = "";
    try {
      // 工具注册表:发图回调把生成的图片渲染成图片气泡(插在本条 AI 之后)
      const registry = window.OmnigentTools.buildRegistry({
        onImage: (url, meta) => {
          // send_image 工具已通过 __chatImage.sendPhoto 生成图片并拿到 URL，直接渲染气泡，不重复生成
          // Bug fix 2026-06-18: 旧版把 url 字符串当对象取 .scene_prompt → scene="" → handleSignal 拿空 scene 无渲染
          // 且 handleSignal 会触发二次出图而非展示已有 URL；现改为直接插 <img> 气泡。
          try {
            if (url && typeof url === 'string') {
              const _imgRow = document.createElement('div');
              _imgRow.className = 'row ai';
              const _imgAv = document.createElement('div');
              _imgAv.className = 'avatar bot';
              _imgAv.textContent = (characterCard && characterCard.icon) || '🙂';
              const _imgContent = document.createElement('div');
              _imgContent.className = 'content';
              const _imgEl = document.createElement('img');
              _imgEl.src = url;
              _imgEl.style.cssText = 'max-width:280px;max-height:320px;border-radius:12px;display:block;object-fit:cover;cursor:pointer;margin:2px 0;';
              _imgEl.onclick = function() { try { window.open(url, '_blank'); } catch (_) {} };
              _imgEl.onerror = function() { _imgRow.style.display = 'none'; };
              _imgContent.appendChild(_imgEl);
              _imgRow.appendChild(_imgAv);
              _imgRow.appendChild(_imgContent);
              // 插在当前 AI row 之后（若可以），否则插在 spacer 前
              var _afterRef = (aiRow && aiRow.rowEl && aiRow.rowEl.nextSibling) || spacerEl;
              chatEl.insertBefore(_imgRow, _afterRef);
              if (isNearBottom()) scrollToBottom();
            }
          } catch (_ie) {}
          // 画廊存储兜底（sendPhoto 内部通常已保存；此处兜直传 URL 路径）
          try {
            var _gurl = (typeof url === 'string' ? url : null) || (meta && (meta.url || meta.imageUrl || meta.result_url));
            if (_gurl) {
              if (window.__gallery && typeof window.__gallery.add === 'function') {
                window.__gallery.add({ url: _gurl, source: 'agent', ts: Date.now() });
              } else if (window.__imageGallery && typeof window.__imageGallery.save === 'function') {
                window.__imageGallery.save({ url: _gurl, source: 'agent', ts: Date.now() });
              }
            }
          } catch (_) {}
        },
      });
      // 2026-06-16 Agent-Reach Skill:追加联网工具(fetch_page/web_search/search_bilibili/search_github/read_rss)
      // Bug4 fix: tools.js 曾重复定义 web_search，registry.define 对重名 throw 导致 AgentReach.defineTools 后续工具全部漏注册。加 try-catch 防止单个注册失败崩掉整个 Reach 工具链。
      if (window.AgentReach && typeof window.AgentReach.defineTools === "function") {
        try { window.AgentReach.defineTools(registry); } catch (e) { console.warn('[AgentReach] defineTools 部分失败:', e); }
      }
      // 2026-06-18 自检工具:追加 self_diagnostics(环境快照 + 加载完整性 + 联网逐环节自检;联网部分委托 AgentReach.diagnose)。只读、非破坏,失败不影响其余工具
      let _envSnap = "";
      if (window.__envContext && typeof window.__envContext.defineTools === "function") {
        try {
          window.__envContext.defineTools(registry);
          // 系统感知快照注入：每轮携带最新日期/时区/平台/在线状态/已装工具列表。
          // 2026-06-18 原意:systemPrompt 未声明会 ReferenceError 被 catch 吞 → 快照永不注入,故改写入 _envSnap 在 callModel 里拼进 extraSystemPrompts。
          // 2026-06-19 审查整理:原版 defineTools 与下面的 if 挤在一行靠 ASI(自动插分号)续命,结构脆弱易被压缩/格式化破坏 → 改为显式分句,行为不变。
          if (typeof window.__envContext.snapshotText === "function") {
            try { _envSnap = window.__envContext.snapshotText({ registry }); } catch (_se) {}
          }
        } catch (e) { console.warn('[env-context] defineTools 失败:', e); }
      }

      // callModel(messages, schemas):4.77 改流式打 /api/chat(stream:true),边收边把最终答复渲染进气泡 + 增量重组 tool_calls,回传与原非流式同形状的 message(含 tool_calls)。worker /api/chat 已支持流式带 tools(透传 tools + 原样吐 tool_calls delta),故内核与 worker 均不用动。
      const callModel = async (messages, schemas) => {
        // Vision：首轮把附图注入最后一条 user 消息（仅消费一次，后续轮不重复注入）
        let _msgsToSend = messages;
        if (_visionImage && !_visionConsumed) {
          _visionConsumed = true;
          _msgsToSend = messages.map((_vm, _vi) => {
            if (_vi === messages.length - 1 && _vm.role === 'user') {
              const _t = typeof _vm.content === 'string' ? _vm.content : '';
              return { ..._vm, content: [{ type: 'text', text: _t }, { type: 'image_url', image_url: { url: _visionImage } }] };
            }
            return _vm;
          });
        }
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            stream: true, // 4.77: agent 改流式(原 false → 边收边渲染 + 增量重组 tool_calls);worker 流式已透传 tools/吐 tool_calls delta
            tools: schemas,
            tool_choice: "auto",
            mode: snapshotMode,
            model: snapshotModel,
            use_builtin_persona: useBuiltin,
            custom_system_prompt: customPrompt,
            characterCard,
            // Agent 模式只需角色人格，不注入 RP 亲密度/情绪/道具/剧情摘要（会污染工具调用语气）
            relation: "default",
            emotion: "neutral",
            affection: null,
            activeProps: [],
            priorSummary: "",
            extraSystemPrompts: getExtraSystemPrompts(snapshotMode) + (_envSnap ? "\n\n" + _envSnap : "") + AGENT_TOOL_USE_DIRECTIVE + (window.__skills && window.__skills.getEnabledPrompt ? window.__skills.getEnabledPrompt() : ""),
            thinking: (snapshotMode === "fast" && thinkingOn) ? "enabled" : "disabled",
            strictRoleplay: (localStorage.getItem("cfw_strict_roleplay_v1") ?? "0") === "1",
            nsfwLevel: parseInt(localStorage.getItem("cfw_nsfw_mode_v1") || "0", 10) || 0,
            devForceComply: (localStorage.getItem("cfw_dev_force_comply_v1") ?? "0") === "1",
            replyStyle: localStorage.getItem("cfw_reply_style_v1") || "default",
            customProvider: (window.__byoProvider && window.__byoProvider.get && window.__byoProvider.get()) || undefined, // 4.69 BYO 自定义 API 直传
            messages: _msgsToSend,
          }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error("Request failed (" + res.status + "): " + t);
        }
        // 4.77: 流式解析 SSE,边收边把"最终答复"渲染进气泡;增量重组 content / reasoning_content / tool_calls。
        // 复用 sendOne 的 sseBuf 行缓冲防跨 chunk 掉字;心跳(": ping")与调试(": __dbg__")注释行非 "data: " 开头自动跳过。
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let _sseBuf = "";
        let _content = "";
        let _reasoning = "";
        let _usage = null;
        const _toolMap = {}; // index -> { id, type, function:{ name, arguments } }
        let _lastLiveMs = 0;
        const _renderLive = () => {
          // 工具轮 content 通常为空;一旦出现 tool_calls 迹象就不再把半截正文当答复刷进气泡
          if (Object.keys(_toolMap).length) return;
          const _now = performance.now();
          if (_now - _lastLiveMs < 70) return;
          _lastLiveMs = _now;
          const _disp = stripPhotoSignalLive(stripJailbreakPrefix(stripThinkBlocks(_content)));
          // 2026-06-20 修:工具轮之前模型先吐的正文(如"抱歉…")要留住——把已累积的 preamble 段拼在实时正文前,
          // 否则下一轮 callModel 覆盖气泡时这段会被吞掉(只剩 dev 面板入站流能看到)。
          const _shown = _agentPreamble ? (_agentPreamble + (_disp ? "\n\n" + _disp : "")) : _disp;
          if (_shown) aiRow.bubble.textContent = _shown;
        };
        const _handleParsed = (parsed) => {
          if (parsed.usage) _usage = parsed.usage;
          const d = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          if (!d) return;
          if (typeof d.reasoning_content === "string" && d.reasoning_content) _reasoning += d.reasoning_content;
          if (typeof d.content === "string" && d.content) { _content += d.content; _lastAgentContent = _content; _renderLive(); }
          if (Array.isArray(d.tool_calls)) {
            for (const tc of d.tool_calls) {
              const idx = (typeof tc.index === "number") ? tc.index : 0;
              const slot = _toolMap[idx] || (_toolMap[idx] = { id: "", type: "function", function: { name: "", arguments: "" } });
              if (tc.id) slot.id = tc.id;
              if (tc.type) slot.type = tc.type;
              if (tc.function) {
                if (tc.function.name) slot.function.name = tc.function.name;
                if (typeof tc.function.arguments === "string") slot.function.arguments += tc.function.arguments;
              }
            }
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) { _sseBuf += decoder.decode(); break; }
          _sseBuf += decoder.decode(value, { stream: true });
          let _nl;
          while ((_nl = _sseBuf.indexOf("\n")) >= 0) {
            const line = _sseBuf.slice(0, _nl);
            _sseBuf = _sseBuf.slice(_nl + 1);
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try { _handleParsed(JSON.parse(jsonStr)); } catch {}
          }
        }
        // 残行兜底:服务端最后一个 data 事件可能不带结尾 \n(同 sendOne Bug⑦ 修法)
        if (_sseBuf.trim()) {
          const line = _sseBuf.trim();
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr && jsonStr !== "[DONE]") { try { _handleParsed(JSON.parse(jsonStr)); } catch {} }
          }
        }
        // 按 index 升序重组完整 tool_calls;丢弃没拼出 name 的空槽,缺 id 时补一个(上游偶发不下发 id)
        const _toolCalls = Object.keys(_toolMap)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => _toolMap[k])
          .filter((t) => t && t.function && t.function.name)
          .map((t) => ({ id: t.id || ("call_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), type: t.type || "function", function: { name: t.function.name, arguments: t.function.arguments || "" } }));
        // 2026-06-17 agent 模式记账:流式末尾 stream_options.include_usage 带回 usage,快速模式按量补记(逐轮累加)
        try {
          if (snapshotMode === "fast" && _usage) {
            const _p = _usage.prompt_tokens || 0;
            const _c = _usage.completion_tokens || 0;
            const _cached = _usage.prompt_cache_hit_tokens || 0;
            const _cost = calcCost(snapshotModel, _p, _c, _cached);
            if (_cost > 0) {
              totalCostCNY += _cost;
              totalPromptTokens += _p;
              totalCompletionTokens += _c;
              addCostToToday(_cost, _p, _c);
              updateCostDisplay();
            }
          }
        } catch (e) {}
        const _msg = { role: "assistant", content: _content };
        if (_toolCalls.length) _msg.tool_calls = _toolCalls;
        // 2026-06-20:本轮若「既有正文又要调工具」,正文是面向用户的前置话(问候/道歉/说明),累积下来,
        // 供最终气泡和 session 落地时拼回,避免被后续轮次覆盖吞掉。
        if (_toolCalls.length && _content && _content.trim()) {
          const _pre = stripResidualMarkup(stripJailbreakPrefix(stripThinkBlocks(_content)));
          if (_pre && _pre.trim()) _agentPreamble += (_agentPreamble ? "\n\n" : "") + _pre.trim();
        }
        if (_reasoning) _msg.reasoning_content = _reasoning;
        // 4.73 捕获本轮模型推理(思考模式 reasoning_content + 正文内联 <think>)汇入折叠框
        try {
          const _rc = (_reasoning || "").trim();
          const _inlineTh = extractThinkText(_content || "");
          const _piece = [_rc, _inlineTh].filter(Boolean).join("\n");
          if (_piece) { _agentReasonLines.push(_piece); _renderAgentReasoning(); }
        } catch (e) {}
        return _msg;
      };

      // kernel 在 messages 里 push assistant/tool 消息;起始喂当前 session 的浅拷贝
      const startMessages = session.map(m => ({ role: m.role, content: m.content }));
      // 4.69 控制台接线 + 子 agent 编排:把右栏 agent 控制台的 onEvent/ensurePermission 喂进内核,
      // 并把 callModel/onEvent/depth 透传进 context,供 delegate_to_agent 派生子 agent 时复用。
      const _ac = window.__agentConsole || null;
      const _consoleOnEvent = (_ac && typeof _ac.onEvent === "function") ? _ac.onEvent : function () {};
      // 右栏控制台收完整工具时间线；聊天折叠框只收模型真实推理（reasoning_content / <think>），不重复工具步骤。
      // write_file 完成时在聊天区插文件卡（tool_run 时缓存 args，tool_done 时渲染）
      var _writeFilePendingArgs = null;
      const _onEvent = (ev) => {
        try { _consoleOnEvent(ev); } catch (e) {}
        // Bug1 fix: 思考模式关时 _agentReasonLines 为空 → 折叠块被隐藏。把工具步骤摘要也写入，保证折叠块总有内容可展示。
        try {
          if (ev.type === 'tool_run' && ev.name) {
            const _ab = _briefAgentArgs(ev.args || {});
            _agentReasonLines.push('▶ ' + ev.name + (_ab ? '  ' + _ab : ''));
            _renderAgentReasoning();
            if (ev.name === 'write_file' && ev.args) _writeFilePendingArgs = ev.args; // 缓存文件参数
          } else if (ev.type === 'tool_done' && ev.name) {
            for (var _ri = _agentReasonLines.length - 1; _ri >= 0; _ri--) {
              if (_agentReasonLines[_ri].startsWith('▶ ' + ev.name)) { _agentReasonLines[_ri] += ' ✓'; _renderAgentReasoning(); break; }
            }
            // write_file 完成→聊天区插文件卡（避免静默保存无感知）
            if (ev.name === 'write_file') {
              try {
                var _fa = _writeFilePendingArgs || {}; _writeFilePendingArgs = null;
                var _fn = String(_fa.filename || '文件').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                var _fc = String(_fa.content || '').length;
                var _fcard = document.createElement('div');
                _fcard.className = 'agent-file-card';
                _fcard.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;margin:6px 0 6px 44px;border:1px solid rgba(127,127,127,.2);border-radius:10px;background:rgba(127,127,127,.06);font-size:13px;max-width:380px;color:inherit;box-sizing:border-box;';
                _fcard.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;opacity:.65"><path d="M13.5 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5z"/><path d="M13.5 4v5.5H19"/></svg><span>已生成文件：<b>' + _fn + '</b>（' + _fc + ' 字符）</span>';
                chatEl.insertBefore(_fcard, spacerEl);
                // CSV 内联预览：.csv 文件自动渲染为表格（最多显示 20 行）
                if (/\.csv$/i.test(_fa.filename || '') && _fa.content) {
                  try {
                    var _csvRows = String(_fa.content).trim().split('\n').map(function(r) {
                      return r.split(',').map(function(c) { return c.replace(/^"|"$/g, '').trim(); });
                    });
                    if (_csvRows.length > 1 && _csvRows[0].length > 0) {
                      var _csvWrap = document.createElement('div');
                      _csvWrap.style.cssText = 'margin:2px 0 8px 44px;max-width:680px;overflow-x:auto;border:1px solid rgba(127,127,127,.15);border-radius:8px;font-size:12px;';
                      var _thCells = _csvRows[0].map(function(h) {
                        return '<th style="padding:5px 10px;border-bottom:1px solid rgba(127,127,127,.2);border-right:1px solid rgba(127,127,127,.1);background:rgba(127,127,127,.07);white-space:nowrap;font-weight:600;">' + String(h).replace(/</g,'&lt;') + '</th>';
                      }).join('');
                      var _tdRows = _csvRows.slice(1, 21).map(function(row) {
                        return '<tr>' + row.map(function(c) {
                          return '<td style="padding:4px 10px;border-bottom:1px solid rgba(127,127,127,.08);border-right:1px solid rgba(127,127,127,.08);">' + String(c).replace(/</g,'&lt;') + '</td>';
                        }).join('') + '</tr>';
                      }).join('');
                      var _foot = _csvRows.length > 21 ? '<tr><td colspan="' + _csvRows[0].length + '" style="padding:4px 10px;opacity:.5;">… 共 ' + (_csvRows.length-1) + ' 行，显示前 20 行</td></tr>' : '';
                      _csvWrap.innerHTML = '<table style="border-collapse:collapse;min-width:max-content;width:100%;"><thead><tr>' + _thCells + '</tr></thead><tbody>' + _tdRows + _foot + '</tbody></table>';
                      chatEl.insertBefore(_csvWrap, spacerEl);
                    }
                  } catch (_ce) {}
                }
                if (isNearBottom()) scrollToBottom();
              } catch (_fe) {}
            }
          } else if (ev.type === 'tool_error' && ev.name) {
            for (var _ri2 = _agentReasonLines.length - 1; _ri2 >= 0; _ri2--) {
              if (_agentReasonLines[_ri2].startsWith('▶ ' + ev.name)) { _agentReasonLines[_ri2] += ' ✗'; _renderAgentReasoning(); break; }
            }
          }
        } catch (_) {}
      };
      const _ensurePermission = (_ac && typeof _ac.ensurePermission === "function") ? _ac.ensurePermission : undefined;
      const result = await window.AgentKernel.runAgentLoop({
        messages: startMessages,
        registry,
        callModel,
        context: { characterCard, callModel, onEvent: _onEvent, ensurePermission: _ensurePermission, depth: 0 },
        onEvent: _onEvent,
        ensurePermission: _ensurePermission,
      });
      finalText = (result && result.finalText) || "";
    } catch (e) {
      if (e.name === "AbortError") {
        // 4.79 中断兜底:流被掐断(新发一条/停止/重试/删除/pacing/切角色)时,不再裸 return 丢掉半截,
        // 而是把已收到的可见正文清洗后定格为最终态并入 session(对齐普通 sendOne 的 partialStream 兜底)。
        if (myGen === sendGen) {
          try {
            const _salvBody = stripResidualMarkup(stripJailbreakPrefix(stripThinkBlocks(_lastAgentContent || "")));
            // 2026-06-20:中断兜底也带上工具轮前置正文,避免 abort 时把已说的问候/道歉一并丢掉。
            const _salv = _agentPreamble ? (_agentPreamble + (_salvBody ? "\n\n" + _salvBody : "")) : _salvBody;
            if (_salv && _salv.trim()) {
              aiRow.bubble.innerHTML = renderMarkdownSafe(_salv);
              const _am = { role: "assistant", content: _salv };
              if (_agentReasonLines.length) _am.reasoning_content = _agentReasonLines.join("\n");
              if (characterCard) { _am.speakerId = characterCard.id; _am.speakerName = characterCard.name; _am.speakerIcon = characterCard.icon || "🙂"; }
              session.push(_am);
              persistSessionIfEnabled();
            }
          } catch (_se) {}
          isSending = false; sendBtn.disabled = false; if (currentController === controller) currentController = null;
        }
        setStreamingUI(aiRow.rowEl, false);
        return;
      }
      if (myGen === sendGen) aiRow.bubble.textContent = "网络错误: " + e.message;
      finalText = "";
    } finally {
      if (myGen === sendGen) {
        isSending = false;
        sendBtn.disabled = false;
        if (currentController === controller) currentController = null;
      }
      setStreamingUI(aiRow.rowEl, false);
    }

    if (myGen !== sendGen) return;

    // 渲染最终回复(复用 sendOne 清洗:去思考块 / 哨兵前缀 / 残括号)
    let _finalBody = stripResidualMarkup(stripJailbreakPrefix(stripThinkBlocks(finalText)));
    // 2026-06-20:把工具轮前置正文(问候/道歉/说明)拼在最终答复之前,完整呈现+持久化,不再被吞。
    let full = _agentPreamble ? (_agentPreamble + (_finalBody ? "\n\n" + _finalBody : "")) : _finalBody;
    // Agent 回复用 innerHTML 渲染 Markdown（代码块/表格/标题/粗体）
    if (full) { aiRow.bubble.innerHTML = renderMarkdownSafe(full); } else { aiRow.bubble.textContent = "(无内容)"; }
    // 4.73 agent 运行结束:思考折叠块按「思考过程显示」设置回落(show 展开 / collapse 折叠 / hide 隐藏)
    if (aiRow.reasoning) applyThinkDisplay(aiRow.reasoning);

    // 好感标签解析(与 sendOne 一致;工具 adjust_affinity 已可由模型直接调,此处兜底文本标签)
    if (ch && ch.parseAffectionTag) {
      const tagRes = ch.parseAffectionTag(full);
      if (tagRes.delta && affection !== null) { try { await ch.adjustActiveAffection(tagRes.delta); } catch {} }
      if (tagRes.stripped !== full) { full = tagRes.stripped; aiRow.bubble.innerHTML = renderMarkdownSafe(full); }
    }

    const asMsg = { role: "assistant", content: full };
    if (_agentReasonLines.length) asMsg.reasoning_content = _agentReasonLines.join("\n"); // 4.73 思考归档随会话持久化,刷新后仍可展开
    if (characterCard) {
      asMsg.speakerId = characterCard.id;
      asMsg.speakerName = characterCard.name;
      asMsg.speakerIcon = characterCard.icon || "🙂";
    }
    session.push(asMsg);
    persistSessionIfEnabled();

    if (window.__props && window.__props.tickAfterTurn) {
      try { window.__props.tickAfterTurn(); } catch {}
    }
    updateSpacer();
    scrollToBottom();
    return full;
  }

  // sendOne(opts):核心发送逻辑,可由鱼缸引擎(fishbowl-engine.js)驱动
  // opts: { text?, allowEmptyText?, fishbowlMode?, topic?, asCard? }
  // 不传 opts.text 时从 inputEl 取;返回 AI 完整回复文本,失败/中断返回 null/undefined
  async function sendOne(opts) {
    if (isSending) return null;
    // 内核接线 v1:Agent 内核模式开启时改走 sendOneAgent(function-calling + agent loop);默认关走原流式路径
    if (isAgentModeOn()) {
      return await sendOneAgent(opts);
    }
    const opts0 = opts || {};
    const isAuto = opts0.text != null;
    updateSpacer();
    const text = isAuto ? String(opts0.text).trim() : inputEl.value.trim();
    const allowEmpty = !!opts0.allowEmptyText;
    if (!text && !allowEmpty) return null;

    isSending = true;
    sendBtn.disabled = true;

    // 阶段 4-③：长对话自动压缩早期历史为剧情摘要后再发送
    if (historyEnabled && summaryEnabled && !summarizing && session.length > summaryTrigger) {
      const prevCostText = costDisplayEl ? costDisplayEl.textContent : "";
      try {
        summarizing = true;
        if (costDisplayEl) costDisplayEl.textContent = "正在压缩早期历史…"; // 4.71: 去掉 📚
        const cutoff = Math.max(0, session.length - summaryKeep);
        const toSum = session.slice(0, cutoff);
        const chEarly = window.__character || null;
        const cardEarly = chEarly && chEarly.getActiveCard ? chEarly.getActiveCard() : null;
        const r = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: toSum, priorSummary, characterName: cardEarly ? cardEarly.name : "" }),
        });
        if (r.ok) {
          const j = await r.json().catch(() => null);
          if (j && typeof j.summary === "string" && j.summary.trim()) {
            priorSummary = j.summary.trim();
            localStorage.setItem(LS_PRIOR_SUMMARY, priorSummary);
            localStorage.removeItem("cfw_summary_chip_hidden_v1");
            const allRows = Array.from(chatEl.children).filter(n => n !== spacerEl && n.classList && n.classList.contains("row"));
            const removeN = Math.min(cutoff, allRows.length);
            for (let i = 0; i < removeN; i++) chatEl.removeChild(allRows[i]);
            session.splice(0, cutoff);
            persistSessionIfEnabled();
            renderSummaryChip();
          }
        }
      } catch (e) {
        console.warn("auto-summarize failed:", e);
      } finally {
        summarizing = false;
        if (costDisplayEl) costDisplayEl.textContent = prevCostText;
        updateCostDisplay();
      }
    }

    const myGen = ++sendGen;
    const controller = new AbortController();
    currentController = controller;
    partialStream = { full: "", fullReasoning: "", speakerId: "", speakerName: "", speakerIcon: "" };

    // 鱼缸 V3:text 为空(allowEmptyText 模式下,鱼缸引擎驱动 / 群聊点角色 chip 直发)时
    // 跳过创建 user row,直接进 AI —— 消灭空 User 气泡污染观感
    if (text) {
      const userRow = makeRow("user");
      userRow.bubble.textContent = text;
      const inEst = estimateTokens(text);
      totalInEstimate += inEst;
      userRow.stats.textContent = `Input(估算): ≈${inEst} | Total In(估算): ≈${totalInEstimate}`;
      session.push({ role: "user", content: text });
      persistSessionIfEnabled();
    }
    if (!isAuto) {
      inputEl.value = "";
      inputEl.style.height = "auto";
    }
    updateSpacer();
    scrollToBottom();

    const aiRow = makeRow("assistant", { side: opts0.side || null });
    setStreamingUI(aiRow.rowEl, true);
    // 4.19 P2 fix: decorate 调用挪到 characterCard 定义之后（修 TDZ ReferenceError —— 1293 漏看变量声明顺序导致 sendOne 一进去就抛错，普通发送/接龙/鱼缸全死）
    let outStartMs = 0;
    let outEndMs = 0;
    let full = "";
    let fullReasoning = "";
    let reasoningCollapsed = false;
    let _lastLiveRenderMs = 0; // 4.70 流式渲染节流时间戳(降 O(n²) 重算)
    let exactUsage = null;
    let customPrompt = "";

    if (!useBuiltin && promptEnabled) {
      customPrompt = localStorage.getItem(LS_CUSTOM_PROMPT) || "";
    }

    // 角色卡数据（由 character.js 提供；Worker 端 buildSystemPrompt 用三层架构拼接）
    const ch = window.__character || null;
    // 鱼缸引擎驱动时用 opts.asCard 强制指定发言者(避免 active card 被切换造成错位)
    const characterCard = opts0.asCard
      ? opts0.asCard
      : (ch && ch.getActiveCard ? ch.getActiveCard() : null);
    // 4.19 P1 fix: 显式传 characterCard —— setActiveId 是异步 (await IndexedDB),
    // 鱼缸下一轮 setActive 后立刻进 sendOne,decorate 读模块级 _card 会拿到上一轮 → label 偏移
    // 4.19 P2 fix: 这段必须放在 const characterCard 定义之后,否则 TDZ ReferenceError 整个 sendOne 挂掉
    if (window.__character && window.__character.decorateAiRow) {
      window.__character.decorateAiRow(aiRow.rowEl, characterCard);
    }
    const relation = ch && ch.getActiveRelation ? ch.getActiveRelation() : "default";
    const emotion = ch && ch.getActiveEmotion ? ch.getActiveEmotion() : "neutral";
    const affection = ch && ch.getActiveAffection ? ch.getActiveAffection() : null;
    const activeProps = (window.__props && window.__props.getActivePropsForWorker) ? window.__props.getActivePropsForWorker() : [];
    const sceneOtherNames = (window.__multi && window.__multi.getSceneOtherNames) ? window.__multi.getSceneOtherNames() : [];
    // 4.52 在场感 part2:仅在群聊驱动场景(编排≥2 / 接龙 / 讨论)下,把"可召唤的场景外角色"喂给 worker,让 AI 能 [召唤:X] 叫人入场
    const _summonActive = isGroupChatActive() || (opts0.fishbowlMode && opts0.fishbowlMode !== "orchestrate");
    const summonableNames = (_summonActive && window.__multi && window.__multi.getSummonableNames)
      ? window.__multi.getSummonableNames(characterCard ? characterCard.id : "")
      : [];
    // 阶段 4-②：好感度阈值事件（一次性，发送成功后立即清空）
    const thresholdEvents = (ch && ch.getPendingThresholdEvents) ? ch.getPendingThresholdEvents() : [];
    // 4.49 P3 世界书：按最近对话文本 + 当前角色卡 scope 筛出当前生效条目（常驻 / 关键词命中），priority 降序
    let lorebookEntries = [];
    try {
      if (window.__lorebook && window.__lorebook.getActiveEntries) {
        const scanText = [text].concat(session.slice(-6).map(m => (m && m.content) || "")).join("\n");
        lorebookEntries = window.__lorebook.getActiveEntries({ text: scanText, cardId: characterCard ? characterCard.id : "" })
          .map(e => ({ name: e.name, content: e.content }));
      }
    } catch (e) {}
    if (partialStream && characterCard) {
      partialStream.speakerId = characterCard.id;
      partialStream.speakerName = characterCard.name;
      partialStream.speakerIcon = characterCard.icon || "🙂";
    }

    const snapshotMode  = currentMode;
    const snapshotModel = modelSel.value;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          customProvider: (window.__byoProvider && window.__byoProvider.get && window.__byoProvider.get()) || undefined, // 4.69 BYO 自定义 API 直传
          mode: snapshotMode,                          // 新增
          model: snapshotModel,
          use_builtin_persona: useBuiltin,
          custom_system_prompt: customPrompt,
          characterCard,
          relation,
          emotion,
          affection,
          activeProps,
          sceneOtherNames,
          summonableNames,
          thresholdEvents,
          priorSummary: historyEnabled ? priorSummary : "",
          extraSystemPrompts: getExtraSystemPrompts(snapshotMode) + ((window.__chatImageText && window.__chatImageText.getInjection) ? window.__chatImageText.getInjection() : "") + groupChatInjection(characterCard) + (window.__skills && window.__skills.getEnabledPrompt ? window.__skills.getEnabledPrompt() : ""),
          thinking: (snapshotMode === "fast" && thinkingOn) ? "enabled" : "disabled",
          fishbowlMode: opts0.fishbowlMode || null,
          topic: opts0.topic || "",
          // 2026-05-29: 严格角色扮演 + NSFW 等级 (lewd 主题联动写 cfw_nsfw_mode_v1)
          // worker.js 三态切换基线层: nsfwLevel>=1 -> buildNsfwInstruction(完全解禁) | strictRoleplay -> META_IDENTITY | else -> META_IDENTITY_SOFT
          strictRoleplay: (localStorage.getItem("cfw_strict_roleplay_v1") ?? "0") === "1",
          nsfwLevel: parseInt(localStorage.getItem("cfw_nsfw_mode_v1") || "0", 10) || 0,
          // 2026-06-01: 开发者模式 · 强制顺从底层提示词(默认关,控制台 __dev.setForceComply(true) 开启)
          devForceComply: (localStorage.getItem("cfw_dev_force_comply_v1") ?? "0") === "1",
          // 2026-05-29: 回复风格 (default / wechat / verbose) - wechat 会在后面拆气泡
          replyStyle: localStorage.getItem("cfw_reply_style_v1") || "default",
          lorebook: lorebookEntries,
          messages: session,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        aiRow.bubble.textContent = `Request failed (${res.status}):\n${t}`;
        aiRow.stats.textContent = "";
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      // 4.69 fix: SSE 行缓冲 —— 网络 chunk 边界不对齐 SSE 行边界时,直接 chunk.split("\n") 会把
      // 跨 chunk 截断的 "data: {...}" 行拆成两段:前段 JSON 不完整 → catch 丢弃,后段不含 "data: " → 跳过。
      // 最终表现:长回复（尤其中文,每字 3 字节 UTF-8）随机掉字,无报错,dev 面板「入站流」完整。
      // 改法:用 sseBuf 累加所有 decode 输出,只处理碰到 \n 的完整行;不完整的尾段留在缓冲等下个 chunk。
      let sseBuf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // 4.69 fix: flush TextDecoder 残余字节（stream:true 模式下末尾不完整 UTF-8 序列会留在 decoder 内部缓冲）
          sseBuf += decoder.decode();
          break;
        }
        sseBuf += decoder.decode(value, { stream: true });
        let _sseIdx;
        while ((_sseIdx = sseBuf.indexOf("\n")) >= 0) {
          const line = sseBuf.slice(0, _sseIdx);
          sseBuf = sseBuf.slice(_sseIdx + 1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.usage) exactUsage = parsed.usage;
            const dReason = parsed.choices?.[0]?.delta?.reasoning_content;
            if (dReason && aiRow.reasoning) {
              fullReasoning += dReason;
              if (partialStream) partialStream.fullReasoning = fullReasoning;
              aiRow.reasoning.querySelector(".reasoning-text").textContent = fullReasoning;
              // 4.70 按「思考过程显示」设置:hide 则全程不显示;否则流式期间展开看推理,结束后按设置收起
              if (getThinkDisplay() === "hide") {
                aiRow.reasoning.style.display = "none";
              } else {
                aiRow.reasoning.style.display = "";
                aiRow.reasoning.open = true;
              }
              if (isNearBottom()) scrollToBottom();
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              if (!outStartMs) outStartMs = performance.now();
              // 4.19 P0: 流式期间不折叠思考块(避免高度突降抖动);改在 stream 结束后统一折叠
              full += delta;
              if (partialStream) partialStream.full = full;
              // 4.18: 微信模式流式期间不写未处理文本到 bubble (含 [^数字]: 前缀 + || 未拆分)
              // 只显示「正在输入···」typing 动画，结束后再 strip + 拆条 + 按字数 delay 逐条 push
              // 4.18 (v8): wechat + fishbowl 共存——streaming 期间 wechat 仍显 typing,
              // 拆条改成 await delay(下面那段),让 sendOne 等所有 push 完才 resolve
              // fishbowl 接龙 await sendOne 自动等齐,不再错位且保留「几个 AI 群聊」玩法
              const _rs = localStorage.getItem("cfw_reply_style_v1") || "default";
              if (_rs === "wechat") {
                if (!aiRow.bubble.classList.contains("wechat-typing")) {
                  aiRow.bubble.textContent = "正在输入···";
                  aiRow.bubble.classList.add("wechat-typing");
                }
              } else {
                // 4.70 性能:旧版每个 delta 都对「全量 full」重跑 strip(O(n²)),长回复卡顿主因。
                // 改为 ≤每 70ms 渲染一次(节流),流末另有完整 strip 兜底,不影响最终结果。
                const _now = performance.now();
                if (_now - _lastLiveRenderMs >= 70) {
                  _lastLiveRenderMs = _now;
                  aiRow.bubble.textContent = stripPhotoSignalLive(stripJailbreakPrefix(stripThinkBlocks(full)));
                }
              }
              if (isNearBottom()) scrollToBottom();
            }
          } catch {}
        }
      }
      // 4.69 fix: sseBuf 末尾若有未以 \n 结尾的残行（服务端非标结尾），补处理一次
      // 2026-06-18 Bug⑦ fix: 旧版这里只取 parsed.usage,丢弃了残行里的 delta.content / delta.reasoning_content。
      // 当 worker 最后一个 data:{...正文...} 事件不带结尾 \n(落进 sseBuf 残段)时,这最后一截正文被静默丢弃 →
      // 永不进 full → 永不入 session(刷新/翻历史都找不回)。表现:回复尾部几句话随机丢失,越长越容易触发,与回复风格无关。
      // 修法:残行与内层循环一样累加 content / reasoning_content,后续清洗管线 + session.push 会一并处理。
      if (sseBuf.trim()) {
        const line = sseBuf.trim();
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr && jsonStr !== "[DONE]") {
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.usage) exactUsage = parsed.usage;
              const dReason = parsed.choices?.[0]?.delta?.reasoning_content;
              if (dReason) {
                fullReasoning += dReason;
                if (partialStream) partialStream.fullReasoning = fullReasoning;
              }
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                if (partialStream) partialStream.full = full;
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e.name === "AbortError") {
        // 中断（停止按钮 / 重试 / 删除 / 刷新 触发）—— 只在本代才释放全局状态、负责入 session
        if (myGen === sendGen) {
          // 若 partialStream 仍存在（停止按钮），把已收到部分作为完整 AI 回复入 session
          // 重试/删除传了 discardPartial=true，partialStream 已被清空，跳过
          if (partialStream && partialStream.full) {
            const m = { role: "assistant", content: partialStream.full };
            if (partialStream.fullReasoning) m.reasoning_content = partialStream.fullReasoning;
            if (partialStream.speakerName) {
              m.speakerId = partialStream.speakerId;
              m.speakerName = partialStream.speakerName;
              m.speakerIcon = partialStream.speakerIcon;
            }
            session.push(m);
            persistSessionIfEnabled();
          }
          isSending = false;
          sendBtn.disabled = false;
          if (currentController === controller) currentController = null;
          partialStream = null;
        }
        setStreamingUI(aiRow.rowEl, false);
        return;
      }
      if (myGen === sendGen) {
        // 4.69 fix: wechat 模式网络错误时移除 typing 动画 class，否则报错气泡继续播放 typing CSS 动画
        aiRow.bubble.classList.remove("wechat-typing");
        aiRow.bubble.textContent = `网络错误: ${e.message}`;
      }
    } finally {
      if (myGen === sendGen) {
        isSending = false;
        sendBtn.disabled = false;
        if (currentController === controller) currentController = null;
      }
      setStreamingUI(aiRow.rowEl, false);
    }

    // 新一轮 send 已起，旧闭包不允许再写 session / UI，避免被截断后的鬼消息回填
    if (myGen !== sendGen) return;
    partialStream = null;

    outEndMs = performance.now();

    // 4.70 思考归档:不再「删掉」内联思考,而是把 <think> 块 + [^420]/[^69] 哨兵区间「捕获」进折叠块,
    // 与原生 reasoning_content 合并展示,按「思考过程显示」设置 show/collapse/hide。
    // 正文(body)只保留真正可见内容;即便切割误判,正文也能在思考块里展开找回(fail-open)。
    let _reasonArchive = "";
    {
      const _inlineThink = extractThinkText(full);
      const _split = splitJailbreakPrefix(stripThinkBlocks(full));
      // 4.71 三股思考按来源去重分段(原生 reasoning + 内联 think + 解限哨兵回显),同时开思考+解限时不再叠一堆重复的折叠块
      _reasonArchive = buildReasoningArchive(fullReasoning, _inlineThink, _split.thinking);
      if (aiRow.reasoning) {
        const _rt = aiRow.reasoning.querySelector(".reasoning-text");
        if (_reasonArchive) _rt.textContent = _reasonArchive;
        applyThinkDisplay(aiRow.reasoning);
      }
      // 4.74 fix: 无条件重渲气泡 —— 流式期间 70ms 节流会漏渲最后一截 chunk
      // (已进 full/session,气泡却停在上一次节流渲染)。旧版仅 _split.body !== full 才重渲,
      // 默认模式下表现为"实时聊天最后几句被截掉,刷新看历史却完整"。
      full = _split.body;
      aiRow.bubble.textContent = full;
    }

    // 解析隐藏好感度标签 [好感±N] 并从正文剥离（仅当卡启用好感度时才更新数值）
    if (ch && ch.parseAffectionTag) {
      const tagRes = ch.parseAffectionTag(full);
      if (tagRes.delta && affection !== null) {
        try { await ch.adjustActiveAffection(tagRes.delta); } catch {}
      }
      if (tagRes.stripped !== full) {
        full = tagRes.stripped;
        aiRow.bubble.textContent = full;
      }
    }

    // 2026-05-29 微信发图:抠出 [[发图:场景]] 信号,从正文剥离(触发延后到入 session 后)
    let _photoSig = null;
    let _photoKind = null; // 4.72 修:透传 extractSignal 解析出的 kind(自拍/场景),不再让 handleSignal 用关键词重新猜(nsfw 直白描述会被误判成场景→丢基准图)
    if (window.__chatImageText && window.__chatImageText.extractSignal) {
      try {
        const _r = window.__chatImageText.extractSignal(full);
        if (_r && _r.scene != null) {
          _photoSig = _r.scene;
          _photoKind = _r.kind || null;
          if (_r.clean !== full) { full = _r.clean; aiRow.bubble.textContent = full; }
        }
      } catch (e) {}
    }

    // 2026-05-30 / 4.25: 鱼缸接龙/讨论 —— 剥离 AI 误带的发言人名签 + [next:X]/[end] 标签
    // 名签泄漏会让「冷(女)】」串进气泡;标签泄漏会让 [next:高冷] 显示出来。
    // 保留含标签的原文 _replyForEngine 返回给 fishbowl-engine 解析接力/结束。
    let _replyForEngine = full;
    // 4.43: 接龙/讨论(引擎驱动) + 多人编排群聊(本文件 runAutoRelay 驱动) 都要剥离名签 + [next:X]/[end] 标签,
    // 避免标签泄漏进气泡/历史;_replyForEngine 保留原文(含标签)给接力解析。
    const _isAutoFishbowl = opts0.fishbowlMode && opts0.fishbowlMode !== "orchestrate";
    if (_isAutoFishbowl || isGroupChatActive()) {
      const _lbl = stripSceneSpeakerLabel(full);
      if (_lbl !== full) full = _lbl;
      const _noTags = full.replace(/\[next[:：][^\]\n]*\]/gi, "").replace(/\[end\]/gi, "").replace(/\[召唤[:：][^\]\n]*\]/g, "").trim();
      if (_noTags !== full) full = _noTags;
      if (full !== _replyForEngine) aiRow.bubble.textContent = full;
    }

    // 4.59 残括号清扫(所有模式通用):清掉模型写崩的 [] / 落单 ] / [好感] 等残体,再入 session/拆条,保证气泡与历史都干净
    {
      const _swept = stripResidualMarkup(full);
      if (_swept !== full) { full = _swept; aiRow.bubble.textContent = full; }
    }

    // 2026-05-29 / 4.18: 微信风格拆气泡
    // session 里还是存完整拼接串(含 ||),避免下轮 turn 模型看不到连发样式上下文
    // 4.18 (v8): 拆条从 setTimeout 改成 await delay——sendOne 等所有 push 完才 resolve
    // 4.18 (v9): wechat + fishbowl 共存时拆条上限改 2 条 + 延迟拉到 800-1500ms
    // root cause: 每 agent 一回合拆 5-6 条 → 单边霸屏,完全失去群聊接龙节奏
    // 折中: 视觉显示前 2 条(够 wechat 拆条感),剩余在 session 里给下轮模型看上下文用
    // 真插话(AB 气泡交错)需要 sendOne 重构 + concurrent,排进下回合 backlog
    const _replyStyle = localStorage.getItem("cfw_reply_style_v1") || "default";
    if (_replyStyle === "wechat") {
      aiRow.bubble.classList.remove("wechat-typing");
      // 4.47: 微信模式剥离行为/动作描写,只保留聊天文字(session 也存剥离版,避免下轮模型又学着写动作)
      const _noAct = stripWechatActions(full);
      if (_noAct && _noAct !== full) { full = _noAct; aiRow.bubble.textContent = full; }
      // 4.25 (⑨): 模型没拆 || 却吐了长段 → 客户端兜底按句切分,保证不"跳长篇"(session 仍存原文 full)
      let _wechatText = full;
      if (!_wechatText.includes("||")) {
        const _auto = autoSplitWechat(_wechatText);
        if (_auto) _wechatText = _auto;
      }
      if (_wechatText.includes("||")) {
        const _parts = _wechatText.split("||").map(s => s.trim()).filter(Boolean);
        if (_parts.length > 1) {
          // 4.18 v9: fishbowl 模式下截断到前 2 条,避免单边霸屏
          const _inFishbowl = !!opts0.fishbowlMode && opts0.fishbowlMode !== "orchestrate";
          // 4.65: 群聊也显示全部 || 拆条(取消旧「前 2 条」上限)——第 3 条起被吞让用户以为"消息被切掉"
          const _visibleParts = _parts;
          // 第一条立刻显示
          aiRow.bubble.textContent = _visibleParts[0];
          if (isNearBottom()) scrollToBottom();
          // 后续条按「上一条字数 * 80ms」延迟逐条 push,fishbowl 模式最少 800ms 给对面 AI 喘息空间
          // 4.19 P0.5: fishbowl + wechat 共存时 tail 改 fire-and-forget
          // → sendOne 早 yield → fishbowl runLoop 立刻推进到 B → AB 气泡真交错插话
          // 单 agent wechat (fishbowl=false) 仍然 await,保持原 UX
          // 4.19 P1 fix: tail 用 _tailGen 判断中断,不用 myGen ——
          // fire-and-forget 后下个 sendOne 立刻把 sendGen ++,用 myGen 会让 tail 一醒就退,2/3 段永不显示
          const _myTailGen = _tailGen;
          const _pushTail = async () => {
            for (let i = 1; i < _visibleParts.length; i++) {
              const _minDelay = _inFishbowl ? 800 : 300;
              const _delay = Math.max(_minDelay, _visibleParts[i - 1].length * (_inFishbowl ? 80 : 60));
              await new Promise(r => setTimeout(r, _delay));
              // 中途被中断(abortCurrent / 鱼缸 stop / 重试 / 删除) → tail 退出
              if (_myTailGen !== _tailGen) return;
              const _piece = _visibleParts[i];
              const _side = opts0.side || null;
              const _r = makeRow("assistant", { side: _side });
              _r.bubble.textContent = _piece;
              _r.stats.textContent = "";
              if (window.__character && window.__character.decorateAiRow) {
                // 4.19 P1 fix: tail piece 复用主 row 的 characterCard,保持所有拆条都是同一个角色
                window.__character.decorateAiRow(_r.rowEl, characterCard);
              }
              setStreamingUI(_r.rowEl, false);
              if (isNearBottom()) scrollToBottom();
            }
          };
          // 4.20 P0: 回退 fire-and-forget tail —— 用户反馈 AB 拆条交错视觉乱 (2026-05-29 17:03 截图)
          // 原 4.19 P0.5 (1284 第 4 edit) 让 wechat+fishbowl 时 A 早 yield → B 抢屏 → 完全失去群聊接龙节奏
          // 现在改回无条件 await:wechat+fishbowl 时也是 A 把所有 || 段说完才 resolve sendOne,fishbowl 再推到 B
          // _tailGen 模块级 token 保留 (stop/重试/删除/abort 仍需中断 tail,不能用 sendGen 否则下个 sendOne 立刻 ++ 让 tail 一醒就退)
          await _pushTail();
        } else {
          aiRow.bubble.textContent = full;
        }
      } else {
        // wechat 模式但模型没输 || → 直接显示 full (避免一直卸在 typing 动画)
        aiRow.bubble.textContent = full;
      }
    } else {
      // 2026-06-08 默认/详细模式残留 || 根治:微信模式拆条后 session 里存的是含 || 的完整串,
      // 切回默认/详细模式后模型会模仿历史里的 || 样本继续吐分隔符(few-shot 污染),而默认分支从不处理 || → 气泡和历史都残留 ||,且越滚越多(雪球)。
      // 兜底:非微信模式把 || 合并成换行,清干净可见气泡 + 入 session 的 full,断掉雪球。
      if (full.includes("||")) {
        const _merged = full.split("||").map(s => s.trim()).filter(Boolean).join("\n");
        if (_merged !== full) { full = _merged; aiRow.bubble.textContent = full; }
      }
    }

    const asMsg = { role: "assistant", content: full };
    // 4.71 持久化:写入按来源去重分段的思考归档(与折叠块同一份),刷新后仍可展开
    {
      if (_reasonArchive) asMsg.reasoning_content = _reasonArchive;
    }
    if (characterCard) {
      asMsg.speakerId = characterCard.id;
      asMsg.speakerName = characterCard.name;
      asMsg.speakerIcon = characterCard.icon || "🙂";
    }
    session.push(asMsg);
    persistSessionIfEnabled();
    // 2026-05-29 微信发图:正文入 session 后触发出图(图片气泡插在本条 AI 之后)
    if (_photoSig != null && window.__chatImageText && window.__chatImageText.handleSignal) {
      try { window.__chatImageText.handleSignal({ scene: _photoSig, kind: _photoKind, card: characterCard, afterRow: aiRow.rowEl }); } catch (e) {}
    }
    // 阶段 4-②：本轮成功发送后清空已注入的一次性阈值事件
    if (thresholdEvents && thresholdEvents.length && ch && ch.clearPendingThresholdEvents) {
      try { ch.clearPendingThresholdEvents(); } catch {}
    }

    const seconds = Math.max(0.001, (outEndMs - (outStartMs || outEndMs)) / 1000);

    if (exactUsage && typeof exactUsage.completion_tokens === "number") {
      const p = exactUsage.prompt_tokens        || 0;
      const c = exactUsage.completion_tokens    || 0;
      const t = exactUsage.total_tokens         || (p + c);
      const cached = exactUsage.prompt_cache_hit_tokens || 0;
      totalPromptTokens     += p;
      totalCompletionTokens += c;
      const tps = c / seconds;

      let statsText = `Prompt: ${p} | Completion: ${c} | Total: ${t} | Speed: ${tps.toFixed(2)} tok/s`
        + ` | CumPrompt: ${totalPromptTokens} | CumCompletion: ${totalCompletionTokens}`;

      // 快速模式才计费
      // 修订：单条 token 太少时 ¥0.00005 会被 toFixed 截成 ¥0.00000 难看。
      // 改为“累计 token / 累计¥”呈现：累计金额足够大，浮点稳定且直观反映总额。
      if (snapshotMode === "fast") {
        const cost = calcCost(snapshotModel, p, c, cached);
        totalCostCNY += cost;
        addCostToToday(cost, p, c);  // Phase 4 阶段 7：同步追加到日志（独立于历史）
        const cumTok = totalPromptTokens + totalCompletionTokens;
        statsText += ` | 累计 ${cumTok} tok / ¥${totalCostCNY.toFixed(4)}`;
        updateCostDisplay();
      }

      aiRow.stats.textContent = statsText;
    } else {
      const outEst = estimateTokens(full);
      totalOutEstimate += outEst;
      const tps = outEst / seconds;
      aiRow.stats.textContent =
        `Output(估算): ≈${outEst} | Total Out(估算): ≈${totalOutEstimate}`
        + ` | Speed(估算): ${tps.toFixed(2)} tok/s | (usage未返回)`;
    }

    updateSpacer();
    scrollToBottom();

    // 道具卡轮次推进（仅正常完成路径；AbortError/错误路径不推进）
    if (window.__props && window.__props.tickAfterTurn) {
      try { window.__props.tickAfterTurn(); } catch {}
    }
    // 4.25: 返回含 [next:X]/[end] 的原文给鱼缸引擎解析(气泡/session 已是剥离版)
    return _replyForEngine;
  }

  // ─── 4.43 多人群聊:@召唤 + AI 交棒/随机插嘴 自发接力(仅多人模式下的「编排」自由群聊;接龙/讨论由鱼缸引擎驱动)───
  const LS_AUTO_RELAY   = "cfw_group_auto_relay_v1";
  const LS_RANDOM_BARGE = "cfw_group_random_barge_v1";
  const MAX_AUTO_STREAK = 5;
  let _autoBusy = false;

  function autoRelayEnabled() { return (localStorage.getItem(LS_AUTO_RELAY) ?? "1") === "1"; }
  function randomBargeChance() { const n = parseInt(localStorage.getItem(LS_RANDOM_BARGE) ?? "35", 10); return isNaN(n) ? 35 : Math.max(0, Math.min(100, n)); }

  function isGroupChatActive() {
    const M = window.__multi;
    if (!(M && M.isMulti && M.isMulti())) return false;
    let n = 0; try { n = ((M.getSceneCards && M.getSceneCards()) || []).length; } catch (e) {}
    if (n < 2) return false;
    const fb = window.__fishbowl;
    const mode = fb && fb.getMode ? fb.getMode() : "orchestrate";
    return mode === "orchestrate";
  }

  function _normNameForMatch(s) { return String(s == null ? "" : s).replace(/[\s【】\[\]()（）「」·,，.。!！?？~]/g, "").toLowerCase(); }
  function matchSceneCardByName(hint) {
    if (!hint) return null;
    let cards = []; try { cards = (window.__multi && window.__multi.getSceneCards && window.__multi.getSceneCards()) || []; } catch (e) { return null; }
    if (!cards.length) return null;
    const raw = String(hint).trim();
    let hit = cards.find(c => c && c.name === raw); if (hit) return hit;
    const nh = _normNameForMatch(raw); if (!nh) return null;
    hit = cards.find(c => c && _normNameForMatch(c.name) === nh); if (hit) return hit;
    hit = cards.find(c => { const cn = _normNameForMatch(c && c.name); return cn && cn.length >= 2 && nh.length >= 2 && (cn.includes(nh) || nh.includes(cn)); });
    return hit || null;
  }

  function parseAtMentions(text) {
    if (!text || !isGroupChatActive()) return [];
    const found = []; const re = /@([^\s@,，。!！?？:：、]+)/g; let m;
    while ((m = re.exec(text)) !== null) {
      const hit = matchSceneCardByName(m[1]);
      if (hit && !found.some(c => c.id === hit.id)) found.push(hit);
    }
    return found;
  }

  function groupChatInjection(speakerCard) {
    if (!isGroupChatActive()) return "";
    let names = []; try { names = (((window.__multi.getSceneCards && window.__multi.getSceneCards()) || []).map(c => c && c.name)).filter(Boolean); } catch (e) {}
    if (names.length < 2) return "";
    const self = speakerCard ? speakerCard.name : "当前角色";
    return "\n\n【群聊接力】当前是多人群聊,在场角色:" + names.join("、") + "。你只能以「" + self + "」的身份说话,绝不替别人代言。用户消息里若出现 @某人,主要是在对那个人说话。当你这句话明显在喊某个在场的人、或话题更适合交给在场的另一个人接时,就在整条回复的最末尾追加一个交棒标记 [next:对方名字](只能点在场的人,不能点自己);不需要交棒时就完全不要输出这个标记。该标记只放在最后,用方括号包裹。";
  }

  async function runAutoRelay(seedReply, seedSpeaker) {
    if (_autoBusy) return;
    if (!isGroupChatActive() || !autoRelayEnabled()) return;
    _autoBusy = true;
    const subset = groupOnlineMode() === "subset";
    try {
      let reply = seedReply, lastCard = seedSpeaker, streak = 0;
      while (streak < MAX_AUTO_STREAK) {
        if (!isGroupChatActive()) break;
        let nextCard = null;
        // 4.52 在场感 part2:AI 在编排群聊里 [召唤:X] 把场景外角色叫进来,优先级高于 [next:X]/随机插嘴
        try {
          const _sm = reply ? reply.match(/\[召唤[:：]\s*([^\]\n]+?)\s*\]/) : null;
          if (_sm && window.__multi && window.__multi.summonByName) {
            const _sc = window.__multi.summonByName(_sm[1].trim());
            if (_sc && (!lastCard || _sc.id !== lastCard.id)) nextCard = _sc;
          }
        } catch (e) {}
        try {
          const fb = window.__fishbowl;
          const tags = (!nextCard && fb && fb.parseTags) ? fb.parseTags(reply || "") : null;
          if (tags && tags.next) {
            const hit = matchSceneCardByName(tags.next);
            if (hit && (!lastCard || hit.id !== lastCard.id)) nextCard = hit;
          }
        } catch (e) {}
        if (!nextCard && Math.random() * 100 < randomBargeChance()) {
          let cards = []; try { cards = (window.__multi.getSceneCards && window.__multi.getSceneCards()) || []; } catch (e) {}
          const others = cards.filter(c => c && (!lastCard || c.id !== lastCard.id));
          if (others.length) nextCard = others[Math.floor(Math.random() * others.length)];
        }
        if (!nextCard) break;
        streak++;
        // 4.53 真实在线感:subset 随机更长延迟 + typing,且第 2 棒后有概率"没人接"提前散场
        if (subset) {
          if (streak >= 2 && Math.random() < 0.25) break;
          if (pacingEnabled()) showTyping(nextCard.name);
          await new Promise(r => setTimeout(r, 700 + Math.floor(Math.random() * 1900)));
          hideTyping();
        } else {
          // 4.58 拟人节奏:all 模式也别 600ms 机关枪秒接,按 pacing 设置加“正在输入”+ 拖动延迟
          if (pacingEnabled()) {
            showTyping(nextCard.name);
            await new Promise(r => setTimeout(r, Math.max(700, Math.round(pacingBaseDelay() * (0.6 + Math.random() * 0.7)))));
            hideTyping();
          } else {
            await new Promise(r => setTimeout(r, 600));
          }
        }
        if (!isGroupChatActive()) break;
        reply = await sendOne({ allowEmptyText: true, asCard: nextCard });
        if (reply == null) break;
        lastCard = nextCard;
      }
    } finally { _autoBusy = false; hideTyping(); }
  }
  function continueGroupChat(reply, card) { return runAutoRelay(reply, card); }

  // ─── 4.53 真实节奏:攒消息防抖(支持连发) + 不秒回延迟 + 「正在输入」提示 + 群聊在线模式 ───
  // 痛点:发一条就秒回、且没法像真人那样连着发好几句。
  // 做法:Send/Enter 先把消息只入 UI+session(不触发 AI),起一个防抖计时;你继续发就重置计时,
  //      停手 N 秒(基准 cfw_reply_pacing_delay_v1 + 随机抖动)才真正触发 AI 回复,期间显示「正在输入」。
  // 群聊在线模式 cfw_group_online_mode_v1: all=现状(基本都会接力) / subset=拟真(随机谁回、延迟更长、可能没人接)。
  const LS_REPLY_PACING = "cfw_reply_pacing_v1";
  const LS_PACING_DELAY = "cfw_reply_pacing_delay_v1";
  const LS_GROUP_ONLINE = "cfw_group_online_mode_v1";
  function pacingEnabled() { return (localStorage.getItem(LS_REPLY_PACING) ?? "1") === "1"; }
  function pacingBaseDelay() { const n = parseInt(localStorage.getItem(LS_PACING_DELAY) ?? "2200", 10); return isNaN(n) ? 2200 : Math.max(0, Math.min(15000, n)); }
  function groupOnlineMode() { return localStorage.getItem(LS_GROUP_ONLINE) === "subset" ? "subset" : "all"; }

  let _typingEl = null;
  function showTyping(label) {
    hideTyping();
    const el = document.createElement("div");
    el.className = "row ai pacing-typing";
    const av = document.createElement("div"); av.className = "avatar bot"; av.textContent = "🙂";
    const content = document.createElement("div"); content.className = "content";
    const bubble = document.createElement("div"); bubble.className = "bubble ai wechat-typing";
    bubble.textContent = (label ? label + " " : "") + "正在输入···";
    content.appendChild(bubble);
    el.appendChild(av); el.appendChild(content);
    chatEl.insertBefore(el, spacerEl);
    _typingEl = el;
    if (isNearBottom()) scrollToBottom();
  }
  function hideTyping() {
    if (_typingEl && _typingEl.parentNode) _typingEl.parentNode.removeChild(_typingEl);
    _typingEl = null;
  }

  function dedupeCards(arr) {
    const seen = new Set(); const out = [];
    for (const c of (arr || [])) { if (c && c.id && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }
    return out;
  }
  function pickRandomOnlineCard(excludeCard) {
    let cards = [];
    try { cards = (window.__multi.getSceneCards && window.__multi.getSceneCards()) || []; } catch (e) {}
    cards = cards.filter(c => c && (!excludeCard || c.id !== excludeCard.id));
    if (!cards.length) return null;
    return cards[Math.floor(Math.random() * cards.length)];
  }

  // 只把输入消息入 UI+session,不触发 AI(攒消息用)
  function pushUserMessageOnly(text) {
    const userRow = makeRow("user");
    userRow.bubble.textContent = text;
    const inEst = estimateTokens(text);
    totalInEstimate += inEst;
    userRow.stats.textContent = `Input(估算): ≈${inEst} | Total In(估算): ≈${totalInEstimate}`;
    session.push({ role: "user", content: text });
    persistSessionIfEnabled();
  }

  let _pendingTimer = null;
  let _pendingTypingTimer = null;
  let _pendingTargets = null;
  function clearPendingTimers() {
    if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null; }
    if (_pendingTypingTimer) { clearTimeout(_pendingTypingTimer); _pendingTypingTimer = null; }
  }

  // 防抖入口:把消息攒进 session,停手 N 秒后才真正回复(连发期间不断重置计时)
  function queueSend() {
    const raw = inputEl.value.trim();
    if (!raw) return;
    if (isGroupChatActive()) {
      const t = parseAtMentions(raw);
      if (t.length) _pendingTargets = dedupeCards((_pendingTargets || []).concat(t));
    }
    pushUserMessageOnly(raw);
    inputEl.value = "";
    inputEl.style.height = "auto";
    updateSpacer();
    scrollToBottom();
    clearPendingTimers();
    hideTyping();
    const delay = pacingBaseDelay() + Math.floor(Math.random() * 800);
    const typingAt = Math.max(0, delay - 1200);
    _pendingTypingTimer = setTimeout(() => { showTyping(); }, typingAt);
    _pendingTimer = setTimeout(function fire() {
      if (isSending) { _pendingTimer = setTimeout(fire, 700); return; }
      clearPendingTimers();
      hideTyping();
      const targets = _pendingTargets; _pendingTargets = null;
      fireReply(targets);
    }, delay);
  }

  // 防抖计时结束后真正触发 AI 回复(用户消息已在 session,allowEmptyText 不再建 user 气泡)
  async function fireReply(targets) {
    if (!isGroupChatActive()) {
      return sendOne({ allowEmptyText: true });
    }
    if (targets && targets.length) {
      let reply = await sendOne({ allowEmptyText: true, asCard: targets[0] });
      for (let i = 1; i < targets.length; i++) {
        if (!isGroupChatActive()) break;
        const r = await sendOne({ allowEmptyText: true, asCard: targets[i] });
        if (r == null) break;
        reply = r;
      }
      if (reply != null) runAutoRelay(reply, targets[targets.length - 1]);
      return reply;
    }
    // 无 @:subset 模式随机挑一位"在线"的人先回,all 模式沿用当前角色
    const firstCard = groupOnlineMode() === "subset" ? pickRandomOnlineCard(null) : null;
    const speaker = firstCard || ((window.__character && window.__character.getActiveCard) ? window.__character.getActiveCard() : null);
    const reply = firstCard
      ? await sendOne({ allowEmptyText: true, asCard: firstCard })
      : await sendOne({ allowEmptyText: true });
    if (reply != null) runAutoRelay(reply, speaker);
    return reply;
  }

  // send():从输入框取消息的入口(绑定 Send 按钮 / Enter 键)
  // 4.53 真实节奏:pacing 开启走 queueSend 攒消息防抖;关闭走 sendImmediate 即时发送(旧行为)
  function send() {
    if (pacingEnabled()) return queueSend();
    return sendImmediate();
  }

  // 4.43 多人编排群聊:解析 @召唤 → 被点名者依次回 → 触发自发接力;否则当前角色回 → 触发自发接力。
  async function sendImmediate() {
    if (!isGroupChatActive()) return sendOne();
    const raw = inputEl.value.trim();
    const targets = parseAtMentions(raw);
    if (raw && targets.length) {
      let reply = await sendOne({ text: raw, asCard: targets[0] });
      for (let i = 1; i < targets.length; i++) {
        if (!isGroupChatActive()) break;
        const r = await sendOne({ allowEmptyText: true, asCard: targets[i] });
        if (r == null) break;
        reply = r;
      }
      if (reply != null) runAutoRelay(reply, targets[targets.length - 1]);
      return reply;
    }
    const speaker = (window.__character && window.__character.getActiveCard) ? window.__character.getActiveCard() : null;
    const reply = await sendOne();
    if (reply != null) runAutoRelay(reply, speaker);
    return reply;
  }

  // injectModeratorMsg(text):鱼缸引擎/主持人通道,把一条旁白介入消息插到 session 和 UI
  // 吐槽姬 mode 下走 .row.moderator 居中样式,不占用户位
  function injectModeratorMsg(text) {
    if (!text) return;
    const content = "【主持人】" + String(text);
    const row = makeRow("user", { moderator: true });
    row.bubble.textContent = content;
    session.push({ role: "user", content });
    persistSessionIfEnabled();
    updateSpacer();
    scrollToBottom();
  }

  sendBtn.addEventListener("click", send);

  // 刷新/关页时若有流式进行中，把已收到的部分当作一条完整的 assistant 回复兑现到 session 并持久化
  // 避免“用户消息已保存但 AI 回复丢失”的悬空状态
  window.addEventListener("beforeunload", () => {
    if (!partialStream || !partialStream.full) return;
    const m = { role: "assistant", content: partialStream.full };
    if (partialStream.fullReasoning) m.reasoning_content = partialStream.fullReasoning;
    if (partialStream.speakerName) {
      m.speakerId = partialStream.speakerId;
      m.speakerName = partialStream.speakerName;
      m.speakerIcon = partialStream.speakerIcon;
    }
    session.push(m);
    persistSessionIfEnabled();
  });

  // 2026-06-21 Bug:云同步「对话同步了但内容为空」+「手机主对话在别处看不见」——
  // 根因:聊天推送是 markChatDirty 的 30s 防抖;beforeunload 在移动端不可靠,手机切后台/被系统回收
  // 常发生在 30s 内 → 最新消息及本机主对话槽从未推上云。修:页面转入后台(visibilitychange→hidden)
  // 或卸载(pagehide)时立即 flush 一次聊天推送。pushChatNow 内部有 includeChat()/syncEnabled() 门控,
  // 关同步时为 no-op,安全;persistSessionIfEnabled 先把当前会话(含本机主对话槽)落本地再推。
  function _flushChatToCloud() {
    try {
      persistSessionIfEnabled();
      if (window.__sync && window.__sync.pushChatNow) window.__sync.pushChatNow();
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") _flushChatToCloud(); });
  window.addEventListener("pagehide", _flushChatToCloud);

  // ─── 4.43 @召唤自动补全:多人编排群聊下,输入框打 @ 弹出在场角色候选 ───
  let _atMenu = null, _atItems = [], _atIndex = -1, _atOpen = false;
  function ensureAtMenu() {
    if (_atMenu) return _atMenu;
    const menu = document.createElement("div");
    menu.id = "atMentionMenu";
    menu.style.cssText = "position:absolute;z-index:9999;min-width:160px;max-width:280px;max-height:240px;overflow:auto;border-radius:10px;padding:4px;display:none;box-shadow:0 8px 24px rgba(0,0,0,.35);";
    document.body.appendChild(menu);
    _atMenu = menu;
    return menu;
  }
  function getAtQuery() {
    const val = inputEl.value || "";
    const pos = inputEl.selectionStart || 0;
    const left = val.slice(0, pos);
    const m = left.match(/(^|\s)@([^\s@]*)$/);
    if (!m) return null;
    return { query: m[2], start: pos - m[2].length - 1, end: pos };
  }
  function insertMention(card) {
    const q = getAtQuery();
    if (!q || !card) { closeAtMenu(); return; }
    const val = inputEl.value || "";
    const before = val.slice(0, q.start);
    const after = val.slice(q.end);
    const insert = "@" + card.name + " ";
    inputEl.value = before + insert + after;
    const caret = (before + insert).length;
    try { inputEl.setSelectionRange(caret, caret); } catch (e) {}
    closeAtMenu();
    inputEl.focus();
    try { inputEl.dispatchEvent(new Event("input")); } catch (e) {}
  }
  function highlightAt() {
    const isLight = (window.__theme && typeof window.__theme.is === "function") ? window.__theme.is("light") : (localStorage.getItem("my-theme") === "light"); // 4.79 #12: 改读有效明暗(显式选择||主题原生),修 glass/少女 原生浅色下直读 my-theme=null 误判为暗导致 UI 不可读
    _atItems.forEach((it, i) => { it.el.style.background = (i === _atIndex) ? (isLight ? "#eaeaea" : "#33333d") : "transparent"; });
  }
  function setAtIndex(i) { _atIndex = i; highlightAt(); }
  function closeAtMenu() { if (_atMenu) _atMenu.style.display = "none"; _atOpen = false; _atItems = []; _atIndex = -1; }
  function positionAtMenu() {
    if (!_atMenu) return;
    const r = inputEl.getBoundingClientRect();
    const mh = _atMenu.offsetHeight || 200;
    let top = r.top - mh - 6;
    if (top < 8) top = r.bottom + 6;
    _atMenu.style.top = (top + window.scrollY) + "px";
    _atMenu.style.left = (r.left + window.scrollX) + "px";
  }
  function openAtMenu(cards) {
    const menu = ensureAtMenu();
    const isLight = (window.__theme && typeof window.__theme.is === "function") ? window.__theme.is("light") : (localStorage.getItem("my-theme") === "light"); // 4.79 #12: 改读有效明暗(显式选择||主题原生),修 glass/少女 原生浅色下直读 my-theme=null 误判为暗导致 UI 不可读
    menu.style.background = isLight ? "#ffffff" : "#1c1c22";
    menu.style.border = "1px solid " + (isLight ? "#ddd" : "#3a3a44");
    menu.style.color = isLight ? "#222" : "#eee";
    menu.innerHTML = "";
    _atItems = [];
    cards.forEach((card, i) => {
      const it = document.createElement("div");
      it.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;cursor:pointer;font-size:14px;white-space:nowrap;";
      const ico = document.createElement("span"); ico.textContent = card.icon || "🙂"; ico.style.flexShrink = "0";
      const nm = document.createElement("span"); nm.textContent = card.name; nm.style.cssText = "overflow:hidden;text-overflow:ellipsis;";
      it.appendChild(ico); it.appendChild(nm);
      it.addEventListener("mousedown", (e) => { e.preventDefault(); insertMention(card); });
      it.addEventListener("mouseenter", () => setAtIndex(i));
      menu.appendChild(it);
      _atItems.push({ card, el: it });
    });
    _atIndex = 0;
    highlightAt();
    menu.style.display = "block";
    _atOpen = true;
    positionAtMenu();
  }
  function updateAtMenu() {
    if (!isGroupChatActive()) { closeAtMenu(); return; }
    const q = getAtQuery();
    if (!q) { closeAtMenu(); return; }
    let cards = [];
    try { cards = (window.__multi.getSceneCards && window.__multi.getSceneCards()) || []; } catch (e) {}
    const query = (q.query || "").toLowerCase();
    const filtered = (query ? cards.filter(c => c && c.name && c.name.toLowerCase().includes(query)) : cards).filter(Boolean);
    if (!filtered.length) { closeAtMenu(); return; }
    openAtMenu(filtered);
  }
  function atMenuKeydown(e) {
    if (!_atOpen || !_atItems.length) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); _atIndex = (_atIndex + 1) % _atItems.length; highlightAt(); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); _atIndex = (_atIndex - 1 + _atItems.length) % _atItems.length; highlightAt(); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const it = _atItems[_atIndex] || _atItems[0]; if (it) insertMention(it.card); return true; }
    if (e.key === "Escape") { e.preventDefault(); closeAtMenu(); return true; }
    return false;
  }
  inputEl.addEventListener("input", updateAtMenu);
  inputEl.addEventListener("blur", () => { setTimeout(closeAtMenu, 150); });

  inputEl.addEventListener("keydown", (e) => {
    if (_atOpen && atMenuKeydown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // ─── 2026-06-07 手机端滚动自动隐藏顶栏/底栏(集中一处:JS 只切 body.nav-hidden,位移/过渡全在 styles.css 的 @media 手机段)───
  function setupScrollHide() {
    if (!historyWrap) return;
    let lastY = 0, ticking = false;
    const TH = 8; // 滚动阈值,过滤抖动
    // 4.75 顶栏占位块修复:#topbar 是 position:sticky,靠 transform:translateY(-110%) 收起并不会归还它在 flex 流里占的高度,
    //   于是 nav-hidden 挂着时顶部始终残留一条「空槽」。正常滚动时这条空槽在视口之上看不到;
    //   但历史恢复/切角色/切会话会用 scrollToBottom() 程序化跳变,被滚动处理器误判成「下滑」而加上 nav-hidden,
    //   此时人停在顶部/内容不足一屏 → 空槽就停在正文上方挡住文字(用户反馈的「占位块」)。
    //   ① notScrollable():内容不足一屏(不可滚动)时强制显示顶栏,根除短对话/恢复后残留。
    //   ② window.__navHideReset:给历史恢复/切角色/切会话调用,复位 lastY 并显示顶栏,杜绝程序化滚动误触发收起。
    function notScrollable() {
      return (historyWrap.scrollHeight - historyWrap.clientHeight) < 80;
    }
    function reset() {
      document.body.classList.remove("nav-hidden");
      lastY = historyWrap.scrollTop;
    }
    window.__navHideReset = reset;
    historyWrap.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (notScrollable()) { document.body.classList.remove("nav-hidden"); lastY = historyWrap.scrollTop; return; }
        const y = historyWrap.scrollTop;
        const dy = y - lastY;
        if (Math.abs(dy) < TH) return;
        if (y < 40) document.body.classList.remove("nav-hidden");       // 贴顶始终显示
        else if (dy > 0) document.body.classList.add("nav-hidden");      // 下滑→隐藏
        else document.body.classList.remove("nav-hidden");              // 上滑→显示
        lastY = y;
      });
    }, { passive: true });
  }

  // ─── 2026-06-08 手机端开发者按钮收纳:dev 模式 + 窄屏时,顶栏 ⏸ 暂停同步 / 🛠 开发者面板 会和模型选择器/设置挤成换行冲突。
  // 收进一个「更多」下拉(仅手机 + dev 显示该入口);桌面端仍内联平铺。用 matchMedia 在两种布局间搬运真实节点(不复制,保留事件绑定)。───
  function setupTopbarOverflow() {
    const moreBtn = document.getElementById("topbarMoreBtn");
    const pauseBtn = document.getElementById("syncPauseBtn");
    const devBadge = document.getElementById("devBadgeTopbar");
    if (!moreBtn || (!pauseBtn && !devBadge)) return;
    // 桌面还原锚点(注释节点占位,搬回时插回原处)
    const pauseAnchor = pauseBtn ? document.createComment("pause-home") : null;
    const devAnchor = devBadge ? document.createComment("dev-home") : null;
    if (pauseBtn && pauseAnchor) pauseBtn.parentNode.insertBefore(pauseAnchor, pauseBtn);
    if (devBadge && devAnchor) devBadge.parentNode.insertBefore(devAnchor, devBadge);
    const menu = document.createElement("div");
    menu.id = "topbarMoreMenu";
    menu.style.display = "none";
    document.body.appendChild(menu);
    let open = false;
    function closeMenu() { open = false; menu.style.display = "none"; }
    function openMenu() {
      open = true; menu.style.display = "flex";
      const r = moreBtn.getBoundingClientRect();
      menu.style.top = (r.bottom + window.scrollY + 6) + "px";
      menu.style.left = (Math.max(8, r.right - (menu.offsetWidth || 160)) + window.scrollX) + "px";
    }
    moreBtn.addEventListener("click", (e) => { e.stopPropagation(); open ? closeMenu() : openMenu(); });
    document.addEventListener("click", (e) => { if (open && !menu.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target)) closeMenu(); });
    const mq = window.matchMedia("(max-width: 1023px)");
    function apply() {
      if (mq.matches) {
        if (pauseBtn && pauseBtn.parentNode !== menu) menu.appendChild(pauseBtn);
        if (devBadge && devBadge.parentNode !== menu) menu.appendChild(devBadge);
      } else {
        if (pauseBtn && pauseAnchor && pauseAnchor.parentNode) pauseAnchor.parentNode.insertBefore(pauseBtn, pauseAnchor);
        if (devBadge && devAnchor && devAnchor.parentNode) devAnchor.parentNode.insertBefore(devBadge, devAnchor);
        closeMenu();
      }
    }
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply); else if (mq.addListener) mq.addListener(apply);
  }

  // 「思考过程显示」下拉已迁移到 settings.js

  function init() {
    applyMode(currentMode);     // 初始化模式 + 模型下拉
    setupResizeObserver();
    setupViewportListener();
    setupScrollHide();
    setupTopbarOverflow();
    updateSpacer();
    restoreSessionIfEnabled();
    renderSummaryChip();
    scrollToBottom();
    // 4.20 P1: dev mode 下 scrollLeft = scrollWidth 会把 #modeToggle 滚出桌面可视区
    // root cause: dev-only 按钮 #syncPauseBtn + #devBadgeTopbar 让 topbar-inner 总宽超 topbar-scroll viewport,
    // 推到最右后最左的 modeToggle (免费/快速切换) 被截。手机端正常因为本来就习惯横滑。
    // 修法:dev mode 下不推右,保持 modeToggle 在左侧可见;普通模式下继续推让 settingsBtn 入视。
    const tbs = document.getElementById("topbarScroll");
    const _devOn = localStorage.getItem("cfw_dev_mode_v1") === "1";
    if (tbs && !_devOn) tbs.scrollLeft = tbs.scrollWidth;
    // 4.17: 切换角色卡时 swap 聊天槽，避免不同角色对话互相污染
    // 4.18 (v5): 鱼缸 relay/discuss 运行期间不切槽——
    // root cause:接龙每轮调 setActiveId(speaker.id) 会触发 character:changed,
    // 旧 handler 把它当"用户手动切角色"调 clearUIRows 清空 chat
    // → 用户看到的就是"消息一闪就没"
    lastSlotKey = currentSlotKey();
    window.addEventListener("character:changed", () => {
      const _fb = window.__fishbowl;
      const _fbMode = _fb && _fb.getMode ? _fb.getMode() : "orchestrate";
      const _fbState = _fb && _fb.getState ? (_fb.getState().state || "idle") : "idle";
      if ((_fbMode === "relay" || _fbMode === "discuss") && (_fbState === "running" || _fbState === "paused")) {
        lastSlotKey = currentSlotKey(); // 同步 key,鱼缸结束后不会误触发清空
        return;
      }
      const curKey = currentSlotKey();
      if (lastSlotKey === curKey) return;
      if (historyEnabled) {
        try {
          const all = loadAllSessions();
          all[lastSlotKey] = session.map(m => ({...m}));
          localStorage.setItem(LS_CHAT_SESSION, JSON.stringify(all));
        } catch {}
      }
      session.length = 0;
      clearUIRows();
      lastSlotKey = curKey;
      if (historyEnabled) restoreSessionIfEnabled();
      updateSpacer();
      scrollToBottom();
      if (window.__navHideReset) window.__navHideReset(); // 4.75 切角色后复位顶栏,清掉残留 nav-hidden 占位块
    });

    // 4.74 移动端历史不恢复修复:首次进入时 window.__character 活跃卡可能仍在异步从 IndexedDB 加载,
    // 此刻 currentSlotKey() 落到 __none__ → restoreSessionIfEnabled 恢复了错(空)槽,
    // 用户得手动切单/多智能体触发 character:changed 才显示历史。这里轮询等角色就绪后用正确 slotKey 补恢复一次。
    if (historyEnabled) {
      let _rtTries = 0;
      const _rtTimer = setInterval(() => {
        _rtTries++;
        const _realKey = currentSlotKey();
        if (_realKey !== lastSlotKey) {
          session.length = 0;
          clearUIRows();
          restoreSessionIfEnabled();
          renderSummaryChip();
          updateSpacer();
          scrollToBottom();
          if (window.__navHideReset) window.__navHideReset(); // 4.75 历史恢复后复位顶栏,消灭占位块
          lastSlotKey = _realKey;
          clearInterval(_rtTimer);
        } else if (_rtTries > 50) {
          clearInterval(_rtTimer); // 最多等 ~5s;slotKey 未变说明初始恢复已正确
        }
      }, 100);
    }
  }

  // 暴露给 multi-agent.js / fishbowl-engine.js
  // 暴露 applyThinkDisplay 给 settings.js 切换显示模式时调用
  window.__app = { updateSpacer, sendOne, abortCurrent, injectModeratorMsg, continueGroupChat, showTyping, hideTyping, getConvBaseKey: convBaseKey, listConversations, switchConversation, createConversation, renameConversation, deleteConversation, applyThinkDisplay, applyAllThinkDisplay: () => document.querySelectorAll(".reasoning-block").forEach(applyThinkDisplay) };

  // 云同步 + Auth UI 已迁移到 settings.js

  init();
})();