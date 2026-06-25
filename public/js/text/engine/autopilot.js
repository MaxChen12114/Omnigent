/* =========================================================================
 * public/js/text/engine/autopilot.js
 * 自驱引擎 —— 单角色叙事自驱循环（与鱼缸 window.__fishbowl 同辈、同形）
 * 设计依据：镜像计划页 §10 / §11 / §12（决策 L/P/Q/M/W 已定，O 默认半自动）
 *
 * 红线 / 边界：
 *  - 只驱动普通 sendOne（RP / ASMR 叙事自驱）。工作模式「一句话做完任务」走
 *    agent 工作 loop（AgentKernel.runAgentLoop），不在本文件（决策 Q / L）。
 *  - 不碰 PROMPT_1/2/3 / META_IDENTITY 解限 base；导演提示词只走「追加层」。
 *  - 与「鱼缸群聊 / agent 工作 loop」同属【驱动权】轴，互斥（同一时刻一个司机）。
 *    agent「工具提供者层」(speak / offer_choices) 可共存，不参与互斥。
 *  - 仅在用户显式 start() 后进入自驱；种子没讲完它不动（§11.4）。
 * ========================================================================= */
(function () {
  'use strict';

  /* ----------------------------- LS keys ------------------------------- */
  const LS = {
    mode:    'cfw_autopilot_mode_v1',          // '' 关 | 'rp' | 'novel'
    auto:    'cfw_autopilot_auto_v1',          // 'half'(默认) | 'full'
    maxSeg:  'cfw_autopilot_max_segments_v1',  // 默认 12，硬顶 HARD_CAP
    gateTts: 'cfw_autopilot_gate_tts_v1',      // '1' = 读完一段再续
    speed:   'cfw_autopilot_arousal_speed_v1', // 每段 arousal 增量档 slow/mid/fast
    climax:  'cfw_autopilot_climax_action_v1', // 'stop' | 'afterglow' | 'wait'
    address: 'cfw_address_mode_v1',            // dialogue|immersive|narration（人称唯一来源 · P）
    choices: 'cfw_choices_freq_v1',            // 'off' | 'fork'(默认) | 'every'
    mood:    'cfw_mood_v1',                     // PROTECTED：arousal 弧线，不同步 / 不被清历史清
    pacing:  'cfw_reply_pacing_delay_v1',       // 复用鱼缸节拍，默认 2200ms
    nsfw:    'cfw_nsfw_mode_v1',                // 0-3，arousal 封顶依据
  };

  const HARD_CAP = 1000;        // 与鱼缸同款硬顶
  const DEFAULT_MAX_SEG = 12;
  const AROUSAL_STEP = { slow: 8, mid: 15, fast: 25 };
  const NSFW_CAP = { 0: 0, 1: 40, 2: 75, 3: 100 };

  /* ----------------------------- helpers ------------------------------- */
  const ls = (k, d = '') => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = () => window.__app || null;

  /* ------------------------------ state -------------------------------- */
  const S = {
    state: 'idle',            // idle | running | paused | ended
    seg: 0,
    endReason: '',
    arousal: 0,
    _abort: false,
    _resume: null,            // 半自动暂停时的 resolver
    _nextUserText: null,      // 用户点选项 / 续写时带入下一拍的文本
    _tickHandlers: [],
  };

  function emit() { S._tickHandlers.forEach((fn) => { try { fn(getState()); } catch (e) {} }); }
  function getState() {
    return {
      state: S.state, seg: S.seg, arousal: S.arousal, endReason: S.endReason,
      mode: ls(LS.mode), auto: ls(LS.auto, 'half'),
    };
  }

  /* ----------------------- 驱动权互斥（§10.8 · L） --------------------- */
  function whoElseDriving() {
    try {
      const fb = window.__fishbowl && window.__fishbowl.getState && window.__fishbowl.getState();
      if (fb && (fb.state === 'running' || fb.state === 'paused')) return 'fishbowl';
    } catch (e) {}
    // TODO(接线): AgentKernel 暂未导出运行标志，落码前补 window.AgentKernel.isRunning()
    try { if (window.AgentKernel && window.AgentKernel.isRunning && window.AgentKernel.isRunning()) return 'agent-loop'; } catch (e) {}
    // TODO(接线): app.js 的 isSending 为闭包私有，若需 start 前判断需挂只读 getter
    try { if (app() && app().isSending) return 'sending'; } catch (e) {}
    return null;
  }

  /* ---------------------- arousal 弧线（RP 模式） ---------------------- */
  function loadArousal() { S.arousal = clamp(num(ls(LS.mood), 0), 0, 100); }
  function saveArousal() { lsSet(LS.mood, S.arousal); }
  function arousalCap() { const c = NSFW_CAP[num(ls(LS.nsfw), 0)]; return c != null ? c : 0; }
  function advanceArousal() {
    const step = AROUSAL_STEP[ls(LS.speed, 'mid')] || AROUSAL_STEP.mid;
    S.arousal = clamp(S.arousal + step, 0, arousalCap());
    saveArousal();
  }
  function arousalPhase() {
    const a = S.arousal;
    if (a < 25) return { name: '铺垫', maxLevel: 1 };
    if (a < 60) return { name: '升温', maxLevel: 2 };
    if (a < 95) return { name: '高潮', maxLevel: 3 };
    return { name: '余韵', maxLevel: 1 };
  }

  /* ------------------- 情绪白名单（决策 M：动态注入） ------------------ */
  function emotionWhitelist() {
    try {
      const tags = window.__ttsEmotion && window.__ttsEmotion.listTags && window.__ttsEmotion.listTags();
      if (Array.isArray(tags) && tags.length) {
        return tags.map((t) => t.emotion + ':' + ((t.levels || []).join('/'))).join('、');
      }
    } catch (e) {}
    return '';
  }

  /* ------------------------ 导演提示词（追加层） ----------------------- */
  function addressContract() {
    switch (ls(LS.address, 'dialogue')) {
      case 'immersive': return '用第二人称直接对“你”说话，可含动作 / 心理 / 场景旁白，旁白用 *…* 或（…）包裹（朗读自动跳过）';
      case 'narration': return '用第三人称小说叙事推进剧情';
      default:          return '用第二人称直接对“你”说话，不写旁白、不写动作描写、不做第三人称叙述';
    }
  }
  function choicesRule() {
    const freq = ls(LS.choices, 'fork');
    if (freq === 'off') return '';
    if (freq === 'every') return '本段末尾追加 [选项] ①… ②…（2-4 条，每条一句走向）[/选项]';
    return '仅当出现 ≥2 个合理走向、需要我拍板方向时，本段末才追加 [选项]（2-4 条）[/选项]；连贯推进 / 高潮 / 动作中段不要给';
  }
  function buildDirectorPrompt(userText) {
    if (userText) return userText; // 用户点了某分支 / 半自动带入的续写文本
    const mode = ls(LS.mode);
    const parts = [];
    if (mode === 'rp') {
      const ph = arousalPhase();
      const wl = emotionWhitelist();
      parts.push('继续推进亲密互动一拍，当前热度 arousal=' + S.arousal + '/100，处于「' + ph.name + '」阶段，向高潮自然升温一拍，节奏别急');
      if (wl) parts.push('每句句首带一个 [情绪:强度] 标签，只能从清单里选：' + wl + '；强度跟 arousal 档位走，本段 level 不超过 ' + ph.maxLevel);
      parts.push(addressContract());
    } else if (mode === 'novel') {
      parts.push('继续推进剧情一拍，约 200-300 字，承接上文，不要收尾');
      parts.push(addressContract());
    } else {
      parts.push('继续');
    }
    const cr = choicesRule();
    if (cr) parts.push(cr);
    parts.push('剧情自然走到尽头时输出 [end]');
    return '（' + parts.join('；') + '）';
  }

  /* --------------------------- 单段生成 -------------------------------- */
  async function generateSegment(userText) {
    const a = app();
    if (!a || typeof a.sendOne !== 'function') throw new Error('window.__app.sendOne 不可用');
    // 程序驱动：传 text + allowEmptyText（与 sendOne / sendOneAgent 同形，已 live 确认）
    await a.sendOne({ text: buildDirectorPrompt(userText), allowEmptyText: true });
  }

  /* ----------------------- 等这段 TTS 读完 ----------------------------- */
  async function gateOnTts() {
    if (ls(LS.gateTts) !== '1') return;
    if (!window.__TAURI__) return;             // 仅 App 有本地 TTS
    const tts = window.__omniTTS;
    if (!tts) return;
    // TODO(接线): tts.js 需暴露 whenIdle()（队列读完 Promise）；暂以轮询兜底
    if (typeof tts.whenIdle === 'function') { await tts.whenIdle(); return; }
    for (let i = 0; i < 600 && !S._abort; i++) {
      if (!tts.isPlaying || !tts.isPlaying()) break;
      await sleep(100);
    }
  }

  /* ------------------------- 读最后一条 AI 文本 ------------------------ */
  function lastAiText() {
    try {
      const els = document.querySelectorAll('#chat .row.ai .bubble.ai');
      const el = els[els.length - 1];
      return el ? (el.innerText || '') : '';
    } catch (e) { return ''; }
  }

  /* --------------- 半自动暂停：交 choices.js 渲染出口 ---------------- */
  // 对齐 choices.js 真实签名：
  //   parseChoices(text) → { clean, options:[{label}] }
  //   renderChoices(options, { onPick(value,isMeta), metaActions, autoSend })
  function waitForResume() { return new Promise((resolve) => { S._resume = resolve; }); }
  function renderPauseExits() {
    let options = [];
    try { options = ((window.__choices && window.__choices.parseChoices(lastAiText())) || {}).options || []; } catch (e) {}
    if (!window.__choices || !window.__choices.renderChoices) return;
    try {
      window.__choices.renderChoices(options, {
        autoSend: false,               // 下一拍由本引擎决定，不直接走 #msg 发送
        metaActions: [
          { label: '▶ 继续', value: '__ap_continue__' },
          { label: '✍️ 自己写', value: '__compose__' }, // choices.js 内部聚焦 #msg（见底部「手动接管」）
        ],
        onPick: (value) => {
          if (value === '__ap_continue__') { resume(); return false; }
          resume({ userText: value });  // 选了某分支 → 作为下一拍导演输入带入
          return false;                 // 返回 false：阻止 choices.js 再发一遍
        },
      });
    } catch (e) {}
  }

  /* ------------------------------ 主循环 ------------------------------- */
  async function runLoop() {
    const maxSeg = clamp(num(ls(LS.maxSeg), DEFAULT_MAX_SEG), 1, HARD_CAP);
    while (!S._abort && S.state === 'running') {
      const userText = S._nextUserText; S._nextUserText = null;
      try { await generateSegment(userText); }
      catch (e) { S.endReason = 'error:' + (e && e.message ? e.message : e); break; }
      if (S._abort) break;

      if (ls(LS.mode) === 'rp') advanceArousal();

      await gateOnTts();
      if (S._abort) break;

      S.seg++;
      const text = lastAiText();
      if (/\[end\]/i.test(text)) { S.endReason = 'end-tag'; break; }
      if (S.seg >= maxSeg) { S.endReason = 'max-seg'; break; }
      if (ls(LS.mode) === 'rp' && S.arousal >= 95 && ls(LS.climax, 'afterglow') === 'stop') {
        S.endReason = 'climax-stop'; break;
      }

      emit();
      if (ls(LS.auto, 'half') === 'half') {
        S.state = 'paused';
        renderPauseExits();
        emit();
        await waitForResume();             // 等用户：继续 / 选项 / 打字
        if (S._abort) break;
        S.state = 'running';
        emit();
      } else {
        await sleep(num(ls(LS.pacing), 2200));   // 全自动：拟人节拍停顿
      }
    }
    if (!S.endReason && S._abort) S.endReason = 'aborted';
    S.state = 'ended';
    try { window.__choices && window.__choices.clearChoices && window.__choices.clearChoices(); } catch (e) {}
    emit();
  }

  /* ------------------------------- API --------------------------------- */
  function start(opts) {
    opts = opts || {};
    if (S.state === 'running' || S.state === 'paused') return { ok: false, reason: 'already-running' };
    if (opts.mode) lsSet(LS.mode, opts.mode);
    const mode = ls(LS.mode);
    if (!mode || mode === 'off') return { ok: false, reason: 'mode-off' };
    if (mode === 'work') return { ok: false, reason: 'work-uses-agent-loop' }; // 决策 Q

    const other = whoElseDriving();
    if (other) {
      if (other === 'fishbowl' && opts.autoStopOthers) { try { window.__fishbowl.stop(); } catch (e) {} }
      else return { ok: false, reason: 'busy:' + other }; // UI 据此提示「先停 X 再开自驱」
    }

    S._abort = false; S.seg = 0; S.endReason = ''; S._nextUserText = null;
    if (mode === 'rp') loadArousal(); else S.arousal = 0;
    S.state = 'running';
    emit();
    runLoop();
    return { ok: true };
  }
  function pause() { if (S.state === 'running') { S.state = 'paused'; renderPauseExits(); emit(); } }
  function resume(opts) {
    opts = opts || {};
    if (S.state !== 'paused') return;
    S._nextUserText = opts.userText || null;
    if (S._resume) { const r = S._resume; S._resume = null; r(); }
    else { S.state = 'running'; emit(); runLoop(); }
  }
  function takeover() { if (S.state !== 'idle' && S.state !== 'ended') stop('takeover'); } // 用户打字接管，自驱让出方向盘
  function stop(reason) {
    S._abort = true;
    S.endReason = S.endReason || reason || 'user-stop';
    if (S._resume) { const r = S._resume; S._resume = null; r(); }
    try { app() && app().abortCurrent && app().abortCurrent(true); } catch (e) {}
    try { window.__abortCurrent && window.__abortCurrent(); } catch (e) {}
    S.state = 'ended';
    try { window.__choices && window.__choices.clearChoices && window.__choices.clearChoices(); } catch (e) {}
    emit();
  }
  function setMode(mode) { lsSet(LS.mode, mode || ''); emit(); }
  function onTick(fn) { if (typeof fn === 'function') S._tickHandlers.push(fn); }

  /* ----------------------- Panic：Shift+Esc 全断 ----------------------- */
  function panic() {
    stop('panic');
    try { window.__omniTTS && window.__omniTTS.stop && window.__omniTTS.stop(); } catch (e) {}
    S.arousal = 0; saveArousal();              // arousal 归零
    emit();
  }
  try {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.shiftKey) { e.preventDefault(); panic(); }
    });
  } catch (e) {}

  window.__autopilot = { start, pause, resume, stop, takeover, getState, setMode, onTick, panic };
})();