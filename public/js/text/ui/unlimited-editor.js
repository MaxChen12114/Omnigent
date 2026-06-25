/**
 * unlimited-editor.js · 解限编辑器（Unlimited Editor）
 *
 * 项目灵魂的「编辑器壳」—— 区别于正常酒馆聊天，提供独立 Modal 弹窗，
 * 在 base 解限模式之上做 JSON 资产编排：preset / 角色 / 世界观 / UI 配置。
 *
 * 结构：
 *   - 左侧栏 🛠 按钮 → 打开 Modal（z-index:30 高于 settings）
 *   - 顶部 4 tab：Preset · 角色 · 世界观 · UI 配置
 *   - 4 个 tab 均已实质化：preset(cfw_prompt_presets_v1) / 角色(character.js · tavern_chars_v2) / 世界观(lorebook.js · tavern_lorebook_v1) / UI 配置(cfw_ui_overrides_v1 全局覆盖)
 *   - ESC / 遮罩外点击 / ✕ / 底部「关闭」均可关闭
 *
 * 存储方案（KV + 本地）：
 *   - LS（被现有 sync.js 推 KV）：preset / UI 配置 / 世界观文本
 *   - IndexedDB 本地：角色卡 + base64 立绘（不上云）
 *
 * 公开 API：window.__unlimitedEditor = { open, close, switchTab, applyUIOverrides, refresh }
 */
(function(){
  'use strict';

  if (window.__unlimitedEditor) return;

  var MASK_ID = 'unlimitedEditorMask';

  // 4.59 线性图标:解限编辑器标题 + 4 个 Tab 改用与全站一致的 currentColor 线性 SVG(替换 🛠🎯🎭🌐🎨,去掉 v0 骨架角标)
  function ueSvg(d, size){ return '<svg viewBox="0 0 24 24" width="' + (size||16) + '" height="' + (size||16) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px;flex:none;">' + d + '</svg>'; }
  var UE_ICON = {
    wrench: ueSvg('<path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h7M15 17h5"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="17" r="2"/>', 17),
    preset: ueSvg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>'),
    character: ueSvg('<circle cx="12" cy="8.5" r="3.3"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>'),
    world: ueSvg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17"/>'),
    ui: ueSvg('<path d="M4 7h6M14 7h6M4 12h10M18 12h2M4 17h3M11 17h9"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="17" r="2"/>')
  };

  // 4.60 去 emoji:工具栏按钮 / 分区标题 / 占位符统一用线性 SVG(currentColor),替换 ＋↻📋📁📤📥🎨📐🖼🔊⚙️📦⌛
  var UE_A = {
    plus: ueSvg('<path d="M12 5v14M5 12h14"/>', 15),
    reload: ueSvg('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>', 15),
    code: ueSvg('<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>', 15),
    folder: ueSvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 15),
    imp: ueSvg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', 15),
    exp: ueSvg('<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', 15),
    palette: ueSvg('<path d="M12 3a9 9 0 1 0 0 18c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.2-.3-.4-.6-.4-1 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>', 15),
    layout: ueSvg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>', 15),
    image: ueSvg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5L5 20"/>', 15),
    sound: ueSvg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M18.5 7a6 6 0 0 1 0 10"/>', 15),
    gear: ueSvg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 15),
    box: ueSvg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>', 15),
    reset: ueSvg('<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.7 3"/><path d="M3 3v5h5"/>', 15)
  };

  var TABS = [
    {
      id: 'preset', icon: UE_ICON.preset, label: 'Preset 提示词',
      desc: '编辑提示词追加层（PROMPT_1/2/3 之后的语调约束层），管理多个 starter 包。'
    },
    {
      id: 'character', icon: UE_ICON.character, label: '角色卡',
      desc: '编辑角色卡的完整字段（人设/背景/性格/铁则/示例对话）。与左栏「角色卡」共享同一存储 tavern_chars_v2：左栏负责快速切换，这里负责集中管理与编辑。',
    },
    {
      id: 'world', icon: UE_ICON.world, label: '世界观',
      desc: '编辑世界观条目（Lore Book）：地点 / 设定 / 事件线 / 关键词触发。',
    },
    {
      id: 'ui', icon: UE_ICON.ui, label: 'UI 配置',
      desc: '编辑界面 UI 微调层：在 4 主题之上叠加用户偏好（不替换主题，只覆盖变量）。',
    },
    {
      id: 'voice', icon: UE_A.sound, label: '语音情绪',
      desc: '编辑「情绪 × 强度 → 参考音频」映射（emotionMap）。TTS 按 AI 回复里的 [情绪:强度] 标签逐句切换气声参考音；查不到则回落兜底音色。存 cfw_tts_emotion_map_v1，随云同步；逐句切气声朗读仅桌面 App 生效。',
    }
  ];

  var currentTab = 'preset';
  var mask = null;

  function buildDom(){
    if (document.getElementById(MASK_ID)) return;
    ensureStyles();
    mask = document.createElement('div');
    mask.id = MASK_ID;
    mask.innerHTML = [
      '<div id="unlimitedEditor" role="dialog" aria-label="解限编辑器" aria-modal="true">',
        '<div class="ue-header">',
          '<div class="ue-title">' + UE_ICON.wrench + ' 解限编辑器</div>',
          '<button class="ue-close" id="ueCloseBtn" aria-label="关闭" title="关闭(ESC)">✕</button>',
        '</div>',
        '<div class="ue-tabs" id="ueTabs" role="tablist">',
          TABS.map(function(t){
            return '<button class="ue-tab" role="tab" data-tab="' + t.id + '" title="' + escapeAttr(t.label) + '"><span class="ue-tab-icon">' + t.icon + '</span><span class="ue-tab-label">' + escapeHtml(t.label) + '</span></button>';
          }).join(''),
        '</div>',
        '<div class="ue-body" id="ueBody" role="tabpanel"></div>',
        '<div class="ue-footer">',
          '<span class="ue-footer-hint">此处编辑的是 JSON 资产，不会触发聊天。Esc 退出。</span>',
          '<button class="ue-btn-ghost" id="ueFooterClose">关闭</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(mask);

    // 点遮罩外侧关闭（点内容区不关）
    mask.addEventListener('click', function(e){
      if (e.target === mask) close();
    });
    document.getElementById('ueCloseBtn').addEventListener('click', close);
    document.getElementById('ueFooterClose').addEventListener('click', close);

    document.getElementById('ueTabs').addEventListener('click', function(e){
      var btn = e.target.closest && e.target.closest('.ue-tab');
      if (!btn) return;
      switchTab(btn.getAttribute('data-tab'));
    });

    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && mask && mask.classList.contains('open')) close();
    });
  }

  function renderBody(){
    if (currentTab === 'preset') return renderPresetTab();
    if (currentTab === 'character') return renderCharacterTab();
    if (currentTab === 'world') return renderWorldTab();
    if (currentTab === 'ui') return renderUITab();
    if (currentTab === 'voice') return renderVoiceTab();
  }

  function refreshTabs(){
    var btns = document.querySelectorAll('#ueTabs .ue-tab');
    btns.forEach(function(b){
      var on = b.getAttribute('data-tab') === currentTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function findTab(id){
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i];
    return null;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function escapeAttr(s){ return escapeHtml(s); }

  function open(tabId){
    buildDom();
    if (tabId && findTab(tabId)) currentTab = tabId;
    refreshTabs();
    renderBody();
    mask.classList.add('open');
    document.body.classList.add('ue-open');
  }

  function close(){
    if (!mask) return;
    mask.classList.remove('open');
    document.body.classList.remove('ue-open');
  }

  function switchTab(tabId){
    if (!findTab(tabId)) return;
    currentTab = tabId;
    refreshTabs();
    renderBody();
  }

  function bindEntry(){
    var btn = document.getElementById('unlimitedEditorBtn');
    if (btn && !btn.__ueBound) {
      btn.__ueBound = true;
      btn.addEventListener('click', function(e){
        e.preventDefault();
        open();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEntry);
  } else {
    bindEntry();
  }

  // 4.22: 启动即应用 UI 配置覆盖层（即使从未打开过编辑器）
  function ueInitOverrides(){ try { applyUIOverrides(); } catch (e) {} }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ueInitOverrides);
  } else {
    ueInitOverrides();
  }

  // 4.48: 左栏或本面板增删改角色卡后,若中枢正停在「角色」Tab 且未在编辑中,刷新列表保持一致
  window.addEventListener('character:changed', function(){
    if (!(mask && mask.classList.contains('open') && currentTab === 'character')) return;
    var slot = document.getElementById('ueCharEditor');
    if (slot && slot.children.length) return;
    renderCharacterTab();
  });

  // 4.49: 世界书条目增删改后,若中枢正停在「世界观」Tab 且未在编辑中,刷新列表保持一致
  window.addEventListener('lorebook:changed', function(){
    if (!(mask && mask.classList.contains('open') && currentTab === 'world')) return;
    var slot = document.getElementById('ueWorldEditor');
    if (slot && slot.children.length) return;
    renderWorldTab();
  });

  // ============== Preset Tab 实质化（4.7 v1）==============
  // 与 presets-ui.js 共用 LS key `cfw_prompt_presets_v1`，对左侧栏「提示词预设」面板完全兼容。
  // 4 tab 中只有 Preset 实质化；character / world / ui 仍走 renderBody() 占位逻辑。

  var PRESETS_KEY = 'cfw_prompt_presets_v1';

  function uePresetsLoad(){
    try {
      var raw = localStorage.getItem(PRESETS_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function uePresetsSave(arr){
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function uePresetUid(){
    return 'preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  }
  async function ueFetchStarter(){
    try {
      var resp = await fetch('/presets/starter-presets.json', { cache: 'no-store' });
      if (!resp.ok) return null;
      var data = await resp.json();
      var arr = Array.isArray(data) ? data : (data && Array.isArray(data.presets) ? data.presets : null);
      return (arr && arr.length) ? arr : null;
    } catch (e) { return null; }
  }

  // ============== 首屏默认包播种(接管自退役的 presets-ui.js)==============
  // 老版 presets-ui.js 在首次加载(LS 无 cfw_prompt_presets_v1)时播种内置 starter。
  // 退役 presets-ui.js 后,这份「首屏起手预设包」职责迁移到解限编辑器:仅当 LS 为空时,
  // 从 /presets/starter-presets.json 播种(单一数据源);绝不覆盖用户已有数据。
  // 不再内联兜底 preset —— 远端取不到时跳过播种,下次加载再试。
  async function ueSeedPresetsIfFirstRun(){
    try { if (localStorage.getItem(PRESETS_KEY)) return; } catch (e) { return; }   // 已有数据,绝不覆盖
    var pack = await ueFetchStarter();                                              // 唯一来源 /presets/starter-presets.json
    if (!pack || !pack.length) return;                                              // 远端不可用则跳过,下次加载再试
    try { if (localStorage.getItem(PRESETS_KEY)) return; } catch (e) { return; }    // fetch 期间若已被写入则放弃
    uePresetsSave(JSON.parse(JSON.stringify(pack)));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ ueSeedPresetsIfFirstRun(); });
  } else {
    ueSeedPresetsIfFirstRun();
  }

  function renderPresetTab(){
    var t = findTab('preset');
    var body = document.getElementById('ueBody');
    if (!body) return;
    var arr = uePresetsLoad();
    arr.sort(function(a,b){ return (a.order||0) - (b.order||0); });

    body.innerHTML = [
      '<div class="ue-panel">',
        '<div class="ue-panel-head">',
          '<span class="ue-panel-icon">' + t.icon + '</span>',
          '<span class="ue-panel-name">' + escapeHtml(t.label) + '</span>',
        '</div>',
        '<p class="ue-panel-desc">' + escapeHtml(t.desc) + '</p>',
        '<div class="ue-toolbar">',
          '<button class="ue-btn ue-btn-primary" id="uePresetNew">' + UE_A.plus + ' 新建</button>',
          '<button class="ue-btn" id="uePresetReloadStarter" title="从 /presets/starter-presets.json 覆盖（会替换所有现有 preset）">' + UE_A.reload + ' 重载默认包</button>',
          '<button class="ue-btn" id="uePresetJsonMode">' + UE_A.code + ' JSON 源码</button>',
          '<button class="ue-btn" id="uePresetUpload" title="上传 .json（追加；兼容 SillyTavern 预设）">' + UE_A.folder + ' 上传</button>',
          '<input type="file" id="uePresetFile" accept=".json,application/json" style="display:none">',
          '<button class="ue-btn" id="uePresetExport">' + UE_A.exp + ' 导出</button>',
          '<span class="ue-toolbar-spacer"></span>',
          '<span class="ue-count">共 ' + arr.length + ' 个 preset</span>',
        '</div>',
        '<div class="ue-preset-list" id="uePresetList">',
          ueRenderPresetListHtml(arr),
        '</div>',
        '<div class="ue-editor-slot" id="uePresetEditor"></div>',
      '</div>'
    ].join('');

    document.getElementById('uePresetNew').addEventListener('click', function(){
      var cur = uePresetsLoad();
      var maxOrder = cur.reduce(function(m, x){ return Math.max(m, x.order||0); }, -1);
      var p = { id: uePresetUid(), name: '新预设', content: '', enabled: false, order: maxOrder + 1 };
      cur.push(p);
      uePresetsSave(cur);
      renderPresetTab();
      uePresetEdit(p.id);
    });
    document.getElementById('uePresetReloadStarter').addEventListener('click', async function(){
      var pack = await ueFetchStarter();
      if (!pack) { alert('从 /presets/starter-presets.json 加载失败（可能尚未部署或网络异常）'); return; }
      if (!confirm('将用 ' + pack.length + ' 个 starter 覆盖当前所有 preset（共 ' + uePresetsLoad().length + ' 个）。继续？')) return;
      uePresetsSave(pack);
      renderPresetTab();
    });
    document.getElementById('uePresetJsonMode').addEventListener('click', uePresetJsonEditor);
    document.getElementById('uePresetExport').addEventListener('click', function(){
      var json = JSON.stringify(uePresetsLoad(), null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(
          function(){ alert('已导出 ' + uePresetsLoad().length + ' 个 preset 到剪贴板'); },
          function(){ prompt('复制 JSON：', json); }
        );
      } else { prompt('复制 JSON：', json); }
    });

    var fileEl = document.getElementById('uePresetFile');
    var upBtn = document.getElementById('uePresetUpload');
    if (upBtn) upBtn.addEventListener('click', function(){ if (fileEl) { fileEl.value = ''; fileEl.click(); } });
    if (fileEl) fileEl.addEventListener('change', function(){
      var f = fileEl.files && fileEl.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function(){ ueImportPresetFile(String(rd.result || ''), f.name); };
      rd.readAsText(f);
    });

    var listEl = document.getElementById('uePresetList');
    listEl.addEventListener('click', function(e){
      var head = e.target.closest && e.target.closest('.ue-pgroup-head');
      if (head) {
        if (e.target.classList.contains('ue-pgroup-del')) { ueGroupDelete(head.getAttribute('data-group')); return; }
        var g = head.getAttribute('data-group');
        uePresetCollapsed[g] = !uePresetCollapsed[g];
        renderPresetTab();
        return;
      }
      var row = e.target.closest && e.target.closest('.ue-preset-row');
      if (!row) return;
      var pid = row.getAttribute('data-id');
      if (e.target.classList.contains('ue-preset-edit')) uePresetEdit(pid);
      else if (e.target.classList.contains('ue-preset-del')) uePresetDel(pid);
      else if (e.target.classList.contains('ue-preset-up')) uePresetMove(pid, -1);
      else if (e.target.classList.contains('ue-preset-down')) uePresetMove(pid, +1);
    });
    listEl.addEventListener('dragstart', function(e){
      var row = e.target.closest && e.target.closest('.ue-preset-row');
      if (!row) return;
      ueDragId = row.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ueDragId); } catch (x) {}
      row.classList.add('dragging');
    });
    listEl.addEventListener('dragend', function(e){
      var row = e.target.closest && e.target.closest('.ue-preset-row');
      if (row) row.classList.remove('dragging');
      listEl.querySelectorAll('.dragover').forEach(function(r){ r.classList.remove('dragover'); });
      ueDragId = null;
    });
    listEl.addEventListener('dragover', function(e){
      if (!ueDragId) return;
      e.preventDefault();
      var row = e.target.closest && e.target.closest('.ue-preset-row');
      listEl.querySelectorAll('.dragover').forEach(function(r){ if (r !== row) r.classList.remove('dragover'); });
      if (row && row.getAttribute('data-id') !== ueDragId) row.classList.add('dragover');
    });
    listEl.addEventListener('drop', function(e){
      e.preventDefault();
      var row = e.target.closest && e.target.closest('.ue-preset-row');
      if (!row || !ueDragId) return;
      var targetId = row.getAttribute('data-id');
      if (targetId !== ueDragId) uePresetDrop(ueDragId, targetId);
    });
    listEl.addEventListener('change', function(e){
      if (!e.target.classList.contains('ue-preset-chk')) return;
      var row = e.target.closest('.ue-preset-row');
      var pid = row.getAttribute('data-id');
      var cur = uePresetsLoad();
      var p = cur.find(function(x){ return x.id === pid; });
      if (p) { p.enabled = !!e.target.checked; uePresetsSave(cur); row.classList.toggle('enabled', p.enabled); }
    });
  }

  function uePresetRowHtml(p){
    var preview = (p.content || '').slice(0, 80).replace(/\n/g, ' ');
    if ((p.content || '').length > 80) preview += '…';
    return [
      '<div class="ue-preset-row ue-emo-row' + (p.enabled ? ' enabled' : '') + '" data-id="' + escapeAttr(p.id) + '" draggable="true">',
        '<label class="ue-preset-tog" title="' + (p.enabled ? '已启用 · 点击禁用' : '已禁用 · 点击启用') + '" style="cursor:pointer;">',
          '<input type="checkbox" class="ue-preset-chk" style="display:none;"' + (p.enabled ? ' checked' : '') + '>',
          '<span class="ue-emo-badge">' + escapeHtml(p.name || '(未命名)') + '</span>',
        '</label>',

        '<div class="ue-preset-preview">' + (escapeHtml(preview) || '<em>（空内容）</em>') + '</div>',
        '<div class="ue-preset-ops">',
          '<button class="ue-mini ue-preset-edit" title="编辑">✎</button>',
          '<button class="ue-mini danger ue-preset-del" title="删除">✕</button>',
        '</div>',
      '</div>'
    ].join('');
  }

  function uePresetEdit(pid){
    var cur = uePresetsLoad();
    var p = cur.find(function(x){ return x.id === pid; });
    if (!p) return;
    var slot = document.getElementById('uePresetEditor');
    if (!slot) return;
    slot.innerHTML = [
      '<div class="ue-editor-card">',
        '<div class="ue-editor-head">✎ 编辑 preset</div>',
        '<label class="ue-field"><span>名称</span><input class="ue-input" id="uePEName" value="' + escapeAttr(p.name || '') + '"></label>',
        '<label class="ue-field"><span>内容（追加到 system prompt 末层）</span><textarea class="ue-textarea" id="uePEContent" rows="10">' + escapeHtml(p.content || '') + '</textarea></label>',
        '<div class="ue-editor-foot">',
          '<button class="ue-btn ue-btn-primary" id="uePESave">保存</button>',
          '<button class="ue-btn" id="uePECancel">取消</button>',
        '</div>',
      '</div>'
    ].join('');
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('uePESave').addEventListener('click', function(){
      var nm = (document.getElementById('uePEName').value || '').trim();
      if (!nm) { alert('名称不能为空'); return; }
      var ct = document.getElementById('uePEContent').value || '';
      p.name = nm; p.content = ct;
      uePresetsSave(cur);
      renderPresetTab();
    });
    document.getElementById('uePECancel').addEventListener('click', function(){ slot.innerHTML = ''; });
  }

  function uePresetDel(pid){
    var cur = uePresetsLoad();
    var p = cur.find(function(x){ return x.id === pid; });
    if (!p) return;
    if (!confirm('删除 preset「' + p.name + '」？')) return;
    cur = cur.filter(function(x){ return x.id !== pid; });
    uePresetsSave(cur);
    renderPresetTab();
  }

  function uePresetMove(pid, dir){
    var cur = uePresetsLoad();
    cur.sort(function(a,b){ return (a.order||0) - (b.order||0); });
    var i = cur.findIndex(function(x){ return x.id === pid; });
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= cur.length) return;
    var tmp = cur[j].order; cur[j].order = cur[i].order; cur[i].order = tmp;
    uePresetsSave(cur);
    renderPresetTab();
  }

  function uePresetJsonEditor(){
    var slot = document.getElementById('uePresetEditor');
    if (!slot) return;
    var json = JSON.stringify(uePresetsLoad(), null, 2);
    slot.innerHTML = [
      '<div class="ue-editor-card">',
        '<div class="ue-editor-head">' + UE_A.code + ' JSON 源码模式（保存会覆盖全部 preset）</div>',
        '<textarea class="ue-textarea ue-mono" id="uePresetJsonText" rows="16">' + escapeHtml(json) + '</textarea>',
        '<div class="ue-editor-foot">',
          '<button class="ue-btn ue-btn-primary" id="uePJSave">保存 JSON</button>',
          '<button class="ue-btn" id="uePJCancel">取消</button>',
        '</div>',
      '</div>'
    ].join('');
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('uePJSave').addEventListener('click', function(){
      var s = document.getElementById('uePresetJsonText').value || '';
      try {
        var arr = JSON.parse(s);
        if (!Array.isArray(arr)) throw new Error('JSON 顶层必须是数组');
        var clean = arr.filter(function(x){ return x && typeof x.name === 'string' && typeof x.content === 'string'; })
          .map(function(x, i){
            return {
              id: x.id || ('preset-' + Date.now() + '-' + i),
              name: x.name, content: x.content,
              enabled: !!x.enabled,
              order: typeof x.order === 'number' ? x.order : i,
              group: typeof x.group === 'string' ? x.group : ''
            };
          });
        if (!clean.length) { alert('没有有效 preset（需 name + content 字段）'); return; }
        if (!confirm('将用 ' + clean.length + ' 个 preset 覆盖当前 ' + uePresetsLoad().length + ' 个。继续？')) return;
        uePresetsSave(clean);
        renderPresetTab();
      } catch (e) {
        alert('JSON 解析失败：' + e.message);
      }
    });
    document.getElementById('uePJCancel').addEventListener('click', function(){ slot.innerHTML = ''; });
  }

  // ============== 4.23: Preset 增强（分组收纳 / 拖拽 / .json 上传）==============
  // group 为可选字段（不填=未分组，老数据完全兼容）。SillyTavern 预设按文件名收进同名分组。
  var uePresetCollapsed = {};
  var ueDragId = null;

  function ueRenderPresetListHtml(arr){
    if (!arr.length) return '<div class="ue-empty">尚无 preset。点击「↻ 重载默认包」载入，或「＋ 新建」/「📁 上传」自定义。</div>';
    var order = [], map = {};
    arr.forEach(function(p){ var g = p.group || ''; if (!(g in map)) { map[g] = []; order.push(g); } map[g].push(p); });
    var html = '';
    order.forEach(function(g){
      var items = map[g];
      if (g === '') { html += items.map(uePresetRowHtml).join(''); return; }
      var collapsed = !!uePresetCollapsed[g];
      html += '<div class="ue-pgroup-head" data-group="' + escapeAttr(g) + '">'
        + '<span class="ue-pgroup-arrow">' + (collapsed ? '▸' : '▾') + '</span>'
        + '<span class="ue-pgroup-name">' + escapeHtml(g) + '</span>'
        + '<span class="ue-pgroup-count">' + items.length + '</span>'
        + '<button class="ue-mini danger ue-pgroup-del" data-group="' + escapeAttr(g) + '" title="删除整组">✕</button></div>';
      if (!collapsed) html += '<div class="ue-pgroup-body">' + items.map(uePresetRowHtml).join('') + '</div>';
    });
    return html;
  }

  function uePresetDrop(dragId, targetId){
    var cur = uePresetsLoad();
    cur.sort(function(a,b){ return (a.order||0) - (b.order||0); });
    var di = cur.findIndex(function(x){ return x.id === dragId; });
    if (di < 0) return;
    var item = cur.splice(di, 1)[0];
    var ti = cur.findIndex(function(x){ return x.id === targetId; });
    if (ti < 0) { cur.push(item); } else { item.group = cur[ti].group || ''; cur.splice(ti, 0, item); }
    cur.forEach(function(x, i){ x.order = i; });
    uePresetsSave(cur);
    renderPresetTab();
  }

  function ueGroupDelete(g){
    var cur = uePresetsLoad();
    var n = cur.filter(function(x){ return (x.group||'') === g; }).length;
    if (!confirm('删除分组「' + g + '」下的全部 ' + n + ' 个 preset？')) return;
    cur = cur.filter(function(x){ return (x.group||'') !== g; });
    uePresetsSave(cur);
    renderPresetTab();
  }

  function ueImportPresetFile(text, fname){
    var data;
    try { data = JSON.parse(text); } catch (e) { alert('JSON 解析失败：' + e.message); return; }
    var groupName = String(fname || '').replace(/\.json$/i, '') || '导入';
    var add = [];
    if (Array.isArray(data)) {
      add = data.filter(function(x){ return x && typeof x.name === 'string' && typeof x.content === 'string'; })
        .map(function(x){ return { name: x.name, content: x.content, enabled: !!x.enabled, group: (typeof x.group === 'string' ? x.group : '') }; });
    } else if (data && Array.isArray(data.prompts)) {
      add = ueParseSillyTavern(data, groupName);
    } else if (data && typeof data.name === 'string' && typeof data.content === 'string') {
      add = [{ name: data.name, content: data.content, enabled: !!data.enabled, group: '' }];
    } else {
      alert('无法识别的预设格式（支持本应用数组 / SillyTavern 预设 / 单条 {name,content}）');
      return;
    }
    if (!add.length) { alert('文件里没有可导入的有效条目'); return; }
    var cur = uePresetsLoad();
    var maxOrder = cur.reduce(function(m, x){ return Math.max(m, x.order||0); }, -1);
    add.forEach(function(p, i){
      cur.push({ id: uePresetUid() + '-' + i, name: p.name, content: p.content, enabled: !!p.enabled, order: maxOrder + 1 + i, group: p.group || '' });
    });
    uePresetsSave(cur);
    if (add[0] && add[0].group) uePresetCollapsed[add[0].group] = false;
    renderPresetTab();
    alert('已追加 ' + add.length + ' 个 preset' + (add[0] && add[0].group ? ('（分组「' + add[0].group + '」）') : ''));
  }

  function ueParseSillyTavern(data, groupName){
    var enabledMap = {};
    if (Array.isArray(data.prompt_order) && data.prompt_order.length) {
      var ord = data.prompt_order[data.prompt_order.length - 1];
      if (ord && Array.isArray(ord.order)) ord.order.forEach(function(o){ if (o && o.identifier) enabledMap[o.identifier] = (o.enabled !== false); });
    }
    var out = [];
    data.prompts.forEach(function(pr){
      if (!pr || pr.marker === true) return;
      var content = (typeof pr.content === 'string') ? pr.content : '';
      if (!content.trim()) return;
      var name = pr.name || pr.identifier || '(未命名)';
      var en = (pr.identifier && (pr.identifier in enabledMap)) ? enabledMap[pr.identifier] : false;
      out.push({ name: name, content: content, enabled: !!en, group: groupName });
    });
    return out;
  }

  // ============== 角色卡 Tab 实质化（P1 · 复用 character.js 的 tavern_chars_v2,单一数据源）==============
  var GENDER_PH = '女 / 男 / 双性 / 无性别 / 自定义';
  function ueCharApi(){ return (window.__character && typeof window.__character.getAllCards === 'function') ? window.__character : null; }
  async function renderCharacterTab(){
    var t = findTab('character'), body = document.getElementById('ueBody'); if (!body) return;
    var api = ueCharApi();
    if (!api){ body.innerHTML = '<div class="ue-panel"><div class="ue-panel-head"><span class="ue-panel-icon">' + t.icon + '</span><span class="ue-panel-name">' + escapeHtml(t.label) + '</span></div><div class="ue-empty">角色卡模块尚未就绪（character.js 未加载）,请刷新页面后重试。</div></div>'; return; }
    var cards = []; try { cards = await api.getAllCards(); } catch (e) { cards = []; }
    var activeId = ''; try { activeId = localStorage.getItem('tavern_active_char_id') || ''; } catch (e) {}
    body.innerHTML = ['<div class="ue-panel">',
      '<div class="ue-panel-head"><span class="ue-panel-icon">' + t.icon + '</span><span class="ue-panel-name">' + escapeHtml(t.label) + '</span></div>',
      '<p class="ue-panel-desc">' + escapeHtml(t.desc) + '</p>',
      '<div class="ue-toolbar"><button class="ue-btn ue-btn-primary" id="ueCharNew">' + UE_A.plus + ' 新建角色卡</button><button class="ue-btn" id="ueCharImport" title="导入 SillyTavern V1·V2 角色卡 JSON / 本应用导出数组（内嵌世界书会一并导入）">' + UE_A.imp + ' 导入</button><input type="file" id="ueCharFile" accept=".json,application/json" style="display:none"><button class="ue-btn" id="ueCharExport" title="导出全部角色卡 JSON 到剪贴板">' + UE_A.exp + ' 导出全部</button><span class="ue-toolbar-spacer"></span><span class="ue-count">共 ' + cards.length + ' 张</span></div>',
      '<div class="ue-preset-list" id="ueCharList">' + ueCharListHtml(cards, activeId) + '</div>',
      '<div class="ue-editor-slot" id="ueCharEditor"></div>',
    '</div>'].join('');
    document.getElementById('ueCharNew').addEventListener('click', function(){ ueCharEdit(null); });
    document.getElementById('ueCharExport').addEventListener('click', function(){ var json = JSON.stringify(cards, null, 2); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function(){ alert('已导出 ' + cards.length + ' 张角色卡到剪贴板'); }, function(){ prompt('复制 JSON：', json); }); else prompt('复制 JSON：', json); });
    var _cf = document.getElementById('ueCharFile'), _ci = document.getElementById('ueCharImport');
    if (_ci) _ci.addEventListener('click', function(){ if (_cf){ _cf.value=''; _cf.click(); } });
    if (_cf) _cf.addEventListener('change', function(){ var f = _cf.files && _cf.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function(){ ueCharImportFile(String(rd.result||''), f.name); }; rd.readAsText(f); });
    var listEl = document.getElementById('ueCharList');
    listEl.addEventListener('click', function(e){ var row = e.target.closest && e.target.closest('.ue-preset-row'); if (!row) return; var id = row.getAttribute('data-id'); if (e.target.classList.contains('ue-char-edit')) ueCharEditById(id); else if (e.target.classList.contains('ue-char-del')) ueCharDel(id); else if (e.target.classList.contains('ue-char-use')) { try { ueCharApi().setActiveId(id); } catch (x) {} renderCharacterTab(); } });
  }
  function ueCharListHtml(cards, activeId){
    if (!cards.length) return '<div class="ue-empty">还没有角色卡。点「＋ 新建角色卡」创建,或在左栏「角色卡」面板用原型库快速生成。</div>';
    return cards.map(function(c){
      var sub = (c.identity || c.personality || '').slice(0, 60).replace(/\n/g, ' ');
      var on = c.id === activeId;
      return ['<div class="ue-preset-row' + (on ? ' enabled' : '') + '" data-id="' + escapeAttr(c.id) + '">',
        '<span class="ue-char-ava">' + escapeHtml(c.icon || '🙂') + '</span>',
        '<span class="ue-preset-name">' + escapeHtml(c.name || '(未命名)') + (on ? ' <span class="ue-char-cur">当前</span>' : '') + '</span>',
        '<div class="ue-preset-preview">' + (escapeHtml(sub) || '<em>（无描述）</em>') + '</div>',
        '<div class="ue-preset-ops">' + (on ? '' : '<button class="ue-mini ue-char-use" title="设为当前">用</button>') + '<button class="ue-mini ue-char-edit" title="编辑">✎</button><button class="ue-mini danger ue-char-del" title="删除">✕</button></div>',
      '</div>'].join('');
    }).join('');
  }
  async function ueCharEditById(id){ var api = ueCharApi(); if (!api) return; var cards = []; try { cards = await api.getAllCards(); } catch (e) {} var c = cards.find(function(x){ return x.id === id; }); ueCharEdit(c || null); }
  function ueCharDel(id){ var api = ueCharApi(); if (!api) return; api.getAllCards().then(function(cards){ var c = cards.find(function(x){ return x.id === id; }); if (!confirm('删除角色卡「' + ((c && c.name) || id) + '」？此操作不可撤销。')) return; api.deleteCard(id).then(function(){ renderCharacterTab(); }); }); }
  function ueCharEdit(card){
    var slot = document.getElementById('ueCharEditor'); if (!slot) return;
    var isNew = !card || !card.id, c = card || {};
    var rules = Array.isArray(c.rules) ? c.rules.slice() : []; while (rules.length < 3) rules.push('');
    var qa = Array.isArray(c.exampleQA) ? c.exampleQA.slice() : []; while (qa.length < 2) qa.push({ user:'', character:'' });
    function F(lb,k,v,ph){ return '<label class="ue-field"><span>' + escapeHtml(lb) + '</span><input class="ue-input" data-cf="' + k + '" value="' + escapeAttr(v||'') + '" placeholder="' + escapeAttr(ph||'') + '"></label>'; }
    function I(k,v,ph,mb){ return '<input class="ue-input" data-cf="' + k + '" value="' + escapeAttr(v||'') + '" placeholder="' + escapeAttr(ph||'') + '"' + (mb?' style="margin-bottom:6px;"':'') + '>'; }
    slot.innerHTML = ['<div class="ue-editor-card">',
      '<div class="ue-editor-head">' + (isNew ? '＋ 新建角色卡' : '✎ 编辑：' + escapeHtml(c.name||'')) + '</div>',
      F('角色名 *','name', c.name, '角色名称'),
      '<div class="ue-char-grid2">' + F('性别','gender', c.gender, GENDER_PH) + F('年龄','age', c.age, '如：18 / 二十出头（影响立绘）') + '</div>',
      F('身份/背景','identity', c.identity, '如：高中生 / 修仙者（可空）'),
      F('头像 emoji','icon', c.icon, '🙂'),
      F('性格关键词','personality', c.personality, '如：包容、耐心'),
      F('说话方式','speakingStyle', c.speakingStyle, '如：轻声细语'),
      '<label class="ue-field"><span>行为铁则（最多 3 条）</span>' + I('r0',rules[0],'铁则 1',1) + I('r1',rules[1],'铁则 2',1) + I('r2',rules[2],'铁则 3') + '</label>',
      F('开场白','opening', c.openingLine, '第一句话'),
      '<label class="ue-field"><span>示例对话 1</span>' + I('q0u',qa[0].user,'用户说',1) + I('q0c',qa[0].character,'角色回') + '</label>',
      '<label class="ue-field"><span>示例对话 2</span>' + I('q1u',qa[1].user,'用户说',1) + I('q1c',qa[1].character,'角色回') + '</label>',
      '<div class="ue-editor-foot"><button class="ue-btn ue-btn-primary" id="ueCharSave">' + (isNew?'新建':'保存修改') + '</button><button class="ue-btn" id="ueCharCancel">取消</button></div>',
    '</div>'].join('');
    slot.scrollIntoView({ behavior:'smooth', block:'nearest' });
    document.getElementById('ueCharCancel').addEventListener('click', function(){ slot.innerHTML = ''; });
    document.getElementById('ueCharSave').addEventListener('click', async function(){
      var api = ueCharApi(); if (!api) return;
      var g = function(k){ var el = slot.querySelector('[data-cf="' + k + '"]'); return el ? el.value.trim() : ''; };
      var name = g('name'); if (!name) { alert('角色名不能为空'); return; }
      var merged = { id:(c&&c.id)||'', name:name, gender:g('gender')||'female', age:g('age'), identity:g('identity'), icon:g('icon')||'🙂', personality:g('personality'), speakingStyle:g('speakingStyle'), rules:[g('r0'),g('r1'),g('r2')].filter(function(r){ return r; }), openingLine:g('opening'), exampleQA:[{ user:g('q0u'), character:g('q0c') },{ user:g('q1u'), character:g('q1c') }].filter(function(q){ return q.user||q.character; }), enableAffection:c?c.enableAffection:undefined, affectionThresholds:(c&&Array.isArray(c.affectionThresholds))?c.affectionThresholds:[] };
      try { await api.saveCard(merged); renderCharacterTab(); } catch (e) { alert('保存失败：' + (e&&e.message?e.message:e)); }
    });
  }

  // P4: SillyTavern V1/V2 角色卡 → 本应用卡 schema 映射（description+scenario→identity, first_mes→openingLine, mes_example→exampleQA≤2）
  function ueCardFromSillyTavern(raw){
    var d = (raw && raw.data && typeof raw.data === 'object') ? raw.data : raw;  // V2 在 data 下，V1 平铺
    if (!d || typeof d !== 'object') return null;
    if (!d.name && !d.first_mes && !d.description) return null;
    var qa = [], mex = typeof d.mes_example === 'string' ? d.mes_example : '';
    if (mex){
      mex.split(/<START>/i).forEach(function(blk){
        if (qa.length >= 2) return;
        var um = blk.match(/\{\{user\}\}\s*[:：]\s*([\s\S]*?)(?=\{\{char\}\}|$)/i);
        var cm = blk.match(/\{\{char\}\}\s*[:：]\s*([\s\S]*?)(?=\{\{user\}\}|$)/i);
        var u = um ? um[1].trim() : '', c = cm ? cm[1].trim() : '';
        if (u || c) qa.push({ user: u, character: c });
      });
    }
    var identity = [d.description, d.scenario].filter(function(x){ return x && String(x).trim(); }).map(function(x){ return String(x).trim(); }).join('\n\n');
    return {
      name: d.name || d.char_name || '导入角色',
      identity: identity,
      personality: typeof d.personality === 'string' ? d.personality : '',
      openingLine: typeof d.first_mes === 'string' ? d.first_mes : (d.char_greeting || ''),
      exampleQA: qa,
      icon: '🙂'
    };
  }

  function ueCharImportFile(text, fname){
    var api = ueCharApi(); if (!api){ alert('角色卡模块未就绪'); return; }
    var data; try { data = JSON.parse(text); } catch (e) { alert('JSON 解析失败：' + e.message); return; }
    var cards = [];
    if (Array.isArray(data)) cards = data;                                   // 本应用导出（数组）
    else { var one = ueCardFromSillyTavern(data); if (one) cards = [one]; }   // ST V1/V2 单卡
    if (!cards.length) { alert('未识别到角色卡（支持本应用数组 / SillyTavern V1·V2 单卡 JSON）'); return; }
    var saved = 0, chain = Promise.resolve();
    cards.forEach(function(c){ chain = chain.then(function(){ return api.saveCard(c); }).then(function(){ saved++; }, function(){}); });
    var loreN = 0;
    if (!Array.isArray(data) && window.__lorebook){
      var book = window.__lorebook.parseSillyTavernBook(data, (cards[0] && cards[0].name) || 'import');
      if (book && book.length) loreN = window.__lorebook.importAll(book, { merge: true });
    }
    chain.then(function(){
      renderCharacterTab();
      alert('已导入 ' + saved + ' 张角色卡' + (loreN ? ('，及内嵌世界书 ' + loreN + ' 条') : ''));
    });
  }

  // ============== 世界观 Tab 实质化（P2 · 世界书 lorebook.js / tavern_lorebook_v1）==============
  // 复用 preset/角色 Tab 的列表 + 编辑器卡样式（ue-preset-row / ue-editor-card）。
  // 数据层走 window.__lorebook（LS tavern_lorebook_v1，随 sync.js 自动上云）。
  function ueWorldApi(){ return (window.__lorebook && typeof window.__lorebook.getAll === 'function') ? window.__lorebook : null; }

  function renderWorldTab(){
    var t = findTab('world'), body = document.getElementById('ueBody'); if (!body) return;
    var api = ueWorldApi();
    if (!api){ body.innerHTML = '<div class="ue-panel"><div class="ue-panel-head"><span class="ue-panel-icon">' + t.icon + '</span><span class="ue-panel-name">' + escapeHtml(t.label) + '</span></div><div class="ue-empty">世界书模块尚未就绪（lorebook.js 未加载），请刷新页面后重试。</div></div>'; return; }
    var entries = api.getAll();
    entries.sort(function(a,b){ return (b.priority||0) - (a.priority||0); });
    body.innerHTML = ['<div class="ue-panel">',
      '<div class="ue-panel-head"><span class="ue-panel-icon">' + t.icon + '</span><span class="ue-panel-name">' + escapeHtml(t.label) + '</span></div>',
      '<p class="ue-panel-desc">世界书条目（Lore Book）：常驻或关键词命中时注入【世界设定】。存 tavern_lorebook_v1，随云同步跨设备。</p>',
      '<div class="ue-toolbar">',
        '<button class="ue-btn ue-btn-primary" id="ueWorldNew">' + UE_A.plus + ' 新建条目</button>',
        '<button class="ue-btn" id="ueWorldImport" title="导入 SillyTavern 世界书 / 角色卡内嵌 character_book / 本应用导出的 JSON">' + UE_A.imp + ' 导入</button>',
        '<input type="file" id="ueWorldFile" accept=".json,application/json" style="display:none">',
        '<button class="ue-btn" id="ueWorldExport" title="导出全部世界书 JSON 到剪贴板">' + UE_A.exp + ' 导出</button>',
        '<span class="ue-toolbar-spacer"></span>',
        '<span class="ue-count">共 ' + entries.length + ' 条</span>',
      '</div>',
      '<div class="ue-preset-list" id="ueWorldList">' + ueWorldListHtml(entries) + '</div>',
      '<div class="ue-editor-slot" id="ueWorldEditor"></div>',
    '</div>'].join('');
    document.getElementById('ueWorldNew').addEventListener('click', function(){ ueWorldEdit(null); });
    document.getElementById('ueWorldExport').addEventListener('click', function(){
      var json = JSON.stringify(api.exportAll(), null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function(){ alert('已导出 ' + entries.length + ' 条世界书到剪贴板'); }, function(){ prompt('复制 JSON：', json); });
      else prompt('复制 JSON：', json);
    });
    var fileEl = document.getElementById('ueWorldFile'), impBtn = document.getElementById('ueWorldImport');
    if (impBtn) impBtn.addEventListener('click', function(){ if (fileEl){ fileEl.value=''; fileEl.click(); } });
    if (fileEl) fileEl.addEventListener('change', function(){
      var f = fileEl.files && fileEl.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function(){ ueWorldImportFile(String(rd.result||''), f.name); };
      rd.readAsText(f);
    });
    var listEl = document.getElementById('ueWorldList');
    listEl.addEventListener('click', function(e){
      var row = e.target.closest && e.target.closest('.ue-preset-row'); if (!row) return;
      var id = row.getAttribute('data-id');
      if (e.target.classList.contains('ue-world-edit')) ueWorldEditById(id);
      else if (e.target.classList.contains('ue-world-del')) ueWorldDel(id);
    });
    listEl.addEventListener('change', function(e){
      if (!e.target.classList.contains('ue-world-chk')) return;
      var row = e.target.closest('.ue-preset-row'); var id = row.getAttribute('data-id');
      var en = api.getEntry(id); if (en){ en.enabled = !!e.target.checked; api.saveEntry(en); row.classList.toggle('enabled', en.enabled); }
    });
  }

  function ueWorldListHtml(entries){
    if (!entries.length) return '<div class="ue-empty">还没有世界书条目。点「＋ 新建条目」创建，或「📥 导入」SillyTavern 世界书。</div>';
    return entries.map(function(e){
      var tags = [];
      if (e.alwaysOn) tags.push('常驻'); else tags.push((e.keywords && e.keywords.length) ? ('关键词:' + e.keywords.slice(0,4).join('/')) : '⚠无触发');
      if (e.scope === 'perCard') tags.push('绑卡');
      var sub = tags.join(' · ') + ' · ' + (e.content||'').slice(0,50).replace(/\n/g,' ');
      return ['<div class="ue-preset-row' + (e.enabled !== false ? ' enabled' : '') + '" data-id="' + escapeAttr(e.id) + '">',
        '<label class="ue-preset-tog"><input type="checkbox" class="ue-world-chk"' + (e.enabled !== false ? ' checked' : '') + '><span class="ue-preset-name">' + escapeHtml(e.name || '(未命名条目)') + '</span></label>',
        '<div class="ue-preset-preview">' + (escapeHtml(sub) || '<em>（空）</em>') + '</div>',
        '<div class="ue-preset-ops"><button class="ue-mini ue-world-edit" title="编辑">✎</button><button class="ue-mini danger ue-world-del" title="删除">✕</button></div>',
      '</div>'].join('');
    }).join('');
  }

  function ueWorldEditById(id){ var api = ueWorldApi(); if (!api) return; ueWorldEdit(api.getEntry(id)); }
  function ueWorldDel(id){ var api = ueWorldApi(); if (!api) return; var e = api.getEntry(id); if (!confirm('删除世界书条目「' + ((e&&e.name)||id) + '」？')) return; api.deleteEntry(id); renderWorldTab(); }

  function ueWorldImportFile(text, fname){
    var api = ueWorldApi(); if (!api) return;
    var data; try { data = JSON.parse(text); } catch (e) { alert('JSON 解析失败：' + e.message); return; }
    var add;
    if (Array.isArray(data)) add = data;                                  // 本应用导出格式（数组）
    else add = api.parseSillyTavernBook(data, String(fname||'').replace(/\.json$/i,'') || 'import');  // ST 世界书 / 角色卡内嵌 character_book
    if (!add || !add.length) { alert('未识别到可导入的世界书条目（支持本应用数组 / SillyTavern world info / 角色卡内嵌 character_book）'); return; }
    var n = api.importAll(add, { merge: true });
    renderWorldTab();
    alert('已追加导入 ' + n + ' 条世界书');
  }

  function ueWorldEdit(entry){
    var slot = document.getElementById('ueWorldEditor'); if (!slot) return;
    var isNew = !entry || !entry.id, e = entry || {};
    var kw = Array.isArray(e.keywords) ? e.keywords.join(', ') : (e.keywords || '');
    slot.innerHTML = ['<div class="ue-editor-card">',
      '<div class="ue-editor-head">' + (isNew ? '＋ 新建世界书条目' : '✎ 编辑：' + escapeHtml(e.name||'')) + '</div>',
      '<label class="ue-field"><span>条目名 *</span><input class="ue-input" data-wf="name" value="' + escapeAttr(e.name||'') + '" placeholder="如：王国设定 / 主角的过去"></label>',
      '<label class="ue-field"><span>触发关键词（逗号分隔；勾选常驻则忽略）</span><input class="ue-input" data-wf="keywords" value="' + escapeAttr(kw) + '" placeholder="如：王国, 首都, 国王"></label>',
      '<label class="ue-field"><span>内容（注入到【世界设定】的正文）</span><textarea class="ue-textarea" data-wf="content" rows="6">' + escapeHtml(e.content||'') + '</textarea></label>',
      '<div class="ue-char-grid2">',
        '<label class="ue-field"><span>优先级（越大越靠前）</span><input class="ue-input" data-wf="priority" type="number" value="' + escapeAttr(e.priority != null ? String(e.priority) : '0') + '"></label>',
        '<label class="ue-field"><span>生效范围</span><select class="ue-input" data-wf="scope" id="ueWorldScope"><option value="global"' + (e.scope!=='perCard'?' selected':'') + '>全局</option><option value="perCard"' + (e.scope==='perCard'?' selected':'') + '>仅绑定角色卡</option></select></label>',
      '</div>',
      '<label class="ue-field" id="ueWorldBindWrap" style="' + (e.scope==='perCard'?'':'display:none;') + '"><span>绑定角色卡</span><select class="ue-input" data-wf="boundCardId" id="ueWorldBind"><option value="">（加载中…）</option></select></label>',
      '<label class="ue-field" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" data-wf="alwaysOn"' + (e.alwaysOn?' checked':'') + '><span>常驻注入（无视关键词，每轮都注入）</span></label>',
      '<div class="ue-editor-foot"><button class="ue-btn ue-btn-primary" id="ueWorldSave">' + (isNew?'新建':'保存修改') + '</button><button class="ue-btn" id="ueWorldCancel">取消</button></div>',
    '</div>'].join('');
    slot.scrollIntoView({ behavior:'smooth', block:'nearest' });
    var bindSel = document.getElementById('ueWorldBind');
    if (bindSel && window.__character && window.__character.getAllCards){
      window.__character.getAllCards().then(function(cards){
        bindSel.innerHTML = '<option value="">（选择角色卡）</option>' + (cards||[]).map(function(c){ return '<option value="' + escapeAttr(c.id) + '"' + (c.id===e.boundCardId?' selected':'') + '>' + escapeHtml((c.icon?c.icon+' ':'')+(c.name||c.id)) + '</option>'; }).join('');
      }, function(){ bindSel.innerHTML = '<option value="">（无法加载角色卡）</option>'; });
    }
    var scopeSel = document.getElementById('ueWorldScope'), bindWrap = document.getElementById('ueWorldBindWrap');
    if (scopeSel) scopeSel.addEventListener('change', function(){ if (bindWrap) bindWrap.style.display = scopeSel.value==='perCard' ? '' : 'none'; });
    document.getElementById('ueWorldCancel').addEventListener('click', function(){ slot.innerHTML=''; });
    document.getElementById('ueWorldSave').addEventListener('click', function(){
      var api = ueWorldApi(); if (!api) return;
      var g = function(k){ var el = slot.querySelector('[data-wf="' + k + '"]'); return el ? el.value : ''; };
      var name = (g('name')||'').trim(), content = g('content')||'';
      if (!name && !content.trim()) { alert('条目名和内容不能都为空'); return; }
      var scope = g('scope') === 'perCard' ? 'perCard' : 'global';
      var chk = slot.querySelector('[data-wf="alwaysOn"]');
      var merged = {
        id: (e&&e.id)||'',
        name: name,
        keywords: g('keywords')||'',
        content: content,
        alwaysOn: !!(chk && chk.checked),
        priority: parseInt(g('priority'),10) || 0,
        scope: scope,
        boundCardId: scope==='perCard' ? (g('boundCardId')||'') : '',
        enabled: (e && e.enabled === false) ? false : true,
        source: e ? e.source : ''
      };
      try { api.saveEntry(merged); renderWorldTab(); } catch (x) { alert('保存失败：' + (x&&x.message?x.message:x)); }
    });
  }

  // ============== UI 配置 Tab 实质化（4.22 · 全局覆盖层）==============
  // 在 4 主题之上叠加用户偏好：颜色/布局/圆角/背景图/背景音/高级 CSS。
  // CSS 变量走 documentElement 行内样式（优先级最高，盖过 [data-theme]）。
  // 存储：cfw_ui_overrides_v1（小文本，跨设备同步）+ cfw_ui_assets_v1（base64 上传，仅本机）。
  var UI_KEY = 'cfw_ui_overrides_v1';
  var UI_ASSETS_KEY = 'cfw_ui_assets_v1';
  var UI_COLOR_FIELDS = [
    { k: '--bg', label: '背景' },
    { k: '--bubble-ai', label: 'AI 气泡' },
    { k: '--bubble-user', label: '用户气泡' },
    { k: '--border', label: '边框' },
    { k: '--btn-bg', label: '主色 / 按钮' },
    { k: '--input-bg', label: '输入框' }
  ];
  var UI_LAYOUT_FIELDS = [
    { k: '--content-max', label: '内容宽度', min: 560, max: 1280 },
    { k: '--content-side', label: '左右边距', min: 0, max: 48 },
    { k: '--composer-gap', label: '输入区底距', min: 0, max: 80 }
  ];

  function ueUiLoad(){ try { var o = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
  function ueUiSave(o){ try { localStorage.setItem(UI_KEY, JSON.stringify(o || {})); } catch (e) {} applyUIOverrides(); }
  function ueAssetsLoad(){ try { var o = JSON.parse(localStorage.getItem(UI_ASSETS_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
  function ueAssetsSave(o){ try { localStorage.setItem(UI_ASSETS_KEY, JSON.stringify(o || {})); } catch (e) {} }

  function ueParseRawVars(raw){
    var out = [];
    String(raw || '').split(/[;\n]/).forEach(function(line){
      var i = line.indexOf(':'); if (i < 0) return;
      var name = line.slice(0, i).trim(), val = line.slice(i + 1).trim();
      if (/^--[\w-]+$/.test(name) && val) out.push([name, val]);
    });
    return out;
  }

  function applyUIOverrides(){
    var o = ueUiLoad(), root = document.documentElement;
    (root.getAttribute('data-ue-vars') || '').split(',').filter(Boolean).forEach(function(n){ root.style.removeProperty(n); });
    var applied = [], vars = o.vars || {};
    Object.keys(vars).forEach(function(n){ if (vars[n]) { root.style.setProperty(n, vars[n]); applied.push(n); } });
    ueParseRawVars(o.raw).forEach(function(p){ root.style.setProperty(p[0], p[1]); applied.push(p[0]); });
    root.setAttribute('data-ue-vars', applied.join(','));
    var st = document.getElementById('ueOverrideStyle');
    if (!st) { st = document.createElement('style'); st.id = 'ueOverrideStyle'; document.head.appendChild(st); }
    st.textContent = (o.radius != null && o.radius !== '') ? ('.bubble{border-radius:' + parseInt(o.radius, 10) + 'px !important;}') : '';
    applyUIBg(o);
  }

  // 4.61 修「上传背景图不显示」: #ue-bg-layer 是 position:fixed;z-index:-1 的负层,
  // 但 styles.css 里 html,body{background:var(--bg)} 的实色底会盖在负层之上(CSS 绘制顺序:
  // 根 html 背景 -> 负 z-index 层 -> body 等普通流盒背景),导致背景图被完全遮住。
  // 修法:有背景图时把 html/body 的底色置透明,让负层透出来(左右侧栏各自有实色底,不受影响)。
  function ueBgBaseClear(on){
    var st = document.getElementById('ueBgBaseClear');
    if (!on) { if (st && st.parentNode) st.parentNode.removeChild(st); return; }
    if (!st) { st = document.createElement('style'); st.id = 'ueBgBaseClear'; document.head.appendChild(st); }
    st.textContent = 'html, body { background-color: transparent !important; }';
  }

  function applyUIBg(o){
    var bg = o.bg || {}, src = '';
    if (bg.src === '__local__') { src = ueAssetsLoad().bgData || ''; }
    else if (bg.src) { src = bg.src; }
    var layer = document.getElementById('ue-bg-layer');
    if (!src) { if (layer && layer.parentNode) layer.parentNode.removeChild(layer); ueBgBaseClear(false); return; }
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'ue-bg-layer';
      layer.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:center;background-repeat:no-repeat;';
      document.body.appendChild(layer);
    }
    layer.style.backgroundImage = 'url("' + String(src) + '")';
    var op = (bg.opacity != null && bg.opacity !== '') ? (parseInt(bg.opacity, 10) / 100) : 1;
    layer.style.opacity = String(isFinite(op) ? op : 1);
    var blur = (bg.blur != null && bg.blur !== '') ? parseInt(bg.blur, 10) : 0;
    layer.style.filter = blur ? ('blur(' + blur + 'px)') : '';
    ueBgBaseClear(true);
  }

  function ueColorRow(f, vars){
    var v = vars[f.k] || '';
    var hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : '#000000';
    return '<div class="ue-ui-row"><span class="ue-ui-label">' + escapeHtml(f.label) + '</span>'
      + '<input type="color" class="ue-ui-color" data-var="' + f.k + '" value="' + hex + '">'
      + '<input type="text" class="ue-ui-hex" data-var="' + f.k + '" value="' + escapeAttr(v) + '" placeholder="' + f.k + '">'
      + '<button class="ue-mini ue-ui-clear" data-var="' + f.k + '" title="清除">✕</button></div>';
  }
  function ueLayoutRow(f, vars){
    var raw = (vars[f.k] || '').replace('px', '');
    var num = raw === '' ? '' : parseInt(raw, 10);
    var mid = Math.round((f.min + f.max) / 2);
    return '<div class="ue-ui-row"><span class="ue-ui-label">' + escapeHtml(f.label) + '</span>'
      + '<input type="range" class="ue-ui-range" data-var="' + f.k + '" min="' + f.min + '" max="' + f.max + '" value="' + (num === '' ? mid : num) + '">'
      + '<input type="number" class="ue-ui-num" data-var="' + f.k + '" min="' + f.min + '" max="' + f.max + '" value="' + num + '" placeholder="默认"><span class="ue-ui-unit">px</span>'
      + '<button class="ue-mini ue-ui-clear" data-var="' + f.k + '" title="清除">✕</button></div>';
  }

  function renderUITab(){
    var t = findTab('ui');
    var body = document.getElementById('ueBody');
    if (!body) return;
    ensureUiTabStyles();
    var o = ueUiLoad(), vars = o.vars || {}, bg = o.bg || {}, au = o.audio || {};
    var h = [];
    h.push('<div class="ue-panel">');
    h.push('<div class="ue-panel-head"><span class="ue-panel-icon">' + t.icon + '</span><span class="ue-panel-name">' + escapeHtml(t.label) + '</span></div>');
    h.push('<p class="ue-panel-desc">全局覆盖（盖在所有主题之上），自动跨设备同步；上传的图片/音频仅存本机。</p>');
    h.push('<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.palette + ' 颜色</div>');
    UI_COLOR_FIELDS.forEach(function(f){ h.push(ueColorRow(f, vars)); });
    h.push('</div>');
    h.push('<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.layout + ' 布局</div>');
    UI_LAYOUT_FIELDS.forEach(function(f){ h.push(ueLayoutRow(f, vars)); });
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">气泡圆角</span>'
      + '<input type="range" class="ue-ui-range" id="ueRadiusRange" min="0" max="32" value="' + (o.radius != null && o.radius !== '' ? parseInt(o.radius, 10) : 16) + '">'
      + '<input type="number" class="ue-ui-num" id="ueRadiusNum" min="0" max="32" value="' + (o.radius != null ? o.radius : '') + '" placeholder="默认"><span class="ue-ui-unit">px</span>'
      + '<button class="ue-mini" id="ueRadiusClear" title="清除">✕</button></div>');
    h.push('</div>');
    h.push('<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.image + ' 背景图</div>');
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">图片 URL</span><input type="text" class="ue-input ue-ui-grow" id="ueBgUrl" placeholder="https://… 或上传本地文件" value="' + escapeAttr(bg.src && bg.src !== '__local__' ? bg.src : '') + '"></div>');
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">上传本地</span><input type="file" id="ueBgFile" accept="image/*"><span class="ue-ui-hint">' + (bg.src === '__local__' ? '已存本机图片' : '仅本机，不上云') + '</span></div>');
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">不透明度</span><input type="range" id="ueBgOpacity" min="0" max="100" value="' + (bg.opacity != null && bg.opacity !== '' ? parseInt(bg.opacity, 10) : 100) + '"><span class="ue-ui-unit" id="ueBgOpacityLbl">' + (bg.opacity != null && bg.opacity !== '' ? bg.opacity : '100') + '%</span></div>');
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">模糊</span><input type="range" id="ueBgBlur" min="0" max="20" value="' + (bg.blur != null && bg.blur !== '' ? parseInt(bg.blur, 10) : 0) + '"><span class="ue-ui-unit" id="ueBgBlurLbl">' + (bg.blur != null && bg.blur !== '' ? bg.blur : '0') + 'px</span></div>');
    h.push('<div class="ue-ui-row"><button class="ue-btn" id="ueBgClear">清除背景图</button></div>');
    h.push('</div>');
    h.push('<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.sound + ' 背景声音</div>');
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">音频 URL</span><input type="text" class="ue-input ue-ui-grow" id="ueAudioUrl" placeholder="https://… (需 CORS) 或上传本地" value="' + escapeAttr(au.src && au.src !== '__local__' ? au.src : '') + '"></div>');
    h.push('<div class="ue-ui-row"><span class="ue-ui-label">上传本地</span><input type="file" id="ueAudioFile" accept="audio/*"><span class="ue-ui-hint">' + (au.src === '__local__' ? '已存本机音频' : '仅本机') + '</span></div>');
    h.push('<div class="ue-ui-row"><button class="ue-btn" id="ueAudioClear">清除音源</button></div>');
    h.push('<p class="ue-ui-note">⚠️ 背景声音复用现有「氛围音」系统：仅在 <b>蜜桃/玩偶 (lewd) 主题</b> + 设置里开启音频时播放，音量也在设置面板调；换音源后需<b>刷新页面</b>生效；外链音频须支持 CORS，否则会静音（建议上传本地）。</p>');
    h.push('</div>');
    h.push('<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.gear + ' 高级：CSS 变量直填</div>');
    h.push('<textarea class="ue-textarea ue-mono" id="ueRawVars" rows="5" placeholder="--bubble-ai: #202030;\n--muted: #aaa;">' + escapeHtml(o.raw || '') + '</textarea>');
    h.push('<div class="ue-ui-row"><button class="ue-btn ue-btn-primary" id="ueRawApply">应用高级变量</button><span class="ue-ui-hint">每行一个 --变量: 值;（行内注入，优先级最高）</span></div>');
    h.push('</div>');
    h.push('<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.box + ' 主题 JSON · 还原</div>');
    h.push('<div class="ue-toolbar"><button class="ue-btn" id="ueThemeExport">' + UE_A.exp + ' 导出主题</button><button class="ue-btn" id="ueThemeImport">' + UE_A.imp + ' 导入主题</button><button class="ue-btn ue-mini danger" id="ueResetAll">' + UE_A.reset + ' 一键还原全部</button></div>');
    h.push('<div class="ue-ui-hint">导出/导入仅含颜色·布局·圆角·高级变量·背景/音源 URL（不含本机上传的大文件）。</div>');
    h.push('<div class="ue-editor-slot" id="ueThemeSlot"></div>');
    h.push('</div>');
    h.push('</div>');
    body.innerHTML = h.join('');
    bindUITab();
  }

  function bindUITab(){
    var body = document.getElementById('ueBody');
    if (!body) return;
    function setVar(k, val){
      var o = ueUiLoad(); o.vars = o.vars || {};
      if (val === '' || val == null) delete o.vars[k]; else o.vars[k] = val;
      ueUiSave(o);
    }
    body.querySelectorAll('.ue-ui-color').forEach(function(el){
      el.addEventListener('input', function(){
        var k = el.getAttribute('data-var'); setVar(k, el.value);
        var hx = body.querySelector('.ue-ui-hex[data-var="' + k + '"]'); if (hx) hx.value = el.value;
      });
    });
    body.querySelectorAll('.ue-ui-hex').forEach(function(el){
      el.addEventListener('change', function(){ setVar(el.getAttribute('data-var'), el.value.trim()); });
    });
    body.querySelectorAll('.ue-ui-range[data-var]').forEach(function(el){
      el.addEventListener('input', function(){
        var k = el.getAttribute('data-var'); setVar(k, el.value + 'px');
        var nm = body.querySelector('.ue-ui-num[data-var="' + k + '"]'); if (nm) nm.value = el.value;
      });
    });
    body.querySelectorAll('.ue-ui-num[data-var]').forEach(function(el){
      el.addEventListener('change', function(){
        var k = el.getAttribute('data-var');
        setVar(k, el.value === '' ? '' : (parseInt(el.value, 10) + 'px'));
      });
    });
    body.querySelectorAll('.ue-ui-clear[data-var]').forEach(function(el){
      el.addEventListener('click', function(){ setVar(el.getAttribute('data-var'), ''); renderUITab(); });
    });
    var rRange = document.getElementById('ueRadiusRange'), rNum = document.getElementById('ueRadiusNum');
    function setRadius(v){ var o = ueUiLoad(); if (v === '' || v == null) delete o.radius; else o.radius = String(parseInt(v, 10)); ueUiSave(o); }
    if (rRange) rRange.addEventListener('input', function(){ if (rNum) rNum.value = rRange.value; setRadius(rRange.value); });
    if (rNum) rNum.addEventListener('change', function(){ setRadius(rNum.value); });
    var rClear = document.getElementById('ueRadiusClear'); if (rClear) rClear.addEventListener('click', function(){ setRadius(''); renderUITab(); });
    var bgUrl = document.getElementById('ueBgUrl');
    if (bgUrl) bgUrl.addEventListener('change', function(){
      var o = ueUiLoad(); o.bg = o.bg || {}; var v = bgUrl.value.trim();
      if (v) { o.bg.src = v; } else if (o.bg.src !== '__local__') { delete o.bg.src; }
      ueUiSave(o);
    });
    var bgFile = document.getElementById('ueBgFile');
    if (bgFile) bgFile.addEventListener('change', function(){
      var f = bgFile.files && bgFile.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024 && !confirm('图片约 ' + Math.round(f.size / 1024) + 'KB，仅存本机不上云，确定？')) { bgFile.value = ''; return; }
      var rd = new FileReader();
      rd.onload = function(){ var as = ueAssetsLoad(); as.bgData = rd.result; ueAssetsSave(as); var o = ueUiLoad(); o.bg = o.bg || {}; o.bg.src = '__local__'; ueUiSave(o); renderUITab(); };
      rd.readAsDataURL(f);
    });
    var bgOp = document.getElementById('ueBgOpacity');
    if (bgOp) bgOp.addEventListener('input', function(){ var o = ueUiLoad(); o.bg = o.bg || {}; o.bg.opacity = bgOp.value; ueUiSave(o); var l = document.getElementById('ueBgOpacityLbl'); if (l) l.textContent = bgOp.value + '%'; });
    var bgBlur = document.getElementById('ueBgBlur');
    if (bgBlur) bgBlur.addEventListener('input', function(){ var o = ueUiLoad(); o.bg = o.bg || {}; o.bg.blur = bgBlur.value; ueUiSave(o); var l = document.getElementById('ueBgBlurLbl'); if (l) l.textContent = bgBlur.value + 'px'; });
    var bgClr = document.getElementById('ueBgClear');
    if (bgClr) bgClr.addEventListener('click', function(){ var o = ueUiLoad(); delete o.bg; ueUiSave(o); var as = ueAssetsLoad(); delete as.bgData; ueAssetsSave(as); renderUITab(); });
    var auUrl = document.getElementById('ueAudioUrl');
    if (auUrl) auUrl.addEventListener('change', function(){ var o = ueUiLoad(); o.audio = o.audio || {}; var v = auUrl.value.trim(); if (v) o.audio.src = v; else if (o.audio.src !== '__local__') delete o.audio.src; ueUiSave(o); });
    var auFile = document.getElementById('ueAudioFile');
    if (auFile) auFile.addEventListener('change', function(){
      var f = auFile.files && auFile.files[0]; if (!f) return;
      if (f.size > 8 * 1024 * 1024 && !confirm('音频约 ' + Math.round(f.size / 1024) + 'KB，仅存本机不上云，确定？')) { auFile.value = ''; return; }
      var rd = new FileReader();
      rd.onload = function(){ var as = ueAssetsLoad(); as.audioData = rd.result; ueAssetsSave(as); var o = ueUiLoad(); o.audio = o.audio || {}; o.audio.src = '__local__'; ueUiSave(o); renderUITab(); alert('已保存本机音频，刷新页面后在 lewd 主题生效'); };
      rd.readAsDataURL(f);
    });
    var auClr = document.getElementById('ueAudioClear');
    if (auClr) auClr.addEventListener('click', function(){ var o = ueUiLoad(); delete o.audio; ueUiSave(o); var as = ueAssetsLoad(); delete as.audioData; ueAssetsSave(as); renderUITab(); });
    var rawApply = document.getElementById('ueRawApply');
    if (rawApply) rawApply.addEventListener('click', function(){ var o = ueUiLoad(); o.raw = (document.getElementById('ueRawVars').value || ''); ueUiSave(o); });
    var exp = document.getElementById('ueThemeExport'); if (exp) exp.addEventListener('click', ueThemeExport);
    var imp = document.getElementById('ueThemeImport'); if (imp) imp.addEventListener('click', ueThemeImport);
    var rst = document.getElementById('ueResetAll');
    if (rst) rst.addEventListener('click', function(){
      if (!confirm('清除所有 UI 覆盖（颜色/布局/圆角/背景/音源/高级变量），恢复主题默认？')) return;
      try { localStorage.removeItem(UI_KEY); localStorage.removeItem(UI_ASSETS_KEY); } catch (e) {}
      applyUIOverrides(); renderUITab();
    });
  }

  function ueThemePortable(){
    var o = ueUiLoad();
    var out = { vars: o.vars || {}, raw: o.raw || '' };
    if (o.radius != null && o.radius !== '') out.radius = o.radius;
    if (o.bg && o.bg.src && o.bg.src !== '__local__') out.bg = { src: o.bg.src, opacity: o.bg.opacity, blur: o.bg.blur };
    if (o.audio && o.audio.src && o.audio.src !== '__local__') out.audio = { src: o.audio.src };
    return out;
  }
  function ueThemeExport(){
    var json = JSON.stringify(ueThemePortable(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function(){ alert('主题 JSON 已复制到剪贴板'); }, function(){ prompt('复制主题 JSON：', json); });
    } else { prompt('复制主题 JSON：', json); }
  }
  function ueThemeImport(){
    var slot = document.getElementById('ueThemeSlot'); if (!slot) return;
    slot.innerHTML = '<div class="ue-editor-card"><div class="ue-editor-head">' + UE_A.imp + ' 粘贴主题 JSON（覆盖颜色/布局/圆角/高级/URL 背景音源，不动本机大文件）</div><textarea class="ue-textarea ue-mono" id="ueThemeJson" rows="10"></textarea><div class="ue-editor-foot"><button class="ue-btn ue-btn-primary" id="ueThemeJsonSave">导入</button><button class="ue-btn" id="ueThemeJsonCancel">取消</button></div></div>';
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('ueThemeJsonSave').addEventListener('click', function(){
      var s = document.getElementById('ueThemeJson').value || '';
      try {
        var p = JSON.parse(s);
        if (!p || typeof p !== 'object') throw new Error('顶层必须是对象');
        var o = ueUiLoad();
        o.vars = (p.vars && typeof p.vars === 'object') ? p.vars : {};
        o.raw = typeof p.raw === 'string' ? p.raw : '';
        if (p.radius != null && p.radius !== '') o.radius = String(parseInt(p.radius, 10)); else delete o.radius;
        if (p.bg && p.bg.src) o.bg = { src: p.bg.src, opacity: p.bg.opacity, blur: p.bg.blur };
        else if (!(o.bg && o.bg.src === '__local__')) delete o.bg;
        if (p.audio && p.audio.src) { o.audio = o.audio || {}; o.audio.src = p.audio.src; }
        ueUiSave(o); renderUITab(); alert('主题已导入');
      } catch (e) { alert('JSON 解析失败：' + e.message); }
    });
    document.getElementById('ueThemeJsonCancel').addEventListener('click', function(){ slot.innerHTML = ''; });
  }

  function ensureUiTabStyles(){
    if (document.getElementById('ueUiTabStyles')) return;
    var s = document.createElement('style');
    s.id = 'ueUiTabStyles';
    s.textContent = [
      '.ue-ui-sec { margin: 14px 0; padding: 12px 14px; border: 1px solid rgba(127,127,127,.18); border-radius: 10px; background: rgba(127,127,127,.05); }',
      '.ue-ui-sec-h { font-size: 13px; font-weight: 600; margin-bottom: 8px; opacity: .9; }',
      '.ue-ui-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; flex-wrap: wrap; }',
      '.ue-ui-label { font-size: 12px; opacity: .75; width: 88px; flex: 0 0 88px; }',
      '.ue-ui-color { width: 36px; height: 28px; padding: 0; border: 1px solid rgba(127,127,127,.4); border-radius: 6px; background: transparent; cursor: pointer; }',
      '.ue-ui-hex { width: 120px; padding: 5px 8px; border-radius: 7px; border: 1px solid rgba(127,127,127,.35); background: rgba(0,0,0,.15); color: inherit; font: inherit; font-size: 12px; }',
      '.ue-ui-range { flex: 1; min-width: 120px; accent-color: var(--ue-tab-accent, currentColor); }',
      '.ue-ui-num { width: 74px; padding: 5px 8px; border-radius: 7px; border: 1px solid rgba(127,127,127,.35); background: rgba(0,0,0,.15); color: inherit; font: inherit; font-size: 12px; }',
      '.ue-ui-unit { font-size: 12px; opacity: .6; min-width: 36px; }',
      '.ue-ui-grow { flex: 1; min-width: 160px; width: auto; }',
      '.ue-ui-hint { font-size: 11px; opacity: .6; }',
      '.ue-ui-note { font-size: 11.5px; line-height: 1.6; opacity: .8; margin: 8px 0 2px; padding: 8px 10px; border-radius: 8px; background: rgba(255,180,60,.08); border: 1px solid rgba(255,180,60,.25); }'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ============== Runtime CSS（避免污染全局 styles.css，自我注入）==============
  function ensureStyles(){
    if (document.getElementById('ueRuntimeStyles')) return;
    var s = document.createElement('style');
    s.id = 'ueRuntimeStyles';
    s.textContent = [
      // 4.53-fix: 弹窗壳 + Tab 条样式自我注入(原先只活在 styles.css,被改动后会塌成「Tab 挤一坨」)。关键防挤属性加 !important 兜底,以后改 styles.css 也不塌。
      '#unlimitedEditorMask { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; padding: 20px; background: rgba(8,8,12,.66); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); }',
      '#unlimitedEditorMask.open { display: flex; }',
      '#unlimitedEditor { --ue-accent: var(--ue-tab-accent, rgba(180,180,180,.75)); --ue-accent-soft: color-mix(in srgb, var(--ue-tab-accent, rgba(180,180,180,.75)) 16%, transparent); display: flex; flex-direction: column; width: min(880px, 96vw); max-height: 90vh; overflow: hidden; background: var(--bg, #0f0f12); color: inherit; border: 1px solid rgba(127,127,127,.3); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.6); }',
      '@keyframes uePopIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }',
      '#unlimitedEditorMask.open #unlimitedEditor { animation: uePopIn .22s ease; }',
      '#unlimitedEditor .ue-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; flex-shrink: 0; border-bottom: 1px solid rgba(127,127,127,.2); background: linear-gradient(135deg, var(--ue-accent-soft), transparent 72%); }',
      '#unlimitedEditor .ue-title { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }',
      '#unlimitedEditor .ue-title svg { color: var(--ue-accent); }',
      '#unlimitedEditor .ue-badge { font-size: 11px; font-weight: 500; opacity: .7; padding: 2px 8px; border: 1px solid currentColor; border-radius: 999px; }',
      '#unlimitedEditor .ue-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; cursor: pointer; font-size: 15px; line-height: 1; flex: 0 0 auto; }',
      '#unlimitedEditor .ue-close:hover { background: rgba(255,80,80,.14); color: #ff7777; border-color: #ff7777; }',
      '#unlimitedEditor .ue-tabs { display: flex !important; flex-wrap: nowrap !important; flex-shrink: 0; gap: 6px; padding: 14px 16px 12px; overflow-x: auto !important; border-bottom: 1px solid rgba(127,127,127,.15); -webkit-overflow-scrolling: touch; scrollbar-width: none; }',
      '#unlimitedEditor .ue-tabs::-webkit-scrollbar { display: none; }',
      '#unlimitedEditor .ue-tab { display: inline-flex !important; align-items: center; justify-content: center; gap: 6px; flex: 0 0 auto !important; white-space: nowrap !important; padding: 8px 16px; margin-bottom: 0 !important; border: 1px solid transparent; border-radius: 10px; background: rgba(127,127,127,.07); color: inherit; cursor: pointer; font-size: 13px; line-height: 1.2; opacity: .6; transition: background .15s, opacity .15s, border-color .15s, box-shadow .15s; }',
      '#unlimitedEditor .ue-tab:hover { opacity: 1; background: rgba(127,127,127,.1); }',
      '#unlimitedEditor .ue-tab.active { opacity: 1; border-color: var(--ue-accent); background: var(--ue-accent-soft); color: var(--ue-accent); font-weight: 600; box-shadow: 0 2px 10px rgba(0,0,0,.12); }',
      '#unlimitedEditor .ue-tab.active svg { color: var(--ue-accent); }',
      '#unlimitedEditor .ue-tab-icon { font-size: 15px; flex: 0 0 auto; }',
      '#unlimitedEditor .ue-tab-label { display: inline !important; flex: 0 0 auto; }',
      '#unlimitedEditor .ue-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 20px; }',
      '#unlimitedEditor .ue-panel-icon { color: var(--ue-accent); }',
      '#unlimitedEditor .ue-panel-name { font-size: 18px; font-weight: 700; letter-spacing: .2px; }',
      '#unlimitedEditor .ue-panel-head { display: flex; align-items: center; gap: 9px; padding-bottom: 12px; margin-bottom: 2px; border-bottom: 1px solid rgba(127,127,127,.14); }',
      '#unlimitedEditor .ue-panel-desc { font-size: 12.5px; line-height: 1.65; opacity: .62; margin: 12px 0 2px; max-width: 760px; }',
      '#unlimitedEditor .ue-emo-warn { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 1.6; margin: 12px 0 2px; padding: 10px 13px; border-radius: 10px; background: rgba(255,180,60,.1); border: 1px solid rgba(255,180,60,.28); }',
      '#unlimitedEditor .ue-emo-warn svg { flex: 0 0 auto; opacity: .85; }',
      '.ue-preset-row.ue-emo-row { grid-template-columns: auto auto 1fr auto; }',
      '.ue-emo-badge { font-weight: 600; font-size: 13px; padding: 3px 12px; border-radius: 999px; background: var(--ue-accent-soft); color: var(--ue-accent); border: 1px solid var(--ue-accent); white-space: nowrap; }',
      '.ue-preset-row:not(.enabled) .ue-emo-badge { background: rgba(127,127,127,.08); color: inherit; border-color: rgba(127,127,127,.25); opacity: .6; }',
      '.ue-emo-lvl { font-size: 12px; letter-spacing: 2px; color: var(--ue-accent); opacity: .85; white-space: nowrap; }',
      '#unlimitedEditor .ue-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-top: 1px solid rgba(127,127,127,.2); background: rgba(127,127,127,.04); }',
      '#unlimitedEditor .ue-footer-hint { font-size: 11px; opacity: .55; }',
      '#unlimitedEditor .ue-btn-ghost { padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; cursor: pointer; font-size: 13px; }',
      '#unlimitedEditor .ue-btn-ghost:hover { background: rgba(127,127,127,.15); }',
      '@media (max-width: 640px) { #unlimitedEditorMask { padding: 0; } #unlimitedEditor { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; border: none; } #unlimitedEditor .ue-header { padding: 12px 14px; } #unlimitedEditor .ue-tabs { padding: 10px 12px 8px; } #unlimitedEditor .ue-body { padding: 12px 14px 16px; } #unlimitedEditor .ue-tab { padding: 8px 13px; } }',
      '.ue-toolbar { display: flex; flex-wrap: wrap; gap: 10px; row-gap: 10px; align-items: center; margin: 16px 0 14px; padding: 10px 12px; border-radius: 12px; background: rgba(127,127,127,.04); border: 1px solid rgba(127,127,127,.1); }',
      '.ue-toolbar-spacer { flex: 1; }',
      '.ue-count { font-size: 12px; opacity: .65; }',
      '.ue-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 9px; border: 1px solid rgba(127,127,127,.3); background: rgba(127,127,127,.06); color: inherit; cursor: pointer; font-size: 13px; line-height: 1.3; opacity: .9; }',
      '.ue-btn:hover { opacity: 1; background: rgba(127,127,127,.12); }',
      '.ue-btn-primary { border-color: var(--ue-accent); background: var(--ue-accent); color: #fff; opacity: 1; }',
      '.ue-btn-primary:hover { background: var(--btn-bg-hover, var(--ue-accent)); }',
      '.ue-preset-list { display: flex; flex-direction: column; gap: 9px; margin: 10px 0 18px; }',
      '.ue-preset-row { display: grid; grid-template-columns: auto minmax(110px, 200px) 1fr auto; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 13px; background: rgba(127,127,127,.05); border: 1px solid rgba(127,127,127,.16); transition: border-color .16s, background .16s, box-shadow .16s, transform .16s; }',
      '.ue-preset-row:hover { background: rgba(127,127,127,.09); border-color: rgba(127,127,127,.28); box-shadow: 0 4px 16px rgba(0,0,0,.1); transform: translateY(-1px); }',
      '.ue-preset-row.enabled { border-color: var(--ue-accent); box-shadow: inset 3px 0 0 var(--ue-accent); background: var(--ue-accent-soft); }',
      '.ue-preset-tog { display: flex; align-items: center; gap: 8px; cursor: pointer; min-width: 0; }',
      '.ue-preset-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }',
      '.ue-preset-preview { font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }',
      '.ue-preset-ops { display: flex; gap: 4px; }',
      '.ue-mini { padding: 2px 8px; font-size: 13px; line-height: 1.2; border-radius: 6px; border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; cursor: pointer; }',
      '.ue-mini:hover { background: rgba(127,127,127,.18); }',
      '.ue-mini.danger:hover { background: rgba(255, 80, 80, .15); color: #ff7777; border-color: #ff7777; }',
      '.ue-mini-placeholder { display: inline-block; width: 28px; }',
      '.ue-empty { padding: 28px 16px; text-align: center; opacity: .55; font-size: 13px; border: 1px dashed rgba(127,127,127,.3); border-radius: 10px; }',
      '.ue-editor-slot:empty { display: none; }',
      '.ue-preset-drag { cursor: grab; opacity: .4; font-size: 15px; user-select: none; }',
      '.ue-preset-row.dragging { opacity: .4; }',
      '.ue-preset-row.dragover { border-color: currentColor; box-shadow: 0 -2px 0 currentColor inset; }',
      '.ue-pgroup-head { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; padding: 6px 8px; border-radius: 8px; background: rgba(127,127,127,.1); cursor: pointer; user-select: none; }',
      '.ue-pgroup-arrow { width: 14px; opacity: .7; }',
      '.ue-pgroup-name { font-weight: 600; font-size: 13px; }',
      '.ue-pgroup-count { font-size: 11px; opacity: .6; background: rgba(127,127,127,.2); border-radius: 10px; padding: 1px 7px; }',
      '.ue-pgroup-del { margin-left: auto; }',
      '.ue-pgroup-body { display: flex; flex-direction: column; gap: 6px; padding-left: 6px; border-left: 2px solid rgba(127,127,127,.18); margin-bottom: 6px; }',
      '.ue-editor-card { margin-top: 10px; padding: 14px; border-radius: 10px; background: rgba(127,127,127,.08); border: 1px solid var(--ue-accent); box-shadow: 0 6px 24px rgba(0,0,0,.12); }',
      '.ue-editor-head { color: var(--ue-accent); }',
      '.ue-editor-head { font-weight: 600; margin-bottom: 10px; font-size: 14px; }',
      '.ue-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }',
      '.ue-field > span { font-size: 12px; opacity: .7; }',
      '.ue-input, .ue-textarea { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,.35); background: rgba(0,0,0,.15); color: inherit; font: inherit; box-sizing: border-box; }',
      '.ue-input:focus, .ue-textarea:focus { outline: none; border-color: var(--ue-accent); box-shadow: 0 0 0 3px var(--ue-accent-soft); }',
      '.ue-textarea { resize: vertical; min-height: 100px; }',
      '.ue-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; }',
      '.ue-editor-foot { display: flex; gap: 8px; margin-top: 8px; }',
      '.ue-char-ava { font-size: 18px; width: 24px; text-align: center; }',
      '.ue-char-cur { font-size: 10px; padding: 0 6px; border-radius: 8px; border: 1px solid currentColor; opacity: .8; margin-left: 4px; }',
      '.ue-char-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
      '@media (max-width: 640px) {',
        '  .ue-toolbar { gap: 7px; }',
        '  .ue-toolbar .ue-btn { flex: 1 1 calc(50% - 4px); justify-content: center; padding: 9px 8px; }',
        '  .ue-toolbar-spacer { display: none; }',
        '  .ue-count { flex: 1 1 100%; text-align: center; order: 9; }',
        '  .ue-mini { padding: 5px 11px; font-size: 14px; }',
        '  .ue-preset-row { grid-template-columns: 1fr; gap: 6px; padding: 12px 13px; }',
        '  .ue-preset-preview { white-space: normal; -webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }',
        '  .ue-preset-ops { justify-content: flex-end; }',
        '  .ue-char-grid2 { grid-template-columns: 1fr; }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ============== 语音情绪 Tab 实质化（§四 · emotionMap / cfw_tts_emotion_map_v1）==============
  // 「情绪 × 强度 → 参考音频路径」映射。tts-emotion.js 读它，按句首 [情绪:强度] 标签逐句切气声参考音。
  // 范式照抄 preset/world Tab：fallback 卡 + 列表 + 编辑卡 + JSON 源码 + 导出 + 载入示例包。
  var EMOTION_KEY = 'cfw_tts_emotion_map_v1';
  var EMOTION_PRESETS = ['情动','娇喘','喘息','呻吟','求饶','失神','事后','主导','顺从','撒娇','关心','平静'];

  function ueEmoDefault(){ return { version: 1, fallback: { ref: '', prompt: '' }, entries: [] }; }
  function ueEmoLoad(){
    try {
      var raw = localStorage.getItem(EMOTION_KEY);
      if (!raw) return ueEmoDefault();
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return ueEmoDefault();
      if (!o.fallback || typeof o.fallback !== 'object') o.fallback = { ref: '', prompt: '' };
      if (!Array.isArray(o.entries)) o.entries = [];
      if (o.version == null) o.version = 1;
      return o;
    } catch (e) { return ueEmoDefault(); }
  }
  function ueEmoSave(o){
    try { localStorage.setItem(EMOTION_KEY, JSON.stringify(o || {})); } catch (e) {}
    try { if (window.__ttsEmotion && typeof window.__ttsEmotion.reload === 'function') window.__ttsEmotion.reload(); } catch (e) {}
  }
  function ueEmoKey(e){ return (e.emotion || '') + '|' + (e.level || '') + '|' + (e.scene || ''); }
  async function ueEmoFetchStarter(){
    try {
      var resp = await fetch('/presets/starter-emotion-map.json', { cache: 'no-store' });
      if (!resp.ok) return null;
      var data = await resp.json();
      if (data && Array.isArray(data.entries)) return data;
      return null;
    } catch (e) { return null; }
  }

  function renderVoiceTab(){
    var t = findTab('voice'), body = document.getElementById('ueBody'); if (!body) return;
    ensureUiTabStyles();
    var map = ueEmoLoad();
    var entries = map.entries.slice();
    entries.sort(function(a,b){ return String(a.emotion||'').localeCompare(String(b.emotion||'')) || ((a.level||0) - (b.level||0)); });
    var inApp = !!(window.__TAURI__);
    body.innerHTML = ['<div class="ue-panel">',
      '<div class="ue-panel-head"><span class="ue-panel-icon">' + t.icon + '</span><span class="ue-panel-name">' + escapeHtml(t.label) + '</span></div>',
      '<p class="ue-panel-desc">' + escapeHtml(t.desc) + '</p>',
      (inApp ? '' : '<div class="ue-emo-warn">' + UE_A.sound + '<span>当前是网页版：映射可正常编辑并云同步，但<b>逐句切气声朗读仅桌面 App 生效</b>（依赖本地 GPT-SoVITS）。</span></div>'),
      '<div class="ue-ui-sec"><div class="ue-ui-sec-h">' + UE_A.sound + ' 兜底音色 fallback（查不到精确匹配时回落）</div>',
        '<label class="ue-field"><span>兜底参考音路径</span><input class="ue-input" id="ueEmoFbRef" value="' + escapeAttr(map.fallback.ref || '') + '" placeholder="D:/gpt-sovits/refs/neutral_mid.wav"></label>',
        '<label class="ue-field"><span>兜底参考文字 prompt（可空）</span><input class="ue-input" id="ueEmoFbPrompt" value="' + escapeAttr(map.fallback.prompt || '') + '" placeholder="嗯，我在听。"></label>',
      '</div>',
      '<div class="ue-toolbar">',
        '<button class="ue-btn ue-btn-primary" id="ueEmoNew">' + UE_A.plus + ' 新建条目</button>',
        '<button class="ue-btn" id="ueEmoStarter" title="从 /presets/starter-emotion-map.json 载入示例映射（会覆盖现有）">' + UE_A.reload + ' 载入示例包</button>',
        '<button class="ue-btn" id="ueEmoJson">' + UE_A.code + ' JSON 源码</button>',
        '<button class="ue-btn" id="ueEmoExport">' + UE_A.exp + ' 导出</button>',
        '<span class="ue-toolbar-spacer"></span>',
        '<span class="ue-count">共 ' + entries.length + ' 条</span>',
      '</div>',
      '<div class="ue-preset-list" id="ueEmoList">' + ueEmoListHtml(entries) + '</div>',
      '<div class="ue-editor-slot" id="ueEmoEditor"></div>',
    '</div>'].join('');

    var fbRef = document.getElementById('ueEmoFbRef'), fbPrompt = document.getElementById('ueEmoFbPrompt');
    if (fbRef) fbRef.addEventListener('change', function(){ var m = ueEmoLoad(); m.fallback = m.fallback || {}; m.fallback.ref = fbRef.value.trim(); ueEmoSave(m); });
    if (fbPrompt) fbPrompt.addEventListener('change', function(){ var m = ueEmoLoad(); m.fallback = m.fallback || {}; m.fallback.prompt = fbPrompt.value; ueEmoSave(m); });

    document.getElementById('ueEmoNew').addEventListener('click', function(){ ueEmoEdit(null); });
    document.getElementById('ueEmoStarter').addEventListener('click', async function(){
      var pack = await ueEmoFetchStarter();
      if (!pack) { alert('从 /presets/starter-emotion-map.json 载入失败（可能尚未部署或网络异常）'); return; }
      if (!confirm('将用示例映射（' + ((pack.entries||[]).length) + ' 条）覆盖当前映射（' + ueEmoLoad().entries.length + ' 条）。继续？')) return;
      ueEmoSave(pack); renderVoiceTab();
    });
    document.getElementById('ueEmoJson').addEventListener('click', ueEmoJsonEditor);
    document.getElementById('ueEmoExport').addEventListener('click', function(){
      var json = JSON.stringify(ueEmoLoad(), null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function(){ alert('已导出 emotionMap 到剪贴板'); }, function(){ prompt('复制 JSON：', json); });
      else prompt('复制 JSON：', json);
    });

    var listEl = document.getElementById('ueEmoList');
    listEl.addEventListener('click', function(e){
      var row = e.target.closest && e.target.closest('.ue-preset-row'); if (!row) return;
      var key = row.getAttribute('data-key');
      if (e.target.classList.contains('ue-emo-edit')) ueEmoEdit(key);
      else if (e.target.classList.contains('ue-emo-del')) ueEmoDel(key);
      else if (e.target.classList.contains('ue-emo-play')) ueEmoPreview(key);
    });
  }

  function ueEmoListHtml(entries){
    if (!entries.length) return '<div class="ue-empty">还没有情绪音条目。点「＋ 新建条目」添加，或「载入示例包」载入模板后把路径改成你本机的参考音。</div>';
    return entries.map(function(e){
      var lvl = e.level || 0;
      var dots = '●'.repeat(Math.max(0, Math.min(3, lvl))) + '○'.repeat(Math.max(0, 3 - lvl));
      var sub = (e.ref ? e.ref : '⚠ 未填音频路径') + (e.scene ? ('　·　场景：' + e.scene) : '') + (e.prompt ? ('　·　“' + e.prompt + '”') : '');
      return ['<div class="ue-preset-row ue-emo-row' + (e.ref ? ' enabled' : '') + '" data-key="' + escapeAttr(ueEmoKey(e)) + '">',
        '<span class="ue-emo-badge">' + escapeHtml(e.emotion || '(未命名)') + '</span>',
        '<span class="ue-emo-lvl" title="强度 ' + lvl + '/3">' + dots + '</span>',
        '<div class="ue-preset-preview">' + escapeHtml(sub) + '</div>',
        '<div class="ue-preset-ops">',
          '<button class="ue-mini ue-emo-play" title="试听">▶</button>',
          '<button class="ue-mini ue-emo-edit" title="编辑">✎</button>',
          '<button class="ue-mini danger ue-emo-del" title="删除">✕</button>',
        '</div>',
      '</div>'].join('');
    }).join('');
  }

  function ueEmoEdit(key){
    var slot = document.getElementById('ueEmoEditor'); if (!slot) return;
    var map = ueEmoLoad();
    var isNew = !key;
    var e = isNew ? { emotion: '', level: 2, ref: '', prompt: '', scene: '' }
      : (map.entries.find(function(x){ return ueEmoKey(x) === key; }) || { emotion: '', level: 2, ref: '', prompt: '', scene: '' });
    var opts = EMOTION_PRESETS.map(function(em){ return '<option value="' + escapeAttr(em) + '"></option>'; }).join('');
    slot.innerHTML = ['<div class="ue-editor-card">',
      '<div class="ue-editor-head">' + (isNew ? (UE_A.plus + ' 新建情绪音条目') : ('✎ 编辑：' + escapeHtml(e.emotion || '') + ' / 强度 ' + (e.level || ''))) + '</div>',
      '<div class="ue-char-grid2">',
        '<label class="ue-field"><span>情绪 *</span><input class="ue-input" list="ueEmoDatalist" id="ueEmoEm" value="' + escapeAttr(e.emotion || '') + '" placeholder="如 娇喘 / 情动"><datalist id="ueEmoDatalist">' + opts + '</datalist></label>',
        '<label class="ue-field"><span>强度</span><select class="ue-input" id="ueEmoLv"><option value="1"' + (e.level == 1 ? ' selected' : '') + '>1 · 弱</option><option value="2"' + (e.level == 2 ? ' selected' : '') + '>2 · 中</option><option value="3"' + (e.level == 3 ? ' selected' : '') + '>3 · 强</option></select></label>',
      '</div>',
      '<label class="ue-field"><span>参考音频路径 *（GPT-SoVITS 服务端能读到的绝对路径，3–10s 干净单一音色）</span><input class="ue-input" id="ueEmoRef" value="' + escapeAttr(e.ref || '') + '" placeholder="D:/gpt-sovits/refs/F/jiao_mid.wav"></label>',
      '<label class="ue-field"><span>参考文字 prompt（该音频对应台词，可空）</span><input class="ue-input" id="ueEmoPrompt" value="' + escapeAttr(e.prompt || '') + '" placeholder="啊…嗯…"></label>',
      '<label class="ue-field"><span>场景基调 scene（可空，如「事后」「主导」）</span><input class="ue-input" id="ueEmoScene" value="' + escapeAttr(e.scene || '') + '" placeholder="留空即忽略"></label>',
      '<div class="ue-editor-foot"><button class="ue-btn ue-btn-primary" id="ueEmoSave">' + (isNew ? '新建' : '保存修改') + '</button>' + (isNew ? '' : '<button class="ue-btn" id="ueEmoPrev">▶ 试听</button>') + '<button class="ue-btn" id="ueEmoCancel">取消</button></div>',
    '</div>'].join('');
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('ueEmoCancel').addEventListener('click', function(){ slot.innerHTML = ''; });
    var prevBtn = document.getElementById('ueEmoPrev'); if (prevBtn) prevBtn.addEventListener('click', function(){ ueEmoPreview(key); });
    document.getElementById('ueEmoSave').addEventListener('click', function(){
      var em = (document.getElementById('ueEmoEm').value || '').trim();
      if (!em) { alert('情绪不能为空'); return; }
      var lv = parseInt(document.getElementById('ueEmoLv').value, 10) || 2;
      var ref = (document.getElementById('ueEmoRef').value || '').trim();
      var prompt = document.getElementById('ueEmoPrompt').value || '';
      var scene = (document.getElementById('ueEmoScene').value || '').trim();
      var merged = { emotion: em, level: lv, ref: ref, prompt: prompt, scene: scene };
      var m = ueEmoLoad();
      if (!isNew) m.entries = m.entries.filter(function(x){ return ueEmoKey(x) !== key; });
      var nk = ueEmoKey(merged);
      m.entries = m.entries.filter(function(x){ return ueEmoKey(x) !== nk; });
      m.entries.push(merged);
      ueEmoSave(m); renderVoiceTab();
    });
  }

  function ueEmoDel(key){
    var m = ueEmoLoad();
    var e = m.entries.find(function(x){ return ueEmoKey(x) === key; });
    if (!e) return;
    if (!confirm('删除「' + (e.emotion || '') + ' / 强度 ' + (e.level || '') + '」？')) return;
    m.entries = m.entries.filter(function(x){ return ueEmoKey(x) !== key; });
    ueEmoSave(m); renderVoiceTab();
  }

  function ueEmoPreview(key){
    if (!window.__TAURI__) { alert('试听仅桌面 App 可用'); return; }
    var m = ueEmoLoad();
    var e = key ? m.entries.find(function(x){ return ueEmoKey(x) === key; }) : null;
    var ref = e ? e.ref : (m.fallback && m.fallback.ref);
    var prompt = e ? e.prompt : (m.fallback && m.fallback.prompt);
    if (!ref) { alert('该条目未填参考音频路径'); return; }
    var tts = window.__omniTTS;
    if (!tts || typeof tts.synthWith !== 'function' || typeof tts.enqueuePlay !== 'function') { alert('TTS 模块未就绪（需 tts.js 已加载并支持 synthWith）'); return; }
    var sample = prompt || (e ? (e.emotion + '，这是 ' + (e.level || 2) + ' 档参考音。') : '这是兜底参考音。');
    try {
      tts.synthWith({ text: sample, refAudioPath: ref, promptText: prompt || '' }).then(function(blob){ if (blob) tts.enqueuePlay(blob); else alert('合成失败（检查 GPT-SoVITS 服务与路径）'); }, function(err){ alert('试听失败：' + (err && err.message ? err.message : err)); });
    } catch (x) { alert('试听失败：' + (x && x.message ? x.message : x)); }
  }

  function ueEmoJsonEditor(){
    var slot = document.getElementById('ueEmoEditor'); if (!slot) return;
    var json = JSON.stringify(ueEmoLoad(), null, 2);
    slot.innerHTML = ['<div class="ue-editor-card">',
      '<div class="ue-editor-head">' + UE_A.code + ' JSON 源码模式（保存覆盖整份 emotionMap）</div>',
      '<textarea class="ue-textarea ue-mono" id="ueEmoJsonText" rows="16">' + escapeHtml(json) + '</textarea>',
      '<div class="ue-editor-foot"><button class="ue-btn ue-btn-primary" id="ueEmoJsonSave">保存 JSON</button><button class="ue-btn" id="ueEmoJsonCancel">取消</button></div>',
    '</div>'].join('');
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('ueEmoJsonSave').addEventListener('click', function(){
      var s = document.getElementById('ueEmoJsonText').value || '';
      try {
        var o = JSON.parse(s);
        if (!o || typeof o !== 'object') throw new Error('顶层必须是对象');
        if (!Array.isArray(o.entries)) throw new Error('缺少 entries 数组');
        if (!o.fallback || typeof o.fallback !== 'object') o.fallback = { ref: '', prompt: '' };
        if (o.version == null) o.version = 1;
        ueEmoSave(o); renderVoiceTab();
      } catch (e) { alert('JSON 解析失败：' + e.message); }
    });
    document.getElementById('ueEmoJsonCancel').addEventListener('click', function(){ slot.innerHTML = ''; });
  }

  window.__unlimitedEditor = {
    open: open, close: close, switchTab: switchTab,
    // 4.22: 外部可调用重新应用 UI 覆盖层
    applyUIOverrides: function(){ try { applyUIOverrides(); } catch (e) {} },
    // 外部强制刷新当前 tab（如 settings 改了 LS 后调用）
    refresh: function(){ if (mask && mask.classList.contains('open')) renderBody(); }
  };
})();