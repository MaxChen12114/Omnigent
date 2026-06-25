// public/theme.js — 主题系统（多维度、事件驱动、未来扩展友好）
//
// 设计原则：
//   1. 多维度正交：style / scheme / accent 三个独立维度，未来还可加 font/density 等
//   2. 事件订阅：所有消费者通过 'theme:changed' 事件统一接收变更，不直接读 LS
//   3. 单一收口：set(patch) 是唯一写入路径，保证 LS / DOM / Settings UI / 订阅者同步
//   4. 可扩展：加新风格只需在 STYLES 加一项 + 写对应 [data-theme="xxx"] CSS
//
// 维度（v1 实现 + 占位）：
//   style:  "minimal" | "glass" | "lewd-peach" | "lewd-doll"   — 写 [data-theme]（minimal 为默认，不写属性）
//   scheme: "dark"    | "light"   — 读写均已收口（set({scheme})，消费者读 my-theme / data-scheme）
//   accent: 字符串               — v1 占位（保留 LS）
//
// API：
//   __theme.get()                     → { style, scheme, accent }
//   __theme.set(patch)                → 增量更新（任意子集），触发 'theme:changed'
//   __theme.is("light" | "dark")      → 给散落消费者一个稳定快捷判断
//   __theme.styles()                  → ["minimal", "glass", ...] 未来扩展只改 STYLES
//   __theme.subscribe(fn)             → 返回 unsubscribe；fn(detail) 收到 { style, scheme, accent }
//
// 事件：window 'theme:changed' detail = { style, scheme, accent }
//
// LS keys：
//   cfw_theme_v1          ← style
//   my-theme              ← scheme（legacy 名称保留，避免散落消费者炸）
//   cfw_theme_accent_v1   ← accent（占位）
//
// 注意：minimal/glass 的 FOUC 防闪烁仍由 index.html <head> 内联 inline script 完成；
// 本文件加载后会幂等再应用一次。
(function () {
"use strict";

// v2：多维度 + lewd 子风格 + Pulse 单例 + 音频控制
// 未来扩展只改这里：加新风格 ID + 在 styles.css 加 [data-theme="xxx"] 规则即可
const STYLES = ["minimal", "glass", "lewd-peach", "lewd-doll"];
const LEWD_STYLES = ["lewd-peach", "lewd-doll"];
const AUDIO_URL = "/assets/lewd-ambient.mp3";

const LS_STYLE     = "cfw_theme_v1";
const LS_SCHEME    = "my-theme";
const LS_ACCENT    = "cfw_theme_accent_v1";
const LS_AUDIO_ON  = "cfw_audio_enabled_v1";
const LS_AUDIO_VOL = "cfw_audio_volume_v1";

// 4.22: 背景音「可选音源」—— 复用现有 Pulse 音频系统,但音源可被 UI 配置覆盖。
// 优先级: UI 配置 URL > 本机上传(base64) > 默认 lewd 氛围音。
// 注意: 仍受 Pulse 约束(仅 lewd 主题 + 音频开启时播放);外链需 CORS,否则 Web Audio 分析管线会静音。
function audioSrc() {
  try {
    const o = JSON.parse(localStorage.getItem("cfw_ui_overrides_v1") || "{}");
    const a = o && o.audio;
    if (a && a.src) {
      if (a.src === "__local__") {
        const as = JSON.parse(localStorage.getItem("cfw_ui_assets_v1") || "{}");
        if (as && as.audioData) return as.audioData;
      } else {
        return a.src;
      }
    }
  } catch (e) {}
  return AUDIO_URL;
}

const getStyle  = () => {
  const v = localStorage.getItem(LS_STYLE);
  return STYLES.includes(v) ? v : "minimal";
};
// 各主题的「原生」明暗:未显式选择 scheme 时跟随各自气质
const NATIVE_SCHEME = { "minimal": "dark", "glass": "light", "lewd-peach": "dark", "lewd-doll": "light" };
// v1 已接入明暗双态的主题(逐步扩展;UI 仅对这些主题显示日/夜切换)
const SCHEME_READY = new Set(["minimal"]);
const getStoredScheme = () => {
  const v = localStorage.getItem(LS_SCHEME);
  return v === "light" || v === "dark" ? v : null;
};
// 有效 scheme = 显式选择 > 当前主题原生
const getScheme = () => getStoredScheme() || NATIVE_SCHEME[getStyle()] || "dark";
const getAccent = () => localStorage.getItem(LS_ACCENT) || "default";
const getAll    = () => ({ style: getStyle(), scheme: getScheme(), accent: getAccent() });

const getAudioEnabled = () => {
  const v = localStorage.getItem(LS_AUDIO_ON);
  return v === null ? true : v === "1";  // 默认开
};
const getVolume = () => {
  const v = parseFloat(localStorage.getItem(LS_AUDIO_VOL));
  return isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
};
const isLewd = (s) => LEWD_STYLES.includes(s || getStyle());

function applyStyle(s) {
  if (s === "minimal" || !STYLES.includes(s)) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", s);
  }
  applyScheme();
  if (document.body) document.body.dataset.audioDisabled = String(!getAudioEnabled());
}

// 明暗维度:作为 data-scheme 覆盖在 data-theme(主题气质)之上;v1 极简已支持双态
function applyScheme() {
  document.documentElement.setAttribute("data-scheme", getScheme());
}

// ═══ Pulse 单例：Web Audio API 驱动 --pulse 0~1 ═══
const Pulse = (() => {
  let ctx = null;
  let audioEl = null;
  let source = null;
  let analyser = null;
  let gainNode = null;
  let rafId = null;
  let unlocked = false;
  let running = false;
  let fallbackTimer = null;
  let fallbackPhase = 0;

  function setPulseVar(v) {
    document.documentElement.style.setProperty("--pulse", v.toFixed(3));
  }
  function setPulseClass(on) {
    document.documentElement.classList.toggle("pulse-on", !!on);
  }

  function tick() {
    if (!analyser) { rafId = requestAnimationFrame(tick); return; }
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    const avg = sum / buf.length / 255;
    const eased = Math.min(1, Math.max(0, avg * 1.8));
    setPulseVar(eased);
    rafId = requestAnimationFrame(tick);
  }

  // 无音频时的 CSS-only 慢摆，让 --pulse 仍有节奏
  function startFallback() {
    if (fallbackTimer) return;
    fallbackTimer = setInterval(() => {
      fallbackPhase += 0.05;
      const v = 0.4 * (Math.sin(fallbackPhase * 1.4) * 0.5 + 0.5);
      setPulseVar(v);
    }, 50);
  }
  function stopFallback() {
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
  }

  async function start() {
    if (!isLewd() || !getAudioEnabled()) return;
    if (running) return;
    if (!unlocked) { startFallback(); return; }
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") await ctx.resume();

      if (!audioEl) {
        audioEl = new Audio(audioSrc());
        audioEl.loop = true;
        audioEl.crossOrigin = "anonymous";
        audioEl.preload = "auto";
        audioEl.addEventListener("error", () => {
          console.warn("[theme] audio load failed, fallback only");
          startFallback();
        });
      }

      if (!source) {
        try {
          source = ctx.createMediaElementSource(audioEl);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          gainNode = ctx.createGain();
          source.connect(analyser);
          analyser.connect(gainNode);
          gainNode.connect(ctx.destination);
        } catch (e) {
          console.warn("[theme] audio graph reuse:", e);
        }
      }

      if (gainNode) gainNode.gain.value = getVolume();

      try {
        await audioEl.play();
      } catch (e) {
        console.warn("[theme] audio play blocked, fallback only:", e);
        startFallback();
        return;
      }

      stopFallback();
      running = true;
      setPulseClass(true);
      if (!rafId) tick();
    } catch (e) {
      console.warn("[theme] Pulse start failed:", e);
      startFallback();
    }
  }

  function stop({ fade = true } = {}) {
    running = false;
    setPulseClass(false);
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    stopFallback();
    setPulseVar(0);
    if (audioEl && !audioEl.paused) {
      if (fade && gainNode && ctx) {
        try {
          const now = ctx.currentTime;
          const startVol = gainNode.gain.value;
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(startVol, now);
          gainNode.gain.linearRampToValueAtTime(0, now + 0.2);
          setTimeout(() => {
            try { audioEl.pause(); gainNode.gain.value = getVolume(); } catch (e) {}
          }, 220);
        } catch (e) {
          try { audioEl.pause(); } catch (_) {}
        }
      } else {
        try { audioEl.pause(); } catch (e) {}
      }
    }
  }

  function setVolume(v) {
    if (gainNode) gainNode.gain.value = v;
    if (audioEl)  audioEl.volume = v;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (isLewd() && getAudioEnabled()) {
      running = false;
      start();
    }
  }

  function sync() {
    if (isLewd() && getAudioEnabled()) start();
    else stop({ fade: true });
  }

  return { start, stop, setVolume, unlock, sync };
})();

// ═══ set / panic / audio 收口 ═══
function set(patch) {
  patch = patch || {};
  if (patch.style && STYLES.includes(patch.style)) {
    try { localStorage.setItem(LS_STYLE, patch.style); } catch (e) {}
    applyStyle(patch.style);
  }
  if (patch.scheme === "light" || patch.scheme === "dark") {
    try { localStorage.setItem(LS_SCHEME, patch.scheme); } catch (e) {}
    applyScheme();
  } else if (patch.scheme === "auto" || patch.scheme === null) {
    try { localStorage.removeItem(LS_SCHEME); } catch (e) {}
    applyScheme();
  }
  if (patch.accent) {
    try { localStorage.setItem(LS_ACCENT, patch.accent); } catch (e) {}
  }
  document.querySelectorAll('input[name="cfwTheme"]').forEach(r => {
    r.checked = (r.value === getStyle());
  });
  Pulse.sync();
  // 2026-05-29 lewd ↔ nsfwLevel 联动: lewd-* 主题 = NSFW L2 露骨, minimal/glass = L0 关闭
  // worker.js 接收到 nsfwLevel >= 1 时跳过 META_IDENTITY,改注入 buildNsfwInstruction(L)
  try { localStorage.setItem("cfw_nsfw_mode_v1", isLewd() ? "2" : "0"); } catch (e) {}
  window.dispatchEvent(new CustomEvent("theme:changed", { detail: getAll() }));
}

function panic() {
  Pulse.stop({ fade: false });
  set({ style: "minimal" });
}

const audio = {
  get: () => ({ enabled: getAudioEnabled(), volume: getVolume() }),
  set: ({ enabled, volume } = {}) => {
    if (typeof enabled === "boolean") {
      try { localStorage.setItem(LS_AUDIO_ON, enabled ? "1" : "0"); } catch (e) {}
      if (document.body) document.body.dataset.audioDisabled = String(!enabled);
    }
    if (typeof volume === "number" && volume >= 0 && volume <= 1) {
      try { localStorage.setItem(LS_AUDIO_VOL, String(volume)); } catch (e) {}
      Pulse.setVolume(volume);
    }
    Pulse.sync();
    window.dispatchEvent(new CustomEvent("theme:audio-changed", { detail: audio.get() }));
  },
};

const is = (scheme) => getScheme() === scheme;
const styles = () => STYLES.slice();
function subscribe(fn) {
  const h = (e) => fn(e.detail || getAll());
  window.addEventListener("theme:changed", h);
  return () => window.removeEventListener("theme:changed", h);
}

window.__theme = { get: getAll, set, is, styles, subscribe, panic, audio };

// 解析时立即应用一次明暗维度,减少 data-scheme 迟到造成的闪烁
try { applyScheme(); } catch (e) {}

// ═══ 4.71: 自挂载设置卡 ═══
// 把「外观风格」+「主题音效」两张卡的 DOM 从 index.html 收口到本模块。
// index.html 仅保留空槽 <div id="setAppearanceThemeSlot"></div>(外观分类、#setAppearanceTopSlot 之后)。
// 槽不存在 / 已挂载时静默跳过:兼容尚未改 index.html 的旧页面(此时静态卡仍在,wireSettings 照常绑定),且防重复挂载。
function mountCard() {
  const slot = document.getElementById("setAppearanceThemeSlot");
  if (!slot || slot.dataset.mounted === "1") return;
  slot.dataset.mounted = "1";
  slot.innerHTML = `
        <div class="card">
          <h4>外观风格(Visual Theme)</h4>
          <p>
            切换桌面 UI 视觉风格。<b>极简</b> = 深色平面、低干扰、阅读优先;<b>毛玻璃</b> = 亮色渐变 + 半透模糊。
            <span data-nsfw><b>蜜桃 / 少女</b> = 暖色双主题,带呼吸脉动效果(启动音频需点击页面一次解锁)。</span>设置实时生效并保存到本地。
          </p>
          <div class="theme-options">
            <label class="theme-option">
              <input type="radio" name="cfwTheme" value="minimal">
              <span class="theme-swatch theme-swatch-minimal" aria-hidden="true"></span>
              <span class="theme-text">
                <span class="theme-title">极简 Minimal</span>
                <span class="theme-sub">深色 · 平面 · 高对比</span>
              </span>
            </label>
            <label class="theme-option">
              <input type="radio" name="cfwTheme" value="glass">
              <span class="theme-swatch theme-swatch-glass" aria-hidden="true"></span>
              <span class="theme-text">
                <span class="theme-title">毛玻璃 Glass</span>
                <span class="theme-sub">亮色 · 渐变 · 半透模糊</span>
              </span>
            </label>
            <label class="theme-option" data-nsfw>
              <input type="radio" name="cfwTheme" value="lewd-peach">
              <span class="theme-swatch theme-swatch-lewd-peach" aria-hidden="true"></span>
              <span class="theme-text">
                <span class="theme-title">蜜桃 Peach</span>
                <span class="theme-sub">暗色底 · 暖粉调</span>
              </span>
            </label>
            <label class="theme-option" data-nsfw>
              <input type="radio" name="cfwTheme" value="lewd-doll">
              <span class="theme-swatch theme-swatch-lewd-doll" aria-hidden="true"></span>
              <span class="theme-text">
                <span class="theme-title">少女 Doll</span>
                <span class="theme-sub">亮粉底 · 反差色</span>
              </span>
            </label>
          </div>
          <div class="settings-tip" data-nsfw>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg>
            <span>蜜桃/少女主题需要 <code>/assets/lewd-ambient.mp3</code>(自配 CC0 心跳/呼吸 loop,仓库不打包版权资源)。无音频时走 CSS 慢呼吸 fallback。Shift+Esc 可紧急切回极简。</span>
          </div>
        </div>

        <div class="card" data-nsfw>
          <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17V6l9-1.8V15"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="15.5" cy="15.2" r="2.5"/></svg>主题音效(Ambient Audio)</h4>
          <p>
            控制 <b>蜜桃 / 少女</b> 主题下的环境音和呼吸脉动。<b>关闭后</b>即使切到这两个主题也不会发声、不脉动(背景仍是配色)。其他主题不受影响。设置仅本设备生效(不进云同步)。
          </p>
          <div class="rowline">
            <div class="toggle">
              <input type="checkbox" id="lewdAudioToggle">
              <label for="lewdAudioToggle">启用主题音频 + 脉动</label>
            </div>
            <div class="btns">
              <button class="smallbtn danger" id="lewdAudioPanic" title="立即暂停 + 切回极简主题(等同 Shift+Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>紧急停止</button>
            </div>
          </div>
          <div class="rowline" style="margin-top:8px;align-items:center;">
            <label for="lewdAudioVolume" style="font-size:12px;color:#aaa;min-width:60px;">音量</label>
            <input type="range" id="lewdAudioVolume" min="0" max="100" step="1" style="flex:1;margin:0 12px;">
            <span id="lewdAudioVolumeLabel" style="font-size:11px;color:#888;min-width:40px;text-align:right;">70%</span>
          </div>
          <div class="settings-tip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg>
            <span><b>Shift+Esc</b> 是全局紧急停止快捷键,按下后自动切回极简主题。首次启动需点击页面任意位置一次解锁浏览器音频权限。</span>
          </div>
        </div>`;
}

// ═══ wire Settings DOM ═══
// 日/夜切换控件(运行时注入到主题选择上方;仅对已接入双态的主题显示)
function refreshSchemeToggle() {
  const row = document.getElementById("cfwSchemeRow");
  if (!row) return;
  row.style.display = SCHEME_READY.has(getStyle()) ? "" : "none";
  const stored = getStoredScheme();
  row.querySelectorAll("button[data-scheme-val]").forEach((b) => {
    const v = b.getAttribute("data-scheme-val");
    const on = (v === "auto" && !stored) || v === stored;
    b.classList.toggle("active", on);
  });
}

function ensureSchemeToggle() {
  if (document.getElementById("cfwSchemeRow")) { refreshSchemeToggle(); return; }
  const firstRadio = document.querySelector('input[name="cfwTheme"]');
  if (!firstRadio) return;
  const opt = firstRadio.closest(".theme-option") || firstRadio.parentElement;
  const list = opt ? opt.parentElement : null;
  if (!list || !list.parentElement) return;
  const row = document.createElement("div");
  row.id = "cfwSchemeRow";
  row.className = "scheme-toggle-row";
  row.innerHTML =
    '<span class="stg-label">明暗</span>' +
    '<div class="scheme-seg">' +
      '<button type="button" data-scheme-val="auto">跟随主题</button>' +
      '<button type="button" data-scheme-val="light">日间</button>' +
      '<button type="button" data-scheme-val="dark">夜间</button>' +
    '</div>';
  list.parentElement.insertBefore(row, list);
  row.querySelectorAll("button[data-scheme-val]").forEach((b) => {
    b.addEventListener("click", () => {
      set({ scheme: b.getAttribute("data-scheme-val") });
      refreshSchemeToggle();
    });
  });
  refreshSchemeToggle();
}

function wireSettings() {
  document.querySelectorAll('input[name="cfwTheme"]').forEach(r => {
    r.checked = (r.value === getStyle());
    r.addEventListener("change", () => {
      if (!r.checked) return;
      if (STYLES.includes(r.value)) set({ style: r.value });
    });
  });

  ensureSchemeToggle();
  subscribe(refreshSchemeToggle);

  const toggleEl = document.getElementById("lewdAudioToggle");
  if (toggleEl) {
    toggleEl.checked = getAudioEnabled();
    toggleEl.addEventListener("change", () => {
      audio.set({ enabled: !!toggleEl.checked });
    });
  }

  const volEl  = document.getElementById("lewdAudioVolume");
  const volLbl = document.getElementById("lewdAudioVolumeLabel");
  const curVol = getVolume();
  if (volEl) {
    volEl.value = String(Math.round(curVol * 100));
    if (volLbl) volLbl.textContent = Math.round(curVol * 100) + "%";
    volEl.addEventListener("input", () => {
      const v = Math.max(0, Math.min(1, parseInt(volEl.value, 10) / 100));
      if (volLbl) volLbl.textContent = Math.round(v * 100) + "%";
      audio.set({ volume: v });
    });
  }

  const panicEl = document.getElementById("lewdAudioPanic");
  if (panicEl) panicEl.addEventListener("click", panic);
}

window.addEventListener("load", () => {
  mountCard();
  applyStyle(getStyle());
  wireSettings();
  // 2026-05-29: 启动时同步一次 lewd ↔ nsfwLevel (避免首次进页不点设置时 LS 状态不同步)
  try { localStorage.setItem("cfw_nsfw_mode_v1", isLewd() ? "2" : "0"); } catch (e) {}

  // 首次任意交互解锁 AudioContext
  const unlockOnce = () => {
    Pulse.unlock();
    window.removeEventListener("pointerdown", unlockOnce);
    window.removeEventListener("keydown", unlockOnce);
    window.removeEventListener("touchstart", unlockOnce);
  };
  window.addEventListener("pointerdown", unlockOnce, { once: true });
  window.addEventListener("keydown",    unlockOnce, { once: true });
  window.addEventListener("touchstart", unlockOnce, { once: true });

  // Shift+Esc 全局紧急停止
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.shiftKey) {
      e.preventDefault();
      panic();
    }
  });

  Pulse.sync();
});
})();