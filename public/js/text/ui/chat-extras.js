// chat-extras.js —— 主聊天两个增强入口(接管左栏「文件上传」+「多开聊天」按钮)
// 路径: public/js/text/ui/chat-extras.js
// ① 文件上传:读纯文本/代码文件,内容以代码块注入输入框,随下条消息发给 AI(完全不碰发送核心)
// ② 多开聊天:同一角色的多条命名会话,列表式切换(底层走 window.__app 的会话槽 hooks)
(function () {
  if (window.__chatExtras) return;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // ───────── ① 文件上传 ─────────
  var TEXT_EXT = /\.(txt|text|md|markdown|mdx|rst|json|jsonc|json5|csv|tsv|log|ya?ml|toml|ini|conf|env|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|vue|svelte|py|rb|go|rs|java|kt|c|h|cpp|hpp|cc|cs|php|sh|bash|zsh|sql|graphql|gql|lua|dart|swift|r|pl)$/i;
  var MAX_CHARS = 20000;
  var FENCE = "\x60\x60\x60"; // 三个反引号,避免源码里出现连续反引号

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || "")); };
      fr.onerror = function () { reject(fr.error || new Error("读取失败")); };
      fr.readAsText(file);
    });
  }
  function insertIntoComposer(text) {
    var msg = $("msg");
    if (!msg) { alert("输入框未就绪"); return; }
    var cur = msg.value || "";
    msg.value = cur ? (cur.replace(/\s+$/, "") + "\n\n" + text) : text;
    try { msg.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    msg.focus();
    try { msg.setSelectionRange(msg.value.length, msg.value.length); } catch (e) {}
  }
  function handleFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var skipped = [];
    var jobs = list.map(function (f) {
      if (!TEXT_EXT.test(f.name) && !/^text\//.test(f.type || "")) { skipped.push(f.name); return Promise.resolve(null); }
      return readAsText(f).then(function (txt) {
        var truncated = false;
        if (txt.length > MAX_CHARS) { txt = txt.slice(0, MAX_CHARS); truncated = true; }
        return "【文件:" + f.name + "】\n" + FENCE + "\n" + txt + "\n" + FENCE + (truncated ? "\n(内容过长,已截断到前 " + MAX_CHARS + " 字)" : "");
      }).catch(function () { skipped.push(f.name + "(读取失败)"); return null; });
    });
    Promise.all(jobs).then(function (blocks) {
      var ok = blocks.filter(Boolean);
      if (ok.length) insertIntoComposer(ok.join("\n\n"));
      if (skipped.length) alert("以下文件被跳过(仅支持纯文本/代码文件):\n" + skipped.join("\n"));
    });
  }
  var fileInput = null;
  function ensureFileInput() {
    if (fileInput) return fileInput;
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.accept = ".txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,.xml,.html,.css,.js,.ts,.jsx,.tsx,.vue,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.php,.sh,.sql,text/*";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", function () { handleFiles(fileInput.files); fileInput.value = ""; });
    document.body.appendChild(fileInput);
    return fileInput;
  }
  function openFilePicker() { ensureFileInput().click(); }

  // ───────── ② 多开聊天面板 ─────────
  function app() { return window.__app || null; }
  var mask = null, listWrap = null, newBtn = null;
  function ensureStyles() {
    if ($("ceStyles")) return;
    var s = document.createElement("style");
    s.id = "ceStyles";
    s.textContent = [
      ".ce-btn{font-size:12px;padding:6px 10px;border:1px solid rgba(127,127,127,.32);border-radius:8px;background:rgba(127,127,127,.06);color:inherit;cursor:pointer;}",
      ".ce-btn:hover{background:rgba(127,127,127,.16);}",
      ".ce-btn-primary{background:rgba(154,163,255,.16);border-color:rgba(154,163,255,.4);font-weight:600;}",
      ".ce-conv{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(127,127,127,.22);border-radius:10px;cursor:pointer;transition:border-color .15s,background .15s;}",
      ".ce-conv:hover{border-color:#9aa3ff;background:rgba(154,163,255,.08);}",
      ".ce-conv.active{border-color:#9aa3ff;background:rgba(154,163,255,.14);}",
      ".ce-conv-main{flex:1;min-width:0;}",
      ".ce-conv-name{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ce-conv-prev{font-size:11px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;}",
      ".ce-conv-act{display:flex;gap:4px;flex:none;}",
      ".ce-ic{background:transparent;border:none;color:inherit;opacity:.55;cursor:pointer;padding:3px 6px;border-radius:6px;font-size:11.5px;}",
      ".ce-ic:hover{opacity:1;background:rgba(127,127,127,.18);}",
      // 多开聊天弹窗主题适配:原 panel 用 var(--panel,#16161e),--panel 从未定义→恒深色不跟随主题。改 .ce-panel class + 四主题覆盖。
      ".ce-panel{width:min(440px,92vw);max-height:80vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:#16161e;color:#eaeaea;border:1px solid rgba(127,127,127,.25);box-shadow:0 12px 40px rgba(0,0,0,.4);}",
      "html:not([data-theme]):not([data-scheme=\"dark\"]) .ce-panel{background:#fff;color:#37352f;border-color:#e9e9e7;box-shadow:0 30px 80px rgba(15,15,15,.16);}",
      "html[data-theme=\"glass\"] .ce-panel{background:rgba(255,255,255,.97);color:#1a1f2e;border-color:rgba(15,30,60,.1);box-shadow:0 30px 80px rgba(60,80,140,.28);}",
      "html[data-theme=\"lewd-peach\"] .ce-panel{background:rgba(26,8,16,.97);color:#FFE8EF;border-color:rgba(255,107,157,.32);box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 60px rgba(255,107,157,.18);}",
      "html[data-theme=\"lewd-doll\"] .ce-panel{background:rgba(255,255,255,.97);color:#4A0820;border-color:rgba(139,0,51,.22);box-shadow:0 30px 80px rgba(139,0,51,.3);}",
      "html[data-theme=\"glass\"] .ce-conv:hover,html[data-theme=\"glass\"] .ce-conv.active{border-color:#6366f1;background:rgba(99,102,241,.12);}",
      "html[data-theme=\"lewd-peach\"] .ce-conv:hover,html[data-theme=\"lewd-peach\"] .ce-conv.active{border-color:#FF6B9D;background:rgba(255,107,157,.14);}",
      "html[data-theme=\"lewd-doll\"] .ce-conv:hover,html[data-theme=\"lewd-doll\"] .ce-conv.active{border-color:#E03060;background:rgba(224,48,96,.12);}"
    ].join("");
    document.head.appendChild(s);
  }
  function ensureModal() {
    if (mask) return mask;
    ensureStyles();
    mask = document.createElement("div");
    mask.id = "ceConvMask";
    mask.style.cssText = "position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);";
    var panel = document.createElement("div");
    panel.className = "ce-panel"; // 主题适配:背景/文字/描边/阴影改由 ensureStyles 的 .ce-panel + 四主题覆盖控制
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(127,127,127,.18);";
    var title = document.createElement("div");
    title.style.cssText = "font-weight:600;font-size:15px;";
    title.textContent = "多开聊天 · 会话列表";
    var headBtns = document.createElement("div");
    headBtns.style.cssText = "display:flex;gap:8px;";
    newBtn = document.createElement("button");
    newBtn.className = "ce-btn ce-btn-primary";
    newBtn.textContent = "+ 新会话";
    newBtn.addEventListener("click", onNew);
    var closeBtn = document.createElement("button");
    closeBtn.className = "ce-btn";
    closeBtn.textContent = "关闭";
    closeBtn.addEventListener("click", closeModal);
    headBtns.appendChild(newBtn);
    headBtns.appendChild(closeBtn);
    head.appendChild(title);
    head.appendChild(headBtns);
    listWrap = document.createElement("div");
    listWrap.style.cssText = "overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;";
    var note = document.createElement("div");
    note.style.cssText = "font-size:11px;opacity:.55;padding:0 16px 14px;line-height:1.6;";
    note.textContent = "每个角色各自独立的多条对话;切换角色会显示该角色的会话。主对话不可删除(可用「新对话·清空」清空它)。提示:需在设置里开启「保留本地历史」,多开会话才会持久保存。";
    panel.appendChild(head);
    panel.appendChild(listWrap);
    panel.appendChild(note);
    mask.appendChild(panel);
    mask.addEventListener("click", function (e) { if (e.target === mask) closeModal(); });
    document.body.appendChild(mask);
    return mask;
  }
  function render() {
    var a = app();
    if (!listWrap) return;
    if (!a || !a.listConversations) { listWrap.innerHTML = '<div style="font-size:12px;opacity:.6;padding:12px;">会话模块未就绪。</div>'; return; }
    var base = a.getConvBaseKey ? a.getConvBaseKey() : "";
    if (base === "__scene__") {
      if (newBtn) newBtn.style.display = "none";
      listWrap.innerHTML = '<div style="font-size:12.5px;opacity:.65;padding:16px;line-height:1.7;">当前是多人 / 群聊场景,整个场景共用一条对话,不支持多开会话。<br>切回单人模式即可对单个角色多开会话。</div>';
      return;
    }
    if (newBtn) newBtn.style.display = "";
    var convs = a.listConversations() || [];
    listWrap.innerHTML = "";
    convs.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "ce-conv" + (c.active ? " active" : "");
      var main = document.createElement("div");
      main.className = "ce-conv-main";
      main.innerHTML = '<div class="ce-conv-name">' + esc(c.name) + (c.active ? ' <span style="color:#9aa3ff;font-weight:400;">· 当前</span>' : '') + '</div>' +
        '<div class="ce-conv-prev">' + (c.count ? esc(c.preview || "(空)") + " · " + c.count + " 条" : "暂无消息") + '</div>';
      main.addEventListener("click", function () { a.switchConversation(c.convId); closeModal(); });
      var act = document.createElement("div");
      act.className = "ce-conv-act";
      if (c.convId) {
        var rn = document.createElement("button");
        rn.className = "ce-ic";
        rn.textContent = "重命名";
        rn.addEventListener("click", function (e) {
          e.stopPropagation();
          var nm = prompt("会话名称", c.name);
          if (nm != null && nm.trim()) { a.renameConversation(c.convId, nm.trim()); render(); }
        });
        var del = document.createElement("button");
        del.className = "ce-ic";
        del.textContent = "删除";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (confirm("删除会话「" + c.name + "」?该对话记录将清除。")) { a.deleteConversation(c.convId); render(); }
        });
        act.appendChild(rn);
        act.appendChild(del);
      }
      row.appendChild(main);
      row.appendChild(act);
      listWrap.appendChild(row);
    });
  }
  function onNew() {
    var a = app();
    if (!a || !a.createConversation) return;
    var def = "新会话 " + new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    var nm = prompt("新会话名称", def);
    if (nm == null) return;
    a.createConversation(nm.trim() || "新会话");
    closeModal();
  }
  function openModal() { ensureModal(); mask.style.display = "flex"; render(); }
  function closeModal() { if (mask) mask.style.display = "none"; }

  // ───────── 4.76: 聊天同步冲突裁决面板 ─────────
  // 同一会话 slot 在两台设备都被改 → sync.js emit "chat-conflict" → 弹此面板让用户选保留哪份
  var cfMask = null, cfList = null, _cfResolvedAny = false;
  function ensureConflictModal() {
    if (cfMask) return cfMask;
    ensureStyles();
    cfMask = document.createElement("div");
    cfMask.id = "ceConflictMask";
    cfMask.style.cssText = "position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5);";
    var panel = document.createElement("div");
    panel.className = "ce-panel";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(127,127,127,.18);";
    var title = document.createElement("div");
    title.style.cssText = "font-weight:600;font-size:15px;";
    title.textContent = "聊天同步冲突";
    var closeBtn = document.createElement("button");
    closeBtn.className = "ce-btn";
    closeBtn.textContent = "稍后处理";
    closeBtn.addEventListener("click", closeConflictModal);
    head.appendChild(title); head.appendChild(closeBtn);
    cfList = document.createElement("div");
    cfList.style.cssText = "overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;";
    var note = document.createElement("div");
    note.style.cssText = "font-size:11px;opacity:.6;padding:0 16px 14px;line-height:1.6;";
    note.textContent = "同一会话在多台设备上都被修改了。请选择保留哪一份:「保留本机」用本设备版本,「保留云端」用另一台设备版本,「两个都留」会把云端版本另存为一条新会话。";
    panel.appendChild(head); panel.appendChild(cfList); panel.appendChild(note);
    cfMask.appendChild(panel);
    cfMask.addEventListener("click", function (e) { if (e.target === cfMask) closeConflictModal(); });
    document.body.appendChild(cfMask);
    return cfMask;
  }
  function previewOf(msgs) {
    if (!Array.isArray(msgs) || !msgs.length) return "(空)";
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      if (m && typeof m.content === "string" && m.content.trim()) return m.content.trim().slice(0, 60);
    }
    return "(" + msgs.length + " 条)";
  }
  function slotLabel(slotKey) {
    var a = app();
    try { if (a && a.getConvNameForSlot) { var n = a.getConvNameForSlot(slotKey); if (n) return n; } } catch (e) {}
    return slotKey;
  }
  function renderConflicts() {
    var sync = window.__sync;
    if (!cfList || !sync || !sync.getChatConflicts) return;
    var conflicts = sync.getChatConflicts() || [];
    if (!conflicts.length) { closeConflictModal(); if (_cfResolvedAny) { _cfResolvedAny = false; setTimeout(function () { location.reload(); }, 300); } return; }
    cfList.innerHTML = "";
    conflicts.forEach(function (c) {
      var box = document.createElement("div");
      box.style.cssText = "border:1px solid rgba(127,127,127,.22);border-radius:10px;padding:12px;";
      box.innerHTML =
        '<div style="font-weight:600;font-size:13px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(slotLabel(c.slotKey)) + '</div>' +
        '<div style="font-size:11.5px;opacity:.7;line-height:1.6;margin-bottom:4px;">本机:' + (c.localCount != null ? c.localCount : (c.localMsgs ? c.localMsgs.length : 0)) + ' 条 · ' + esc(previewOf(c.localMsgs)) + '</div>' +
        '<div style="font-size:11.5px;opacity:.7;line-height:1.6;margin-bottom:10px;">云端:' + (c.remoteCount != null ? c.remoteCount : (c.remoteMsgs ? c.remoteMsgs.length : 0)) + ' 条 · ' + esc(previewOf(c.remoteMsgs)) + '</div>' +
        '<div class="cf-acts" style="display:flex;gap:8px;flex-wrap:wrap;"></div>';
      var acts = box.querySelector(".cf-acts");
      [["保留本机", "local", true], ["保留云端", "remote", false], ["两个都留", "fork", false]].forEach(function (def) {
        var b = document.createElement("button");
        b.className = "ce-btn" + (def[2] ? " ce-btn-primary" : "");
        b.textContent = def[0];
        b.addEventListener("click", function () {
          try { window.__sync.resolveChatConflict(c.slotKey, def[1]); _cfResolvedAny = true; } catch (e) {}
          renderConflicts();
        });
        acts.appendChild(b);
      });
      cfList.appendChild(box);
    });
  }
  function openConflictPanel() { ensureConflictModal(); cfMask.style.display = "flex"; renderConflicts(); }
  function closeConflictModal() { if (cfMask) cfMask.style.display = "none"; }
  // 4.77: 其他设备的新对话/更新已合并进本地(无冲突) → 底部提示并提供「刷新查看」,
  // 解决「手机端新建对话同步过来后桌面端不显示、没提示也没弹窗」。
  var mergedToast = null;
  function showMergedToast() {
    if (mergedToast) return; // 已有提示则不重复弹
    ensureStyles();
    mergedToast = document.createElement("div");
    mergedToast.id = "ceMergedToast";
    mergedToast.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10002;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:rgba(20,20,28,.96);color:#eaeaea;border:1px solid rgba(154,163,255,.45);box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:13px;max-width:92vw;";
    var txt = document.createElement("span");
    txt.textContent = "已从其他设备同步到对话更新";
    var refresh = document.createElement("button");
    refresh.className = "ce-btn ce-btn-primary";
    refresh.textContent = "刷新查看";
    refresh.addEventListener("click", function () { location.reload(); });
    var dismiss = document.createElement("button");
    dismiss.className = "ce-btn";
    dismiss.textContent = "稍后";
    dismiss.addEventListener("click", function () { if (mergedToast && mergedToast.parentNode) mergedToast.parentNode.removeChild(mergedToast); mergedToast = null; });
    mergedToast.appendChild(txt);
    mergedToast.appendChild(refresh);
    mergedToast.appendChild(dismiss);
    document.body.appendChild(mergedToast);
    // 若多开会话列表正开着,顺手刷新一次(可直接看到新会话,无需 reload)
    if (mask && mask.style.display !== "none") { try { render(); } catch (e) {} }
  }
  function wireSyncConflicts() {
    var sync = window.__sync;
    if (!sync || sync.__ceConflictWired) return;
    if (sync.onStatus) {
      sync.__ceConflictWired = true;
      sync.onStatus(function (status) {
        if (status === "chat-conflict") openConflictPanel();
        else if (status === "chat-merged") showMergedToast();
      });
    }
    try { if (sync.getChatConflicts && sync.getChatConflicts().length) openConflictPanel(); } catch (e) {}
  }

  // ───────── 接管两个侧栏按钮 ─────────
  function wire() {
    var up = $("fileUploadBtn");
    if (up && !up.__ceWired) { up.__ceWired = true; up.addEventListener("click", openFilePicker); }
    var mc = $("multiChatBtn");
    if (mc && !mc.__ceWired) { mc.__ceWired = true; mc.addEventListener("click", openModal); }
    // 4.76: 等 sync.js 就绪后绑定聊天冲突事件(启动顺序不确定,轮询重试)
    var _cfTries = 0;
    (function tryWireCf() { if (window.__sync) wireSyncConflicts(); else if (_cfTries++ < 15) setTimeout(tryWireCf, 1000); })();
  }
  window.addEventListener("character:changed", function () { if (mask && mask.style.display !== "none") render(); });
  window.addEventListener("multi-agent:changed", function () { if (mask && mask.style.display !== "none") render(); });

  window.__chatExtras = { openFilePicker: openFilePicker, openConversations: openModal, openConflicts: openConflictPanel };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();