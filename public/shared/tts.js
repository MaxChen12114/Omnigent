// public/shared/tts.js
// Omnigent 本地语音 (GPT-SoVITS via 桌面壳 http_request 代理)
// 仅桌面 App 内生效(网页版没有本地 9880、也没有 http_request 代理 → 整个文件空跳过)。
// 自注入:① 每条 AI 回复气泡左下角的 🔊 朗读按钮  ② 设置面板里的「本地语音」卡(参考音频/参考文字/自动朗读)
// 依赖:托盘已「语音·启动服务」(127.0.0.1:9880) + 4.68.0 的 http_request 命令
(function () {
  if (window.__omniTTS) return;

  var LS = {
    ref: "cfw_tts_ref_audio_v1",
    prompt: "cfw_tts_prompt_text_v1",
    auto: "cfw_tts_autoplay_v1",
    port: "cfw_tts_port_v1",
    enabled: "cfw_tts_enabled_v1",
  };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var inApp = !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);

  // App 内的原生语音配置缓存:启动时(及打开设置/试听前)从 Rust 的 tts_get_config 拉一次,作为单一可信源。
  // Rust 把配置存在本地 SQLite 的 settings 命名空间(tts_dir/tts_port/tts_autostart),这里只关心与发声相关的
  // 「端口 / 服务是否在跑」。网页版没有 Tauri,nativeCfg 恒为 null → 自动回退本地缓存,行为不变。
  var nativeCfg = null;
  async function refreshNativeCfg() {
    if (!inApp) return null;
    try {
      nativeCfg = await window.__TAURI__.core.invoke("tts_get_config");
    } catch (e) {
      nativeCfg = null;
      console.warn("[TTS] 读取原生配置失败,暂回退本地缓存", e);
    }
    return nativeCfg;
  }

  function cfg() {
    // 端口以 Rust(tts_get_config)为单一可信源:App 内优先用它;网页版 / 尚未拉到时回退本地缓存默认 9880。
    var nativePort = nativeCfg ? parseInt(nativeCfg.port, 10) : 0;
    return {
      port: nativePort || parseInt(lsGet(LS.port, "9880"), 10) || 9880,
      refAudioPath: lsGet(LS.ref, ""),
      promptText: lsGet(LS.prompt, ""),
      promptLang: "zh",
      textLang: "zh",
      autoplay: lsGet(LS.auto, "0") === "1",
      enabled: lsGet(LS.enabled, "1") === "1",
      // 以下两项仅 App 内有效(来自原生配置),网页版为 null/空,供 UI 据此提示。
      serviceRunning: nativeCfg ? !!nativeCfg.running : null,
      ttsDir: nativeCfg ? (nativeCfg.dir || "") : "",
    };
  }

  // 朗读前清洗:去掉旁白/动作等不该念出来的标记内容,只保留"说出来的话"。
  // 过滤:全角括号（）、半角括号()、方括号【】、星号包裹 *动作* / **强调**。
  function cleanForSpeech(text) {
    return String(text || "")
      .replace(/（[^（）]*）/g, " ")
      .replace(/\([^()]*\)/g, " ")
      .replace(/【[^【】]*】/g, " ")
      .replace(/\*+([^*]+)\*+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 按句切(句末标点处断开),并把微信连发分隔符 || 也当作断句点;丢掉纯标点/空块。
  // 说明:微信连发模式靠 || 把一条回复拆成多个气泡;切回默认输出后模型有时仍残留 ||,
  // 这里统一当成断句,既不会把"竖线"念出来,也不会把整段连成一句串读。
  function splitSentences(text) {
    return String(text || "")
      .replace(/\s*\|+\s*/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .split(/(?<=[。！？!?…\n])/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && /[\u4e00-\u9fa5A-Za-z0-9]/.test(s); });
  }

  // 调一次 /tts 合成单句 → 可播放 Blob(失败返回 null)。
  // opts.refAudioPath / opts.promptText 缺省时回退设置面板里的默认单音色(cfg);
  // 情绪音库(tts-emotion.js)逐句切参考音就是靠传入不同的 refAudioPath 复用这个入口。
  async function synthWith(opts) {
    opts = opts || {};
    var c = cfg();
    var text = opts.text == null ? "" : String(opts.text);
    if (!text) return null;
    var refAudioPath = opts.refAudioPath || c.refAudioPath;
    if (!refAudioPath) return null;
    var payload = {
      text: text,
      text_lang: c.textLang,
      ref_audio_path: refAudioPath,
      prompt_lang: c.promptLang,
      text_split_method: "cut0",
      media_type: "wav",
      streaming_mode: false,
    };
    var promptText = opts.promptText != null ? opts.promptText : c.promptText;
    if (promptText) payload.prompt_text = promptText;
    var res = await window.__TAURI__.core.invoke("http_request", {
      method: "POST",
      url: "http://127.0.0.1:" + c.port + "/tts",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status !== 200 || ("" + (res.content_type || "")).indexOf("audio") < 0) {
      try { console.warn("[TTS] 合成失败", res.status, atob(res.body_base64)); }
      catch (e) { console.warn("[TTS] 合成失败", res.status); }
      return null;
    }
    var bin = atob(res.body_base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: res.content_type || "audio/wav" });
  }
  // 默认单音色合成(读设置面板里那条参考音)= synthWith 不带覆盖
  function synth(sentence) { return synthWith({ text: sentence }); }

  // 顺序播放队列(避免多句重叠)
  var queue = Promise.resolve();
  var curAudio = null;
  function playBlob(blob) {
    return new Promise(function (resolve) {
      var audio = new Audio(URL.createObjectURL(blob));
      curAudio = audio;
      audio.onended = audio.onerror = function () {
        try { URL.revokeObjectURL(audio.src); } catch (e) {}
        if (curAudio === audio) curAudio = null;
        resolve();
      };
      audio.play().catch(function () { resolve(); });
    });
  }
  // 把已合成的 Blob 接到顺序播放队列尾部(情绪音库 speakSmart 用:自己合成 → enqueuePlay 串行播,不重叠)
  function enqueuePlay(blob) {
    if (!blob) return queue;
    queue = queue.then(function () { return playBlob(blob); });
    return queue;
  }

  function speak(text) {
    var c = cfg();
    if (!c.enabled || !inApp) return;
    if (!c.refAudioPath) { console.warn("[TTS] 未设置参考音频路径 → 打开「设置 · 本地语音」填一下"); return; }
    var parts = splitSentences(cleanForSpeech(text));
    parts.forEach(function (s) {
      queue = queue.then(async function () {
        try { var b = await synth(s); if (b) await playBlob(b); }
        catch (e) { console.warn("[TTS] 出错", e); }
      });
    });
    return queue;
  }
  function stop() {
    queue = Promise.resolve();
    if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; }
    // 情绪音库还在合成中的句子也一并断链(Panic / 切歌时不要再追播)
    try { if (window.__ttsEmotion && typeof window.__ttsEmotion.stop === "function") window.__ttsEmotion.stop(); } catch (e) {}
  }

  // 这段队列是否还在播(供自驱 gateOnTts 判断 "读完没")
  function isPlaying() { return !!curAudio; }
  // 当前已入队的朗读全部读完后 resolve(自驱 "读完一段再续" 用;队列为空则立即 resolve)
  function whenIdle() { return queue.catch(function () {}); }

  // 自动朗读 / 🔊 按钮统一入口:情绪音库(tts-emotion.js)就绪且有映射条目 → 逐句切气声;否则走原单音色 speak。
  function autoSpeak(text) {
    var te = window.__ttsEmotion;
    if (inApp && te && typeof te.speakSmart === "function" && typeof te.hasEntries === "function" && te.hasEntries()) {
      try { return te.speakSmart(text); } catch (e) { console.warn("[TTS] speakSmart 出错,回退单音色", e); }
    }
    return speak(text);
  }

  window.__omniTTS = { speak: speak, stop: stop, cfg: cfg, refreshNativeCfg: refreshNativeCfg, isPlaying: isPlaying, whenIdle: whenIdle, synthWith: synthWith, enqueuePlay: enqueuePlay, splitSentences: splitSentences, cleanForSpeech: cleanForSpeech };

  if (!inApp) return; // 网页版:不注入任何 UI,纯空跳过

  // 取一条 AI 消息的可读文本(朗读用)。
  // 2026-06-24: 情绪标签隐藏后气泡显示文本已剥掉 [情绪:强度]/[场景:X];但朗读仍需要这些标签来切音色,
  // 故优先读 hideVoiceTags 转存的原文 dataset.ttsRaw(含标签),没有再回退气泡可见文本。
  function rowText(row) {
    if (!row) return "";
    var b = row.querySelector(".bubble");
    if (!b) return "";
    var raw = b.dataset ? b.dataset.ttsRaw : "";
    var t = (raw != null && raw !== "") ? raw : (b.textContent || "");
    // 2026-06-24 选择信号清洗:朗读前剥掉 [选项]…[/选项] / [opt]…[/opt] 选择信号块,避免把可点选项念出来。
    // 仅清洗"朗读文本",不动 DOM —— 气泡里的隐藏与「渲染成可点芯片」由 choices.js 负责(它直接读 bubble.textContent 提取选项)。
    t = t.replace(/\[选项\][\s\S]*?\[\/选项\]/g, "").replace(/\[opt\][\s\S]*?\[\/opt\]/gi, "");
    return t.trim();
  }

  // 给 AI 气泡注入 🔊 朗读按钮
  var SPK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.2L11.5 18V6L7.2 9.5z"/><path d="M15 8.6a4 4 0 0 1 0 6.8"/><path d="M17.3 6a7 7 0 0 1 0 12"/></svg>';
  function injectBtn(row) {
    if (!row || row.classList.contains("user") || row.classList.contains("pacing-typing")) return;
    if (row.querySelector(".omni-tts-btn")) return;
    var content = row.querySelector(".content");
    if (!content) return;
    var btn = document.createElement("button");
    btn.className = "omni-tts-btn";
    btn.type = "button";
    btn.title = "朗读这条消息";
    btn.setAttribute("aria-label", "朗读");
    btn.innerHTML = SPK_SVG;
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-top:4px;padding:0;border:none;border-radius:6px;background:transparent;color:inherit;opacity:.5;cursor:pointer;transition:opacity .15s,background .15s;";
    btn.addEventListener("mouseover", function () { btn.style.opacity = "1"; btn.style.background = "rgba(127,127,127,.14)"; });
    btn.addEventListener("mouseout", function () { btn.style.opacity = ".5"; btn.style.background = "transparent"; });
    btn.addEventListener("click", function () { hideVoiceTags(row); var t = rowText(row); if (t) { stop(); autoSpeak(t); } });
    var stats = content.querySelector(".stats");
    if (stats) content.insertBefore(btn, stats); else content.appendChild(btn);
  }
  function scanAll() {
    var rows = document.querySelectorAll("#chat .row.ai");
    for (var i = 0; i < rows.length; i++) { injectBtn(rows[i]); hideVoiceTags(rows[i]); }
  }

  // 一条 AI 气泡是否"读得了"(流式已结束、不在打字动画中)
  function isReadable(row) {
    if (!row || row.classList.contains("pacing-typing")) return false;
    if (row.dataset && row.dataset.streaming === "1") return false;
    var b = row.querySelector(".bubble");
    if (b && b.classList.contains("wechat-typing")) return false;
    return true;
  }
  function markSeen(row) { if (row && row.dataset) row.dataset.omniTtsAuto = "1"; }

  // 2026-06-24 情绪标签「彻底隐藏但仍能朗读」:气泡流式结束后,把句首/行内 [情绪:强度]/[场景:X]/[基调:X]
  // 语音标签从「显示文本」剥掉,同时把含标签原文转存到 bubble.dataset.ttsRaw —— rowText 朗读时优先取它,
  // speakSmart 仍能据标签切音色。仅匹配带冒号的「键:值」标签 → wechat 表情码 [害羞]、[选项] 这类无冒号方括号不动。
  // 收口:仅 App + 情绪库有条目(hasEntries,与白名单注入同条件) + 气泡已成形(isReadable) + 纯文本气泡 + 只处理一次。
  function hideVoiceTags(row) {
    try {
      if (!row) return;
      var te = window.__ttsEmotion;
      if (!te || typeof te.hasEntries !== "function" || !te.hasEntries()) return;
      if (!isReadable(row)) return;
      var b = row.querySelector(".bubble");
      if (!b || !b.dataset || b.dataset.ttsTagHidden === "1") return;
      if (b.children && b.children.length) return; // innerHTML 渲染的 agent/历史气泡不动,免破坏排版
      var raw = b.textContent || "";
      if (!/\[\s*[^\[\]:：\n]{1,8}\s*[:：]\s*[^\[\]\n]{0,12}\s*\]/.test(raw)) { b.dataset.ttsTagHidden = "1"; return; }
      var shown = raw.replace(/\[\s*[^\[\]:：\n]{1,8}\s*[:：]\s*[^\[\]\n]{0,12}\s*\]/g, "").replace(/[ \t]{2,}/g, " ").trim();
      b.dataset.ttsRaw = raw;        // 朗读取原文(含标签)
      b.dataset.ttsTagHidden = "1";
      if (shown && shown !== raw) b.textContent = shown; // 显示去标签
    } catch (e) {}
  }

  // 自动朗读:按出现顺序逐条读"还没读过且已成形"的 AI 气泡。
  // 微信连发会把一条回复拆成多个气泡(多个 .row.ai),旧逻辑只读最后一个 → 跳过了前面的句子;
  // 现在按 DOM 顺序补齐,从第一句起读;遇到还在打字的气泡就停下等下一次,保证顺序不串、不跳第一句。
  // speak() 内部有播放队列,逐条排队,不会重叠。
  var autoTimer = null;
  function maybeAutoplay() {
    if (!cfg().autoplay) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      var rows = document.querySelectorAll("#chat .row.ai");
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.dataset && row.dataset.omniTtsAuto === "1") continue;
        if (!isReadable(row)) break;
        markSeen(row);
        hideVoiceTags(row);
        var t = rowText(row);
        if (t) autoSpeak(t);
      }
    }, 500);
  }

  // TTS 设置卡已迁移至 settings.js 统一挂载
  function injectSettingsCard_REMOVED() {
    var settings = document.getElementById("settings");
    if (!settings || document.getElementById("omniTtsCard")) return;
    var c = cfg();
    var card = document.createElement("div");
    card.className = "card";
    card.id = "omniTtsCard";
    card.innerHTML =
      '<h4>\uD83D\uDD0A 本地语音 (TTS · 仅桌面版)</h4>' +
      '<p>用本机 GPT-SoVITS 把 AI 回复读出来。先在托盘「语音·启动服务」,再填参考音频。<b>仅本设备生效</b>(不进云同步)。</p>' +
      '<div style="margin-top:8px;"><label style="font-size:12px;color:#999;display:block;margin-bottom:4px;">参考音频完整路径 (.wav)</label>' +
      '<input id="omniTtsRef" type="text" placeholder="如 D:\\GPT-SoVITS\\Basesound\\ref.wav" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div>' +
      '<div style="margin-top:10px;"><label style="font-size:12px;color:#999;display:block;margin-bottom:4px;">参考音频对应文字 (可留空)</label>' +
      '<input id="omniTtsPrompt" type="text" placeholder="参考音频里说的那句话" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div>' +
      '<div class="rowline" style="margin-top:10px;"><div class="toggle"><input type="checkbox" id="omniTtsAuto"><label for="omniTtsAuto">自动朗读每条 AI 回复(默认关)</label></div>' +
      '<div class="btns"><button class="smallbtn" id="omniTtsTest" type="button">\u25B6 试听</button></div></div>' +
      '<div id="omniTtsStatus" style="font-size:11px;color:#888;margin-top:8px;"></div>' +
      '<div style="font-size:11px;color:#888;margin-top:8px;">每条 AI 回复左下角也有 \uD83D\uDD0A 按钮可单独朗读。括号/星号/方括号里的旁白动作不会念出来。</div>';
    settings.appendChild(card);
    var refEl = card.querySelector("#omniTtsRef");
    var promptEl = card.querySelector("#omniTtsPrompt");
    var autoEl = card.querySelector("#omniTtsAuto");
    refEl.value = c.refAudioPath;
    promptEl.value = c.promptText;
    autoEl.checked = c.autoplay;
    // 把原生侧语音服务状态(是否在跑 / 端口 / GPT-SoVITS 目录)展示出来,让"配置同步"可见可验证。
    function renderStatus() {
      var s = card.querySelector("#omniTtsStatus");
      if (!s) return;
      var cc = cfg();
      if (cc.serviceRunning === null) { s.textContent = ""; return; }
      s.textContent = cc.serviceRunning
        ? ("✓ 语音服务运行中 · 端口 " + cc.port + (cc.ttsDir ? " · " + cc.ttsDir : ""))
        : ("● 语音服务未启动(端口 " + cc.port + ")— 先在系统托盘点「语音 · 启动服务」");
    }
    renderStatus();
    refEl.addEventListener("change", function () { lsSet(LS.ref, refEl.value.trim()); });
    promptEl.addEventListener("change", function () { lsSet(LS.prompt, promptEl.value.trim()); });
    autoEl.addEventListener("change", function () { lsSet(LS.auto, autoEl.checked ? "1" : "0"); });
    card.querySelector("#omniTtsTest").addEventListener("click", async function () {
      lsSet(LS.ref, refEl.value.trim());
      lsSet(LS.prompt, promptEl.value.trim());
      await refreshNativeCfg(); // 试听前再同步一次原生端口/状态
      renderStatus();
      stop();
      speak("你好呀,现在能听到我说话了吗?");
    });
  }

  async function boot() {
    var chat = document.getElementById("chat");
    if (!chat) { setTimeout(boot, 500); return; }
    // 启动时从原生侧同步一次语音配置(端口/运行状态);失败回退本地缓存,不阻塞 UI 注入。
    await refreshNativeCfg();
    // 启动时把已有的历史 AI 气泡标记为"已读",避免自动朗读把整段历史念一遍(只读启动后的新回复)
    var existing = chat.querySelectorAll(".row.ai");
    for (var i = 0; i < existing.length; i++) markSeen(existing[i]);
    scanAll();
    try {
      var mo = new MutationObserver(function () { scanAll(); maybeAutoplay(); });
      mo.observe(chat, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-streaming"] });
    } catch (e) {}
    // TTS 设置卡由 settings.js 统一挂载
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();