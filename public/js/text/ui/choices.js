// public/js/text/ui/choices.js —— 选项分支 / galgame 式「下一步」芯片条
// 路径: public/js/text/ui/choices.js
// 职责: 解析 AI 回复里的 [选项]…[/选项] 协议块 → 在输入框上方渲染可点芯片;
//       点击 = 以该选项文本作为用户消息发送(复用 #msg 输入框 + 回车, 零侵入 app.js)。
// 三个入口共用本模块:
//   ① 正常对话·agent 关: MutationObserver 扫描收尾的 AI 气泡里的 [选项] 标签(autoScan)
//   ② 正常对话·agent 开 / 自驱: 由 agent 工具 offer_choices 或 autopilot 显式调 renderChoices(options)
//   ③ 任意位置: parseAndRender(rawText, opts) 一步解析+渲染
// 暴露: window.__choices = { parseChoices, renderChoices, clearChoices, parseAndRender, autoScan }
(function () {
  if (window.__choices) return;

  var BAR_ID = "omniChoicesBar";
  var STYLE_ID = "omniChoicesStyle";
  var OPENS = ["[选项]", "[opt]", "[OPT]"];
  var CLOSES = { "[选项]": "[/选项]", "[opt]": "[/opt]", "[OPT]": "[/OPT]" };

  function $(id) { return document.getElementById(id); }

  function ensureStyle() {
    if ($(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#" + BAR_ID + "{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;margin:0 0 8px;border-radius:12px;background:rgba(127,127,127,.06);border:1px solid rgba(127,127,127,.18);animation:ocFade .18s ease;}",
      "@keyframes ocFade{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}",
      "#" + BAR_ID + " .oc-hint{flex:0 0 100%;font-size:11px;opacity:.5;margin-bottom:2px;}",
      ".oc-chip{font-size:13px;line-height:1.3;padding:7px 12px;border-radius:999px;cursor:pointer;border:1px solid rgba(154,163,255,.4);background:rgba(154,163,255,.12);color:inherit;transition:background .15s,border-color .15s,transform .1s;text-align:left;max-width:100%;}",
      ".oc-chip:hover{background:rgba(154,163,255,.22);border-color:#9aa3ff;}",
      ".oc-chip:active{transform:scale(.97);}",
      ".oc-chip.oc-meta{border-style:dashed;border-color:rgba(127,127,127,.4);background:rgba(127,127,127,.06);opacity:.85;}",
      ".oc-chip.oc-meta:hover{opacity:1;background:rgba(127,127,127,.16);}"
    ].join("");
    document.head.appendChild(s);
  }

  // 找到输入框上方的挂载锚点(优先 .input-floating, 回落 #msg 容器)
  function composerHost() {
    var fl = document.querySelector(".input-floating");
    if (fl) return fl;
    var msg = $("msg");
    return (msg && msg.parentElement) || null;
  }

  // 发送一条用户消息: 复用 #msg + 回车(与 chat-ux.js resend 同款已验证路径)
  function sendAsUser(text) {
    var msg = $("msg");
    if (!msg) {
      if (window.__app && window.__app.sendOne) window.__app.sendOne({ text: text });
      return;
    }
    msg.value = text;
    try { msg.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    msg.focus();
    setTimeout(function () {
      msg.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }, 10);
  }

  // 用 indexOf 定位 [选项]…[/选项] 块(不用正则, 避免转义坑)
  function findBlock(src) {
    for (var i = 0; i < OPENS.length; i++) {
      var o = OPENS[i];
      var start = src.indexOf(o);
      if (start < 0) continue;
      var c = CLOSES[o];
      var end = src.indexOf(c, start + o.length);
      if (end < 0) continue;
      return { close: c, start: start, end: end, inner: src.slice(start + o.length, end) };
    }
    return null;
  }

  function stripBullet(t) {
    if (!t) return "";
    t = t.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "");
    t = t.replace(/^\d+[\.、\)]\s*/, "");
    t = t.replace(/^[-•*]\s*/, "");
    return t.trim();
  }

  // 解析 → { clean, options:[{label}] }
  function parseChoices(text) {
    var src = String(text == null ? "" : text);
    var blk = findBlock(src);
    if (!blk) return { clean: src, options: [] };
    var options = [];
    blk.inner.split("\n").forEach(function (line) {
      var t = stripBullet(line.trim());
      if (t) options.push({ label: t });
    });
    var clean = (src.slice(0, blk.start) + src.slice(blk.end + blk.close.length)).trim();
    return { clean: clean, options: options };
  }

  // options: Array<{label,value?}> | Array<string>
  // opts: { onPick?(value,isMeta), includeMeta=true, metaActions?, autoSend=true }
  function renderChoices(options, opts) {
    options = options || [];
    opts = opts || {};
    var norm = options.map(function (o) {
      if (typeof o === "string") return { label: o, value: o };
      return { label: o.label, value: o.value != null ? o.value : o.label };
    }).filter(function (o) { return o.label; });
    var includeMeta = opts.includeMeta !== false;
    if (!norm.length && !includeMeta) { clearChoices(); return null; }

    ensureStyle();
    clearChoices();
    var host = composerHost();
    if (!host) return null;

    var bar = document.createElement("div");
    bar.id = BAR_ID;

    var hint = document.createElement("div");
    hint.className = "oc-hint";
    hint.textContent = norm.length ? "选一个走向 · 或继续打字" : "继续 · 或自己打字";
    bar.appendChild(hint);

    function pick(value, isMeta) {
      try { if (typeof opts.onPick === "function" && opts.onPick(value, isMeta) === false) { clearChoices(); return; } } catch (e) {}
      if (opts.autoSend === false) { clearChoices(); return; }
      sendAsUser(value);
      clearChoices();
    }

    norm.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "oc-chip";
      b.textContent = o.label;
      b.addEventListener("click", function () { pick(o.value, false); });
      bar.appendChild(b);
    });

    if (includeMeta) {
      var metas = opts.metaActions || [
        { label: "继续", value: "继续" },
        { label: "换个走向", value: "换一个走向，给我新的发展" },
        { label: "✍️ 自己写", value: "__compose__" }
      ];
      metas.forEach(function (mAct) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "oc-chip oc-meta";
        b.textContent = mAct.label;
        b.addEventListener("click", function () {
          if (mAct.value === "__compose__") { clearChoices(); var m = $("msg"); if (m) m.focus(); return; }
          pick(mAct.value, true);
        });
        bar.appendChild(b);
      });
    }

    // 挂在输入框上方(host 首子节点, 与 scene-strip 同款)
    if (host.firstChild) host.insertBefore(bar, host.firstChild);
    else host.appendChild(bar);
    return bar;
  }

  function clearChoices() {
    var bar = $(BAR_ID);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  // 一步: 解析原始文本并渲染(autopilot / app.js 收尾钩子可直接调)
  function parseAndRender(rawText, opts) {
    var r = parseChoices(rawText);
    if (r.options.length) renderChoices(r.options, opts);
    return r;
  }

  // 从气泡显示里抹掉原始 [选项] 标签(协议块不该露给用户)
  function stripBlockHtml(el) {
    try {
      var html = el.innerHTML;
      for (var i = 0; i < OPENS.length; i++) {
        var s = html.indexOf(OPENS[i]);
        if (s < 0) continue;
        var e = html.indexOf(CLOSES[OPENS[i]], s);
        if (e < 0) continue;
        el.innerHTML = html.slice(0, s) + html.slice(e + CLOSES[OPENS[i]].length);
        return;
      }
    } catch (e) {}
  }

  var api = {
    parseChoices: parseChoices,
    renderChoices: renderChoices,
    clearChoices: clearChoices,
    parseAndRender: parseAndRender,
    autoScan: true
  };

  // ① autoScan 兜底: 监听 #chat, 扫收尾 AI 气泡里的 [选项] 标签(agent 关时用)
  function scanLatestAiRow(chat) {
    if (!api.autoScan) return;
    var rows = chat.querySelectorAll(".row.ai");
    if (!rows.length) return;
    var row = rows[rows.length - 1];
    if (row.getAttribute("data-streaming") === "1") return; // 流式中, 等收尾
    if (row.dataset.ocDone === "1") return;
    var bubble = row.querySelector(".bubble.ai");
    if (!bubble) return;
    if (!findBlock(bubble.textContent || "")) return;
    row.dataset.ocDone = "1";
    var r = parseChoices(bubble.textContent || "");
    if (!r.options.length) return;
    stripBlockHtml(bubble);
    renderChoices(r.options, {});
  }

  function wire() {
    var chat = $("chat");
    if (!chat) { setTimeout(wire, 600); return; }
    var t = null;
    new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(function () { scanLatestAiRow(chat); }, 120);
    }).observe(chat, { childList: true, subtree: true, characterData: true });
    var sendBtn = $("sendBtn");
    if (sendBtn) sendBtn.addEventListener("click", clearChoices);
    var msg = $("msg");
    if (msg) msg.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) clearChoices(); });
  }

  window.__choices = api;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();