// public/js/text/ui/settings.js
// 设置面板统一管理模块
// 职责:
//   1. 分类标签切换(settings-cat-nav + LS 持久化)
//   2. 面板开关(settingsBtn / closeSettingsBtn / settingsMask)
//   3. 所有 LS-only 开关/选择器(从 index.html 内联 <script> 迁入)
//      - showTopbarCostToggle  → cfw_show_topbar_cost_v1
//      - hideMsgActionsToggle  → cfw_hide_msg_actions_v1
//      - hideStatsToggle       → cfw_hide_stats_v1
//      - strictRoleplayToggle  → cfw_strict_roleplay_v1
//      - NSFW 等级单选          → cfw_nsfw_mode_v1
//      - replyStyleSel         → cfw_reply_style_v1
//      - 字号 / 字体           → cfw_chat_font_size_v1 / cfw_chat_font_family_v1
//      - syncIncludeChatToggle → cfw_sync_include_chat_v1
//      - syncWipeBtn / cloudExcludeSection
//   4. 云同步 + Auth UI(从 app.js setupSyncAuthUI 迁入)
//   5. 「思考过程显示」下拉注入(从 app.js setupThinkDisplaySetting 迁入)
// 加载时机: app.js 之后,各 image 模块之前
// 路径: public/js/text/ui/settings.js
// 版本: 4.70 — 全部 emoji 清除，h4 改 SVG 图标
(() => {
  // ─── 0. 暴露 BYO 自定义模型配置给 app.js / agent 适配器 ───
  // get() 仅在 endpoint+model 齐全时返回配置对象,否则 null(回落内置 free/fast)。
  // app.js / 适配器组 /api/chat 请求体时: body.customProvider = window.__byoProvider.get() || undefined
  // worker.js 命中后跳过白名单、直连该端点,仍走解限底座(未知模型默认 PROMPT_1)。
  window.__byoProvider = {
    get() { try { var o = JSON.parse(localStorage.getItem('cfw_byo_provider_v1') || '{}'); return (o && o.endpoint && o.model) ? o : null; } catch (e) { return null; } }
  };

  // ─── 0.5 静态设置卡 JS 注入(M1:把卡 DOM 移出 index.html) ───
  // 每张卡在此创建并插入对应分类槽位,DOM 在 init 接线前就位,既有 init* 照常按 ID 接线。
  function mountTopbarCostCard() {
    var slot = document.getElementById('setAppearanceTopSlot');
    if (!slot || document.getElementById('showTopbarCostToggle')) return;
    var card = document.createElement('div'); card.className = 'card';
    card.innerHTML = '<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M3.5 9.2h17"/></svg>顶栏组件(Topbar Components)</h4>'
      + '<p>控制顶栏可选组件的显示。关闭后剩余按钮(模式切换 / 解限 / 同步 / 设置)自动紧凑排列。<b>仅本设备生效</b>(不进云同步)。</p>'
      + '<div class="rowline"><div class="toggle"><input type="checkbox" id="showTopbarCostToggle"><label for="showTopbarCostToggle">显示实时资金按钮(顶栏 · 今日 / 总计)</label></div></div>'
      + '<div class="settings-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg><span>资金数据始终在下面「费用日志」卡里完整可看;关掉顶栏仅减少视觉占用,不影响计费/同步。</span></div>';
    slot.appendChild(card);
  }
  function mountChatModeCard() {
    var slot = document.getElementById('setChatSlot');
    if (!slot || document.getElementById('strictRoleplayToggle')) return;
    var card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19l8.5-8.5"/><path d="M15 4.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/><path d="M6.5 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>互动模式(Roleplay Mode)</h4><p>控制底层 system prompt 注入。默认是<b>软提示</b>——允许角色自然跳出、不拍响词汇黑名单。<b>严格角色扮演</b>开启后注入完整人设铁则。<span data-nsfw><b>NSFW 等级</b> ≥1 会跳过铁则改为注入开放提示;切到<b>蜜桃/少女</b>主题会自动写 L2。</span></p><div class="rowline"><div class="toggle"><input type="checkbox" id="strictRoleplayToggle"><label for="strictRoleplayToggle">严格角色扮演(注入完整人设铁则)</label></div></div><div class="rowline"><div class="toggle"><input type="checkbox" id="hideMsgActionsToggle"><label for="hideMsgActionsToggle">隐藏消息行下方的小按钮(重试/删除/复制)</label></div></div><div class="rowline"><div class="toggle"><input type="checkbox" id="hideStatsToggle"><label for="hideStatsToggle">隐藏统计小字(token / 速度 / 累计费用)</label></div></div><div data-nsfw style="margin-top:12px;"><div style="font-size:12px;color:var(--muted);margin-bottom:8px;">NSFW 等级</div><div class="nsfw-options"><label class="nsfw-option"><input type="radio" name="cfwNsfwLevel" value="0"><span>0 · 关闭</span></label><label class="nsfw-option"><input type="radio" name="cfwNsfwLevel" value="1"><span>1 · 暗示</span></label><label class="nsfw-option"><input type="radio" name="cfwNsfwLevel" value="2"><span>2 · 露骨</span></label><label class="nsfw-option" data-dev-only><input type="radio" name="cfwNsfwLevel" value="3"><span>3 · 完全开放（开发者）</span></label></div></div><div style="margin-top:14px;"><div style="font-size:12px;color:var(--muted);margin-bottom:8px;">回复风格</div><select id="replyStyleSel" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border, #333);background:transparent;color:inherit;font-size:13px;"><option value="default">默认 · 交由角色卡决定</option><option value="wechat">微信连发 · 1-2 句一条·多气泡连发</option><option value="verbose">长段叙事 · 小说式丰满段落(写小说)</option></select></div><div class="settings-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg><span>单人普通对话<b>没有字数限制</b>,写小说请选 <b>长段叙事</b> 档。字数限制(150-250 字)只存在于鱼缸接龙/讨论模式,保持多人轮转节奏。</span></div>`;
    slot.appendChild(card);
  }
  function mountDisplayCard() {
    var slot = document.getElementById('setChatSlot');
    if (!slot || document.getElementById('chatFontSizeRange')) return;
    var card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h8M16 7h4M4 12h2M10 12h10M4 17h6M14 17h6"/><circle cx="14" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="12" cy="17" r="2"/></svg>显示设置(Display)</h4><p>调整聊天区字号和字体。<b>仅本设备生效</b>(不进云同步)，刷新页面也会保留。隐藏小按钮 toggle 在上面「互动模式」卡。</p><div style="margin-top:8px;"><label for="chatFontSizeRange" style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px;"><span>聊天字号</span><span id="chatFontSizeLabel" style="font-variant-numeric:tabular-nums;">13px</span></label><input type="range" id="chatFontSizeRange" min="12" max="22" step="1" value="13" style="width:100%;"></div><div style="margin-top:14px;"><div style="font-size:12px;color:var(--muted);margin-bottom:6px;">聊天字体</div><select id="chatFontFamilySel" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border, #333);background:transparent;color:inherit;font-size:13px;"><option value="">系统默认 · 苹方/微软雅黑</option><option value='"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'>圆体 · PingFang</option><option value='"Noto Serif SC", "Source Han Serif SC", "SimSun", serif'>宋体 · Noto Serif</option><option value='"Kaiti SC", "STKaiti", KaiTi, serif'>楷体 · Kaiti</option><option value='FangSong, STFangsong, serif'>仿宋 · FangSong</option><option value='ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'>等宽 · Monospace</option></select></div><div class="settings-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg><span>聊天区气泡跳动同步梳理主题请到「外观风格」卡切主题；wechat 连发模式会自动隐藏小按钮(同时被 toggle 接管)。</span></div>`;
    slot.appendChild(card);
  }
  function mountAuthCard() {
    var slot = document.getElementById('setAccountSlot');
    if (!slot || document.getElementById('chatProtectToggle')) return;
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-dev-only', '');
    card.innerHTML = `<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>密码保护（Auth）</h4><p><b>云同步</b>永远需要密码（用 Cloudflare Secret <code>CHAT_PASSWORD</code> 鉴权）。<b>聊天密码保护</b>可选:开启后调用 <code>/api/chat</code> 需带 token,关闭后聊天接口公开(任何扫到域名的人都能用你的余额)。</p><div class="rowline"><div class="toggle"><input type="checkbox" id="chatProtectToggle"><label for="chatProtectToggle">启用聊天密码保护(强烈推荐)</label></div><div class="btns"><button class="smallbtn danger" id="authLogoutBtn" title="清除本地保存的密码 token">退出登录</button></div></div><div id="authStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div>`;
    slot.appendChild(card);
  }
  function mountSyncCard() {
    var slot = document.getElementById('setAccountSlot');
    if (!slot || document.getElementById('syncEnableToggle')) return;
    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 18.5a4.5 4.5 0 0 1-.7-8.95A5.5 5.5 0 0 1 17 9.1 3.7 3.7 0 0 1 16.8 18.5z"/></svg>云同步（Cloud Sync）</h4><p>把全部数据(角色卡 · 道具 · preset · 亲密度 · 费用日志 · 对话历史)同步到 Cloudflare KV,换浏览器换设备都能看到。开启后本地改动会延迟 3 秒自动推送。<b>不同步:</b>密码 token / 同步状态本身。</p><div class="rowline"><div class="toggle"><input type="checkbox" id="syncEnableToggle"><label for="syncEnableToggle">启用云同步</label></div><div class="toggle" style="margin-top:6px;"><input type="checkbox" id="syncIncludeChatToggle"><label for="syncIncludeChatToggle">同步聊天历史（默认关 · 开启=跨设备共享对话）</label></div><div class="btns"><button class="smallbtn" id="syncNowBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v3.5h-3.5"/></svg>立即同步</button><button class="smallbtn" id="syncExportBtn" data-dev-only><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5V5"/><path d="M8 8.5L12 4.5l4 4"/><path d="M5 14.5v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-3.5"/></svg>导出备份</button><button class="smallbtn" id="syncImportBtn" data-dev-only><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5V15"/><path d="M8 11l4 4 4-4"/><path d="M5 14.5v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-3.5"/></svg>导入备份</button><input type="file" id="syncImportFile" accept=".json" style="display:none"><button class="smallbtn danger" id="syncWipeBtn" title="删除云端 KV 上的全部数据(角色卡/道具/preset/费用/对话的云端副本)。本地数据保留;同步仍开启时下次本地改动会重新上传,想让云端保持空请清空后关闭云同步。"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5h15"/><path d="M9 6.5V5.2A1.7 1.7 0 0 1 10.7 3.5h2.6A1.7 1.7 0 0 1 15 5.2V6.5"/><path d="M6.8 6.5l.7 12.2a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.7-12.2"/></svg>清空云端</button></div></div><div id="syncStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div><div id="syncQuotaWarn" style="font-size:11px;color:#f80;margin-top:4px;display:none;"></div><details id="cloudExcludeSection" style="margin-top:10px;"><summary style="cursor:pointer;font-size:12px;color:var(--muted);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 16.5a4.2 4.2 0 0 1-.6-8.35A5.2 5.2 0 0 1 16.5 8"/><path d="M14.5 14l5 5M19.5 14l-5 5"/></svg>按角色/会话 只清云端（保留本地）</summary><div style="font-size:11px;color:var(--muted);margin:6px 0;line-height:1.5;">只把选中项从云端 KV 抹掉,本地保留且本设备不再上传(tombstone)。<b>会话</b>仅在开了「同步聊天历史」时云端才有副本。<b>跨设备注意:</b>排除清单仅本设备生效,其他仍持有该数据且未排除的设备改动后可能把它推回。</div><div id="cloudExcludeList" style="display:flex;flex-direction:column;gap:6px;"></div></details>`;
    slot.appendChild(card);
  }
  // ─── M1: 本地对话记忆卡(#historyKeep / #promptKeep / #clearHistory) ───
  // 保存逻辑由 app.js 按 ID 接线；settings.js 仅在 openPanel 时同步显示值(见 initPanelToggle)。
  function mountLocalHistoryCard() {
    var slot = document.getElementById('setChatSlot');
    if (!slot || document.getElementById('historyKeep')) return;
    var card = document.createElement('div'); card.className = 'card'; card.id = 'localHistoryCard';
    card.innerHTML = '<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>本地对话记忆</h4>'
      + '<p>开启后发消息会带上本机历史上下文，AI 能记住你们说过的话。<b>仅本设备</b>（不进云同步）。</p>'
      + '<div class="rowline"><div class="toggle"><input type="checkbox" id="historyKeep"><label for="historyKeep">记住本机对话（带上历史消息）</label></div><div class="btns"><button class="smallbtn danger" id="clearHistory">清空对话</button></div></div>'
      + '<div class="rowline" style="margin-top:6px;"><div class="toggle"><input type="checkbox" id="promptKeep"><label for="promptKeep">记住自定义提示词（每次对话带上）</label></div></div>'
      + '<div class="settings-warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg><span>历史消息会消耗更多 token，上下文过长时请手动清空对话。</span></div>';
    slot.appendChild(card);
  }

  // ─── M1: 网页自定义人物模板卡(#customPrompt) ───
  // 保存逻辑由 app.js 按 ID 接线；settings.js 仅在 openPanel 时回填 LS 值(见 initPanelToggle)。
  function mountPersonaCard() {
    var slot = document.getElementById('setChatSlot');
    if (!slot || document.getElementById('customPrompt')) return;
    var card = document.createElement('div'); card.className = 'card'; card.id = 'personaTemplateCard';
    card.innerHTML = '<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>网页自定义人物模板</h4>'
      + '<p>这段文字会追加到每条对话的 system prompt 末尾（优先级低于角色卡）。适合补充你对 AI 行为的统一要求。<b>仅本设备</b>。</p>'
      + '<textarea id="customPrompt" rows="5" placeholder="输入自定义人物设定或全局指令…" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;resize:vertical;"></textarea>'
      + '<div class="settings-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg><span>上方「记住自定义提示词」开关控制本内容是否实际发送。留空 = 不追加任何内容。</span></div>';
    slot.appendChild(card);
  }

  // ─── 自驱叙事控制卡(autopilot.js 的入口 UI · 决策 O 默认半自动) ───
  // 写 cfw_autopilot_* + cfw_address_mode_v1 + cfw_choices_freq_v1;开始/停止直接调 window.__autopilot。仅本设备。挂 #setChatSlot。
  function mountAutopilotCard() {
    var slot = document.getElementById('setChatSlot');
    if (!slot || document.getElementById('autopilotCard')) return;
    var K = { mode: 'cfw_autopilot_mode_v1', auto: 'cfw_autopilot_auto_v1', maxSeg: 'cfw_autopilot_max_segments_v1', gateTts: 'cfw_autopilot_gate_tts_v1', speed: 'cfw_autopilot_arousal_speed_v1', climax: 'cfw_autopilot_climax_action_v1', address: 'cfw_address_mode_v1', choices: 'cfw_choices_freq_v1' };
    function g(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    var SS = 'flex:1;padding:7px 9px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;';
    var LB = 'font-size:12px;color:var(--muted);min-width:56px;';
    var card = document.createElement('div'); card.className = 'card'; card.id = 'autopilotCard';
    card.innerHTML = '<h4>自驱叙事(Autopilot)</h4>'
      + '<p>让 AI 自己一段段往下演 / 写,不用每次催。<b>半自动</b>每段停下给「继续 / 选项 / 自己写」,<b>全自动</b>按节拍连演。「一句话把活干完」的工作模式不在这,走 Agent。随时 <b>Shift+Esc</b> 全停。<b>仅本设备</b>。</p>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">模式</label><select id="apMode" style="' + SS + '"><option value="">关</option><option value="rp">角色扮演</option><option value="novel">小说叙事</option></select></div>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">推进</label><select id="apAuto" style="' + SS + '"><option value="half">半自动 · 每段停一下</option><option value="full">全自动 · 连续演</option></select></div>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">视角</label><select id="apAddress" style="' + SS + '"><option value="dialogue">对话 · 只对你说话</option><option value="immersive">沉浸 · 带动作旁白</option><option value="narration">小说 · 第三人称</option></select></div>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">选项</label><select id="apChoices" style="' + SS + '"><option value="off">不给选项</option><option value="fork">岔路口才给(默认)</option><option value="every">每段都给</option></select></div>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">升温</label><select id="apSpeed" style="' + SS + '"><option value="slow">慢</option><option value="mid">中(默认)</option><option value="fast">快</option></select><span style="font-size:11px;color:var(--muted);">仅 RP</span></div>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">到高潮</label><select id="apClimax" style="' + SS + '"><option value="afterglow">留余韵(默认)</option><option value="stop">停下</option><option value="wait">等我</option></select><span style="font-size:11px;color:var(--muted);">仅 RP</span></div>'
      + '<div class="rowline" style="align-items:center;gap:10px;"><label style="' + LB + '">最多段</label><input type="number" id="apMaxSeg" min="1" max="1000" style="width:90px;padding:6px 8px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div>'
      + '<div class="rowline"><div class="toggle"><input type="checkbox" id="apGateTts"><label for="apGateTts">读完一段再演下一段(仅桌面 TTS)</label></div></div>'
      + '<div class="rowline"><div></div><div class="btns"><button class="smallbtn" id="apStart" type="button">▶ 开始自驱</button><button class="smallbtn danger" id="apStop" type="button">■ 停止</button></div></div>'
      + '<div id="apStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div>'
      + '<div class="settings-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg><span>半自动暂停时直接在输入框打字发送会自动接管。需 index.html 已引入 autopilot.js。</span></div>';
    slot.appendChild(card);
    function q(id) { return card.querySelector(id); }
    var mode = q('#apMode'), auto = q('#apAuto'), address = q('#apAddress'), choices = q('#apChoices'), speed = q('#apSpeed'), climax = q('#apClimax'), maxSeg = q('#apMaxSeg'), gateTts = q('#apGateTts'), statusEl = q('#apStatus');
    mode.value = g(K.mode, ''); auto.value = g(K.auto, 'half'); address.value = g(K.address, 'dialogue'); choices.value = g(K.choices, 'fork'); speed.value = g(K.speed, 'mid'); climax.value = g(K.climax, 'afterglow'); maxSeg.value = g(K.maxSeg, '12'); gateTts.checked = g(K.gateTts, '0') === '1';
    mode.addEventListener('change', function () { set(K.mode, mode.value); });
    auto.addEventListener('change', function () { set(K.auto, auto.value); });
    address.addEventListener('change', function () { set(K.address, address.value); });
    choices.addEventListener('change', function () { set(K.choices, choices.value); });
    speed.addEventListener('change', function () { set(K.speed, speed.value); });
    climax.addEventListener('change', function () { set(K.climax, climax.value); });
    maxSeg.addEventListener('change', function () { var n = parseInt(maxSeg.value, 10); if (!(n >= 1 && n <= 1000)) { n = 12; maxSeg.value = '12'; } set(K.maxSeg, String(n)); });
    gateTts.addEventListener('change', function () { set(K.gateTts, gateTts.checked ? '1' : '0'); });
    function setMsg(t) { if (statusEl) statusEl.textContent = t || ''; }
    q('#apStart').addEventListener('click', function () {
      if (!window.__autopilot) { setMsg('自驱引擎未加载(检查 index.html 是否引了 autopilot.js)'); return; }
      var r = window.__autopilot.start({ mode: mode.value });
      if (r && r.ok) setMsg('已开始 · ' + (mode.value === 'rp' ? '角色扮演' : '小说') + ' / ' + (auto.value === 'full' ? '全自动' : '半自动'));
      else setMsg('没开起来:' + ((r && r.reason) || '未知'));
    });
    q('#apStop').addEventListener('click', function () { if (window.__autopilot) window.__autopilot.stop('user-stop'); setMsg('已停止'); });
    try { if (window.__autopilot && window.__autopilot.onTick) window.__autopilot.onTick(function (st) { setMsg('状态:' + st.state + ' · 第 ' + st.seg + ' 段' + (st.mode === 'rp' ? ' · 热度 ' + st.arousal : '')); }); } catch (e) {}
  }

  function mountStaticSettingsCards() {
    mountTopbarCostCard();
    mountChatModeCard();
    mountAutopilotCard();
    mountDisplayCard();
    mountLocalHistoryCard(); // M1
    mountPersonaCard();      // M1
    mountByoCard(); // 2026-06-24: 聊天模型自定义直连归「模型 API」分类(原在「对话」)
    mountAuthCard();
    mountSyncCard();
  }

  // ─── 1. 分类标签切换 ───
  const LS_CAT = 'cfw_settings_cat_v1';
  function initCatNav() {
    const nav = document.querySelector('.settings-cat-nav');
    if (!nav) return;
    const items = Array.from(nav.querySelectorAll('.scn-item'));
    const cats  = Array.from(document.querySelectorAll('.set-cat'));
    const devOn = localStorage.getItem('cfw_dev_mode_v1') === '1';
    const isApp = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
    items.forEach(it => {
      if (it.dataset.devOnly && !devOn) it.style.display = 'none';
      if (it.dataset.cat === 'voice' && !isApp) it.style.display = 'none';
    });
    function switchTo(cat) {
      items.forEach(it => it.classList.toggle('active', it.dataset.cat === cat));
      cats.forEach(c  => c.classList.toggle('active',  c.dataset.cat  === cat));
      localStorage.setItem(LS_CAT, cat);
    }
    const saved = localStorage.getItem(LS_CAT);
    const validItem = items.find(it => it.dataset.cat === saved && it.style.display !== 'none');
    const firstVisible = items.find(it => it.style.display !== 'none') || items[0];
    switchTo(validItem ? saved : (firstVisible && firstVisible.dataset.cat || 'account'));
    items.forEach(it => it.addEventListener('click', () => switchTo(it.dataset.cat)));
  }

  // ─── 2. 面板开关 ───
  function initPanelToggle() {
    const settingsBtn    = document.getElementById('settingsBtn');
    const settingsMask   = document.getElementById('settingsMask');
    const closeSettingsBtn = document.getElementById('closeSettings');
    const historyKeepEl  = document.getElementById('historyKeep');
    const promptKeepEl   = document.getElementById('promptKeep');
    const customPromptEl = document.getElementById('customPrompt');
    const LS_HISTORY     = 'cfw_history_enabled';
    const LS_PROMPT      = 'cfw_prompt_enabled';
    const LS_CUSTOM      = 'cfw_custom_prompt_v1';

    function openPanel() {
      if (!settingsMask) return;
      settingsMask.style.display = 'flex';
      mountImageCards();
      mountVoiceCards(); // 4.71
      if (historyKeepEl)  historyKeepEl.checked  = localStorage.getItem(LS_HISTORY) === '1';
      if (promptKeepEl)   promptKeepEl.checked   = (localStorage.getItem(LS_PROMPT) ?? '1') === '1';
      if (customPromptEl) customPromptEl.value   = localStorage.getItem(LS_CUSTOM) || '';
      try { if (window.__settingsRefreshAuth) window.__settingsRefreshAuth(); } catch(e) {}
      try { if (window.__settingsRefreshSync) window.__settingsRefreshSync(); } catch(e) {}
    }

    if (settingsBtn)      settingsBtn.addEventListener('click', openPanel);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => {
      if (settingsMask) settingsMask.style.display = 'none';
    });
    if (settingsMask) settingsMask.addEventListener('click', e => {
      if (e.target === settingsMask) settingsMask.style.display = 'none';
    });
  }

  // ─── 3. 顶栏组件开关 ───
  function initTopbarToggles() {
    const html = document.documentElement;
    const t = document.getElementById('showTopbarCostToggle');
    if (!t) return;
    const on = localStorage.getItem('cfw_show_topbar_cost_v1') !== '0';
    t.checked = on;
    html.classList.toggle('hide-topbar-cost', !on);
    t.addEventListener('change', () => {
      localStorage.setItem('cfw_show_topbar_cost_v1', t.checked ? '1' : '0');
      html.classList.toggle('hide-topbar-cost', !t.checked);
    });
  }

  // ─── 4. 对话个性化 toggles / selects ───
  function initChatToggles() {
    const html = document.documentElement;
    const hideMsgEl = document.getElementById('hideMsgActionsToggle');
    if (hideMsgEl) {
      hideMsgEl.checked = localStorage.getItem('cfw_hide_msg_actions_v1') === '1';
      hideMsgEl.addEventListener('change', () => {
        localStorage.setItem('cfw_hide_msg_actions_v1', hideMsgEl.checked ? '1' : '0');
        html.classList.toggle('hide-msg-actions', hideMsgEl.checked);
      });
    }
    const hideStEl = document.getElementById('hideStatsToggle');
    if (hideStEl) {
      hideStEl.checked = localStorage.getItem('cfw_hide_stats_v1') === '1';
      hideStEl.addEventListener('change', () => {
        localStorage.setItem('cfw_hide_stats_v1', hideStEl.checked ? '1' : '0');
        html.classList.toggle('hide-stats', hideStEl.checked);
      });
    }
    const strictEl = document.getElementById('strictRoleplayToggle');
    if (strictEl) {
      strictEl.checked = (localStorage.getItem('cfw_strict_roleplay_v1') ?? '0') === '1';
      strictEl.addEventListener('change', () => {
        localStorage.setItem('cfw_strict_roleplay_v1', strictEl.checked ? '1' : '0');
      });
    }
    const nsfwRadios = document.querySelectorAll('input[name="cfwNsfwLevel"]');
    if (nsfwRadios.length) {
      const syncNsfwUI = () => {
        const cur = localStorage.getItem('cfw_nsfw_mode_v1') || '0';
        nsfwRadios.forEach(r => { r.checked = r.value === cur; });
      };
      nsfwRadios.forEach(r => {
        r.addEventListener('change', () => {
          if (r.checked) localStorage.setItem('cfw_nsfw_mode_v1', r.value);
        });
      });
      syncNsfwUI();
      // 切到蜜桃/少女主题时 theme.js 会写 cfw_nsfw_mode_v1,这里重刷单选 UI(原 index.html 内联逻辑迁入)
      window.addEventListener('theme:changed', syncNsfwUI);
      const _sb = document.getElementById('settingsBtn');
      if (_sb) _sb.addEventListener('click', syncNsfwUI);
    }
    const replyStyleEl = document.getElementById('replyStyleSel');
    if (replyStyleEl) {
      replyStyleEl.value = localStorage.getItem('cfw_reply_style_v1') || 'default';
      replyStyleEl.addEventListener('change', () => {
        localStorage.setItem('cfw_reply_style_v1', replyStyleEl.value);
      });
    }
    const fontSizeEl = document.getElementById('chatFontSizeRange');
    const fontSizeLb = document.getElementById('chatFontSizeLabel');
    if (fontSizeEl) {
      let fs = parseInt(localStorage.getItem('cfw_chat_font_size_v1') || '13', 10);
      if (!(fs >= 12 && fs <= 22)) fs = 13;
      fontSizeEl.value = String(fs);
      if (fontSizeLb) fontSizeLb.textContent = fs + 'px';
      // range 滑块用 input 事件实时反馈 + 同步 label(原 index.html 显示设置卡内联迁入)
      fontSizeEl.addEventListener('input', () => {
        const v = parseInt(fontSizeEl.value, 10) || 13;
        if (fontSizeLb) fontSizeLb.textContent = v + 'px';
        html.style.setProperty('--chat-font-size', v + 'px');
        localStorage.setItem('cfw_chat_font_size_v1', String(v));
      });
    }
    const fontFamilyEl = document.getElementById('chatFontFamilySel');
    if (fontFamilyEl) {
      fontFamilyEl.value = localStorage.getItem('cfw_chat_font_family_v1') || '';
      fontFamilyEl.addEventListener('change', () => {
        const v = fontFamilyEl.value || '';
        localStorage.setItem('cfw_chat_font_family_v1', v);
        if (v) document.documentElement.style.setProperty('--chat-font-family', v);
        else   document.documentElement.style.removeProperty('--chat-font-family');
      });
    }
  }

  // ─── 5. 同步聊天历史 toggle ───
  function initSyncChatToggle() {
    const t = document.getElementById('syncIncludeChatToggle');
    if (!t) return;
    t.checked = localStorage.getItem('cfw_sync_include_chat_v1') === '1';
    t.addEventListener('change', () => {
      localStorage.setItem('cfw_sync_include_chat_v1', t.checked ? '1' : '0');
    });
  }

  // ─── 6. 清空云端按钮 ───
  function initSyncWipeBtn() {
    const wb = document.getElementById('syncWipeBtn');
    if (!wb) return;
    wb.addEventListener('click', async () => {
      const sync = window.__sync;
      if (!sync || typeof sync.wipeCloud !== 'function') { alert('云同步模块未就绪'); return; }
      const st = (sync.getStatus && sync.getStatus()) || {};
      if (!st.enabled || !st.hasToken) { alert('请先启用云同步(需密码)再清空云端'); return; }
      if (!confirm('确定清空云端的全部数据吗?\n\n· 删除:角色卡/道具/preset/亲密度/费用/对话历史的【云端副本】\n· 保留:本设备本地数据全部不动\n· 注意:同步仍开启时,下次本地改动会把本地重新上传。想让云端保持空,请清空后关闭云同步。')) return;
      const old = wb.textContent; wb.disabled = true; wb.textContent = '清空中…';
      try {
        await sync.wipeCloud();
        wb.textContent = '已清空';
        const s = document.getElementById('syncStatus');
        if (s) s.textContent = '云端已清空 · ' + new Date().toLocaleTimeString();
        setTimeout(() => { wb.textContent = old; wb.disabled = false; }, 2000);
      } catch (e) {
        wb.textContent = old; wb.disabled = false;
        alert('清空云端失败:' + (e && e.message || e));
      }
    });
  }

  // ─── 7. KV 配额告警 + cloudExcludeSection ───
  function initCloudExcludeSection() {
    function wireWarn() {
      if (!window.__sync || !window.__sync.onStatus) { setTimeout(wireWarn, 500); return; }
      window.__sync.onStatus((s, d) => {
        if (s !== 'warn' || !d || d.reason !== 'kv-quota') return;
        const w = document.getElementById('syncQuotaWarn');
        if (w) { w.style.display = 'block'; w.textContent = '今日已 push ' + d.count + ' 次到 KV (免费层 1000/日上限),可点顶栏暂停同步避免超额'; }
      });
    }
    wireWarn();
    const listEl = document.getElementById('cloudExcludeList');
    if (!listEl) return;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function cards() { try { return (window.__character && window.__character.listAllCards) ? (window.__character.listAllCards() || []) : []; } catch(e) { return []; } }
    function slots() { try { const raw = localStorage.getItem('cfw_chat_session_v1'); if (!raw) return []; const m = JSON.parse(raw); return (m && typeof m === 'object' && !Array.isArray(m)) ? Object.keys(m) : []; } catch(e) { return []; } }
    function excluded() { try { return (window.__sync && window.__sync.getExcluded) ? window.__sync.getExcluded() : { roles: [], sessions: [] }; } catch(e) { return { roles: [], sessions: [] }; } }
    function nameOf(id, cs) { if (id === '__none__') return '（未选角色）'; const c = cs.filter(x => x.id === id)[0]; return c ? ((c.icon ? c.icon + ' ' : '') + c.name) : id; }
    function rowHtml(kind, id, label, isEx) {
      const btn = isEx
        ? `<button class="smallbtn" data-act="restore" data-kind="${kind}" data-id="${esc(id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/></svg>恢复同步</button>`
        : `<button class="smallbtn danger" data-act="wipe" data-kind="${kind}" data-id="${esc(id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5h15"/><path d="M9 6.5V5.2A1.7 1.7 0 0 1 10.7 3.5h2.6A1.7 1.7 0 0 1 15 5.2V6.5"/><path d="M6.8 6.5l.7 12.2a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.7-12.2"/></svg>仅清云端</button>`;
      const tag = kind === 'session' ? '会话' : '角色';
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;${isEx ? 'opacity:.65;' : ''}"><span>${isEx ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" style="width:12px;height:12px;vertical-align:-1px;margin-right:3px;opacity:.7"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>' : ''}<b style="color:var(--muted);">[${tag}]</b> ${esc(label)}</span>${btn}</div>`;
    }
    function render() {
      const cs = cards(), ex = excluded(), sl = slots();
      let html = '';
      html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">角色卡</div>';
      if (!cs.length) html += '<div style="font-size:11px;color:var(--muted);">（无角色卡）</div>';
      cs.forEach(c => { html += rowHtml('role', c.id, (c.icon ? c.icon + ' ' : '') + c.name, ex.roles.indexOf(c.id) >= 0); });
      ex.roles.forEach(id => { if (!cs.filter(x => x.id === id)[0]) html += rowHtml('role', id, id + '（本地已无）', true); });
      html += '<div style="font-size:11px;color:var(--muted);margin-top:8px;">对话会话槽</div>';
      if (!sl.length) html += '<div style="font-size:11px;color:var(--muted);">（无本地会话槽）</div>';
      sl.forEach(k => { html += rowHtml('session', k, nameOf(k, cs), ex.sessions.indexOf(k) >= 0); });
      ex.sessions.forEach(k => { if (sl.indexOf(k) < 0) html += rowHtml('session', k, nameOf(k, cs) + '（本地已无）', true); });
      listEl.innerHTML = html;
    }
    listEl.addEventListener('click', async e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const sync = window.__sync;
      if (!sync || !sync.wipeCloudEntity) { alert('云同步模块未就绪'); return; }
      const st = (sync.getStatus && sync.getStatus()) || {};
      if (!st.enabled || !st.hasToken) { alert('请先启用云同步(需密码)'); return; }
      const act = b.getAttribute('data-act'), kind = b.getAttribute('data-kind'), id = b.getAttribute('data-id');
      const old = b.textContent; b.disabled = true; b.textContent = '处理中…';
      try {
        if (act === 'wipe') {
          if (!confirm('确定只把这一' + (kind === 'session' ? '个会话' : '个角色') + '从云端清除吗?\n本地保留,且本设备不再上传它。')) { b.disabled = false; b.textContent = old; return; }
          await sync.wipeCloudEntity(kind, id);
        } else { await sync.restoreCloudEntity(kind, id); }
        render();
      } catch(err) { b.disabled = false; b.textContent = old; alert('操作失败:' + (err && err.message || err)); }
    });
    const sb  = document.getElementById('settingsBtn');
    if (sb)  sb.addEventListener('click', () => setTimeout(render, 50));
    const sec = document.getElementById('cloudExcludeSection');
    if (sec) sec.addEventListener('toggle', () => { if (sec.open) render(); });
  }

  // ─── 8. 云同步 + Auth UI ───
  function setupSyncAuthUI() {
    const syncEnableToggle  = document.getElementById('syncEnableToggle');
    const syncNowBtn        = document.getElementById('syncNowBtn');
    const syncExportBtn     = document.getElementById('syncExportBtn');
    const syncImportBtn     = document.getElementById('syncImportBtn');
    const syncImportFile    = document.getElementById('syncImportFile');
    const syncStatusEl      = document.getElementById('syncStatus');
    const chatProtectToggle = document.getElementById('chatProtectToggle');
    const authLogoutBtn     = document.getElementById('authLogoutBtn');
    const authStatusEl      = document.getElementById('authStatus');
    if (!syncEnableToggle || !chatProtectToggle) return;

    function fmtTime(ms) {
      if (!ms) return '—';
      try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch { return String(ms); }
    }
    function refreshAuthUI() {
      if (!window.__auth) return;
      const hasToken = !!window.__auth.getToken();
      chatProtectToggle.checked = window.__auth.chatProtectOn();
      if (authStatusEl) authStatusEl.textContent = hasToken
        ? '已登录（密码 token 保存在本地）'
        : '未登录（启用聊天保护或云同步时会弹密码框）';
      if (authLogoutBtn) authLogoutBtn.disabled = !hasToken;
    }
    function refreshSyncUI() {
      if (!window.__sync) return;
      const s = window.__sync.getStatus();
      syncEnableToggle.checked = s.enabled;
      const parts = [s.enabled ? '已启用' : '未启用'];
      if (s.lastPush) parts.push('上次推送 ' + fmtTime(s.lastPush));
      if (syncStatusEl) syncStatusEl.textContent = parts.join(' · ');
    }

    window.__settingsRefreshAuth = refreshAuthUI;
    window.__settingsRefreshSync = refreshSyncUI;

    if (window.__sync) {
      window.__sync.onStatus((st, detail) => {
        if (!syncStatusEl) return;
        if (st === 'syncing') syncStatusEl.textContent = '同步中…';
        else if (st === 'synced') {
          const size = detail && detail.size ? ` (${(detail.size / 1024).toFixed(1)}KB)` : '';
          syncStatusEl.textContent = '同步完成 ' + fmtTime(Date.now()) + size;
        } else if (st === 'restored') {
          syncStatusEl.textContent = '已从云端还原，即将刷新页面…';
        } else if (st === 'error') {
          syncStatusEl.textContent = '错误：' + (detail && detail.message || '同步失败');
        }
      });
    }

    syncEnableToggle.addEventListener('change', async () => {
      if (!window.__sync || !window.__auth) return;
      if (syncEnableToggle.checked) {
        if (!window.__auth.getToken()) {
          try {
            const pw = await window.__auth.promptForPassword({
              title: '启用云同步',
              hint: '输入 Cloudflare Secret <code>CHAT_PASSWORD</code> 的值。密码会保存在本地浏览器，下次自动登录。',
            });
            window.__auth.setToken(pw);
          } catch { syncEnableToggle.checked = false; return; }
        }
        window.__sync.setSyncEnabled(true);
        refreshAuthUI(); refreshSyncUI();
        window.__sync.pullOnStartup();
      } else {
        window.__sync.setSyncEnabled(false);
        refreshSyncUI();
      }
    });

    syncNowBtn.addEventListener('click', async () => {
      // 4.75 立即同步反馈修复:原版点了无任何按钮级反馈(只往 #syncStatus 写一行小字),看着像"没反应"。
      // 现加:未登录直接提示 + 按钮态 同步中…/✓ 已同步/同步失败,与"清空云端"按钮一致。
      if (!window.__sync) { alert('云同步模块未就绪'); return; }
      var st = (window.__sync.getStatus && window.__sync.getStatus()) || {};
      if (!st.hasToken) { alert('请先在上方打开「启用云同步」并输入密码,再点立即同步'); return; }
      var _old = syncNowBtn.innerHTML;
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = '同步中…';
      try {
        await window.__sync.pushNow();
        // 4.78: 立即同步同时补推独立通道(pushNow 只推 main blob;聊天走 /sync/chat、角色卡走 /sync/chars,否则手动点立即同步不会立刻推这两类,得等各自 30s 自动推)
        if (window.__sync.pushChatNow)  await window.__sync.pushChatNow();
        if (window.__sync.pushCharsNow) await window.__sync.pushCharsNow();
        syncNowBtn.textContent = '✓ 已同步';
        if (syncStatusEl) syncStatusEl.textContent = '同步完成 · ' + new Date().toLocaleString('zh-CN', { hour12: false });
      } catch (e) {
        syncNowBtn.textContent = '同步失败';
        alert('同步失败: ' + (e && e.message || e));
      } finally {
        setTimeout(function () { syncNowBtn.innerHTML = _old; syncNowBtn.disabled = false; }, 1800);
      }
    });
    if (syncExportBtn) syncExportBtn.addEventListener('click', async () => {
      if (!window.__sync) return;
      try { await window.__sync.exportJSON(); } catch (e) { alert('导出失败: ' + e.message); }
    });
    if (syncImportBtn) syncImportBtn.addEventListener('click', () => { syncImportFile && syncImportFile.click(); });
    if (syncImportFile) syncImportFile.addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!confirm('导入将覆盖本地所有数据（角色卡 / 道具 / 历史 / preset / 费用日志）。确认？')) { syncImportFile.value = ''; return; }
      try {
        await window.__sync.importJSON(file);
        alert('导入成功，即将刷新页面…');
        setTimeout(() => location.reload(), 400);
      } catch (err) { alert('导入失败: ' + err.message); }
      syncImportFile.value = '';
    });

    chatProtectToggle.addEventListener('change', async () => {
      if (!window.__auth) return;
      if (chatProtectToggle.checked) {
        if (!window.__auth.getToken()) {
          try {
            const pw = await window.__auth.promptForPassword({
              title: '启用聊天密码保护',
              hint: '输入 Cloudflare Secret <code>CHAT_PASSWORD</code> 的值。',
            });
            window.__auth.setToken(pw);
          } catch { chatProtectToggle.checked = false; return; }
        }
        window.__auth.setChatProtect(true);
      } else {
        window.__auth.setChatProtect(false);
      }
      refreshAuthUI();
    });

    if (authLogoutBtn) authLogoutBtn.addEventListener('click', () => {
      if (!window.__auth) return;
      if (!confirm('退出登录会清除本地保存的密码 token，并关闭云同步和聊天保护。确认？')) return;
      window.__auth.clearToken();
      window.__auth.setChatProtect(false);
      if (window.__sync) window.__sync.setSyncEnabled(false);
      refreshAuthUI(); refreshSyncUI();
    });
  }

  // ─── 9. 思考过程显示下拉 ───
  function setupThinkDisplaySetting() {
    if (document.getElementById('thinkDisplaySel')) return;
    const historyKeepEl  = document.getElementById('historyKeep');
    const customPromptEl = document.getElementById('customPrompt');
    const anchor = (historyKeepEl && (historyKeepEl.closest('label') || historyKeepEl.parentElement)) || null;
    const host   = (anchor && anchor.parentNode) || (customPromptEl && customPromptEl.parentNode);
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.className = 'setting-row think-display-row';
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0;font-size:14px;';
    const label = document.createElement('span');
    label.textContent = '思考过程显示';
    label.title = '解限/思考模式下模型产生的思考内容如何呈现';
    const sel = document.createElement('select');
    sel.id = 'thinkDisplaySel';
    sel.style.cssText = 'padding:4px 8px;border-radius:6px;';
    [['collapse', '折叠(默认)'], ['show', '展开'], ['hide', '隐藏']].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      sel.appendChild(o);
    });
    function getVal() {
      const v = localStorage.getItem('cfw_think_display_v1');
      return (v === 'show' || v === 'hide') ? v : 'collapse';
    }
    sel.value = getVal();
    sel.addEventListener('change', () => {
      localStorage.setItem('cfw_think_display_v1', sel.value);
      if (window.__app && window.__app.applyAllThinkDisplay) {
        window.__app.applyAllThinkDisplay();
      } else {
        document.querySelectorAll('.reasoning-block').forEach(el => {
          try { if (window.__app && window.__app.applyThinkDisplay) window.__app.applyThinkDisplay(el); } catch(e) {}
        });
      }
    });
    wrap.appendChild(label);
    wrap.appendChild(sel);
    if (anchor && anchor.parentNode === host) host.insertBefore(wrap, anchor.nextSibling);
    else host.appendChild(wrap);
  }

  // ─── 10. 图像模块设置卡挂载 ───
  function getSlot() {
    return document.getElementById('settingsImageSlot') || document.getElementById('settings');
  }
  // 4.71: 语音 tab slot
  function getVoiceSlot() {
    return document.getElementById('settingsVoiceSlot') || null;
  }
  var _imgCardsMounted = false;
  function mountImageCards() {
    if (_imgCardsMounted) return;
    if (!getSlot()) return;
    mountImgStyleCard();
    mountImgKeyCard();
    mountImgQuotaCard();
    mountImgExpanderCard();
    // ── 角色立绘 ──
    (function(){
      var s=getSlot(); if(s&&!document.getElementById('imgSecTitle1')){
        var d=document.createElement('div'); d.id='imgSecTitle1';
        d.style.cssText='font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.06em;padding:14px 0 4px;border-top:1px solid rgba(127,127,127,.12);margin-top:4px;';
        d.textContent='角色立绘'; s.appendChild(d);
      }
    })();
    mountImgPortraitCard();
    // ── 画廊·缓存 ──
    (function(){
      var s=getSlot(); if(s&&!document.getElementById('imgSecTitle2')){
        var d=document.createElement('div'); d.id='imgSecTitle2';
        d.style.cssText='font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.06em;padding:14px 0 4px;border-top:1px solid rgba(127,127,127,.12);margin-top:4px;';
        d.textContent='画廊·缓存'; s.appendChild(d);
      }
    })();
    mountImgAlbumCard();
    mountImgCacheCard();
    _imgCardsMounted = true;
  }
  // 4.71: 语音 tab 挂载
  var _voiceCardsMounted = false;
  function mountVoiceCards() {
    if (_voiceCardsMounted) return;
    if (!getVoiceSlot()) return;
    mountTtsCard();
    _voiceCardsMounted = true;
  }
  var _SL = [['none','默认 · 不指定'],['real','写实'],['anime','动漫 · 现代日系'],['soft','日系厚涂'],['webtoon','韩漫 · 网漫'],['uscomic','美漫 · 美式'],['gufeng','中式 · 国风'],['fantasy','欧美奇幻厚涂'],['oil','古典油画'],['water','水彩'],['render3d','3D · 皮克斯渲染'],['chibi','Q版 · 萌系'],['inkmanga','黑白漫画'],['cyber','赛博朋克']];
  function styleOpts(){return _SL.map(function(p){return'<option value="'+p[0]+'">'+p[1]+'</option>';}).join('');}

  function mountImgStyleCard() {
    var slot=getSlot(); if(!slot||document.getElementById('imgStyleCard'))return;
    var pt=window.__portrait; if(!pt)return;
    var card=document.createElement('div'); card.className='card'; card.id='imgStyleCard';
    card.innerHTML='<h4>全局画风（全站出图生效）</h4><p>统一控制<b>所有自动出图</b>的画风，工坊手动文生图不受影响，仅本设备。</p><div class="rowline" style="align-items:center;gap:10px;margin-top:6px;"><label style="font-size:12px;opacity:.6;">画风</label><select id="imgStyleSelect" style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;">'+styleOpts()+'</select></div>';
    if(slot.firstChild)slot.insertBefore(card,slot.firstChild); else slot.appendChild(card);
    var sel=document.getElementById('imgStyleSelect');
    if(sel){sel.value=pt.getStyle();sel.addEventListener('change',function(){pt.setStyle(sel.value);});window.addEventListener('imagestyle:changed',function(e){var v=(e&&e.detail&&e.detail.style)||pt.getStyle();if(sel.value!==v)sel.value=v;});}
  }

  function mountImgKeyCard() {
    // 2026-06-24: 图像 API Key 归「模型 API」分类(setModelApiSlot),原在「发图」settingsImageSlot
    var slot=document.getElementById('setModelApiSlot')||getSlot(); if(!slot||document.getElementById('imgKeyCard'))return;
    var K='cfw_image_key_v1';
    var card=document.createElement('div'); card.className='card'; card.id='imgKeyCard';
    card.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>图像 API Key（Gitee）</h4><p>图像工坊（生图/改图）调用 <code>ai.gitee.com</code>，需要单独的 Gitee API Key（LS <code>cfw_image_key_v1</code>），不进云同步。</p><div class="rowline"><input type="password" id="imgKeyInput" placeholder="Bearer Token" style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div><div class="rowline" style="margin-top:8px;"><div></div><div class="btns"><button class="smallbtn" id="imgKeySave">保存</button><button class="smallbtn danger" id="imgKeyClear">清除</button></div></div><div id="imgKeyStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div>';
    slot.appendChild(card);
    var inp=document.getElementById('imgKeyInput'),sts=document.getElementById('imgKeyStatus');
    try{inp.value=localStorage.getItem(K)||'';}catch(e){}
    function setMsg(){try{sts.textContent=localStorage.getItem(K)?'已保存 Key':'未设置 Key';}catch(e){}}
    setMsg();
    document.getElementById('imgKeySave').addEventListener('click',function(){try{localStorage.setItem(K,(inp.value||'').trim());}catch(e){}setMsg();});
    document.getElementById('imgKeyClear').addEventListener('click',function(){try{localStorage.removeItem(K);}catch(e){}inp.value='';setMsg();});
  }

  function mountImgQuotaCard() {
    var slot=getSlot(); if(!slot||document.getElementById('imgQuotaCard'))return;
    var q=window.__imageQuota; if(!q)return;
    var card=document.createElement('div'); card.className='card'; card.id='imgQuotaCard';
    card.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 16v-4M12 16V8M17 16v-6"/></svg>图像额度计数（每日）</h4><p>Gitee 免费图像额度每天约 <b>100 次</b>。本站发图成功时按图片张数累加，<b>仅本设备本地统计</b>。</p><div id="imgQuotaDisplay" style="margin:6px 0 8px;"></div><div style="height:6px;border-radius:4px;background:rgba(127,127,127,.2);overflow:hidden;margin-bottom:12px;"><div id="imgQuotaBar" style="height:100%;width:0;transition:width .25s;"></div></div><div class="rowline" style="align-items:center;gap:10px;"><label style="font-size:12px;color:var(--muted);">每日额度</label><input type="number" id="imgQuotaLimit" min="1" max="9999" style="width:90px;padding:5px 8px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;"><div class="btns"><button class="smallbtn" id="imgQuotaMinus">-1</button><button class="smallbtn" id="imgQuotaPlus">+1</button><button class="smallbtn danger" id="imgQuotaReset">今日归零</button></div></div>';
    slot.appendChild(card);
    var lim=document.getElementById('imgQuotaLimit'); if(lim)lim.addEventListener('change',function(){q.setLimit(lim.value);});
    var qp=document.getElementById('imgQuotaPlus'); if(qp)qp.addEventListener('click',function(){q.add(1);});
    var qm=document.getElementById('imgQuotaMinus'); if(qm)qm.addEventListener('click',function(){q.add(-1);});
    var qr=document.getElementById('imgQuotaReset'); if(qr)qr.addEventListener('click',function(){q.reset();});
    if(q.renderCard)q.renderCard();
  }

  function mountImgPortraitCard(){
    var slot=getSlot(); if(!slot||document.getElementById('imgPortraitCard'))return;
    var pt=window.__portrait; if(!pt)return;
    var opts=_SL.map(function(p){return'<option value="'+p[0]+'">'+p[1]+'</option>';}).join('');
    var card=document.createElement('div'); card.className='card'; card.id='imgPortraitCard';
    card.innerHTML='<h4>角色立绘 → 发图基准图</h4><p>用当前选中<b>角色卡</b>自动拼提示词，z-image 出一张半身立绘，一键设为<b>微信发图基准图</b>。消耗 1 次图像额度，<b>仅本设备</b>。</p><div id="imgPortraitWho" style="font-size:13px;margin:4px 0;"></div><div class="rowline" style="align-items:center;gap:10px;margin-top:8px;"><label style="font-size:12px;opacity:.6;">画风</label><select id="imgPortraitStyle" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;">'+opts+'</select></div><div class="rowline" style="margin-top:10px;"><div></div><div class="btns"><button class="smallbtn" id="imgPortraitGen">生成立绘</button><button class="smallbtn" id="imgPortraitSet" disabled>设为基准图</button><button class="smallbtn danger" id="imgPortraitClear">清除基准图</button></div></div><div id="imgPortraitStatus" style="font-size:11px;opacity:.6;margin-top:8px;"></div><div id="imgPortraitPreview" style="margin-top:10px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;"></div>';
    slot.appendChild(card);
    var sel=document.getElementById('imgPortraitStyle'),genBtn=document.getElementById('imgPortraitGen'),setBtn=document.getElementById('imgPortraitSet'),delBtn=document.getElementById('imgPortraitClear'),status=document.getElementById('imgPortraitStatus'),preview=document.getElementById('imgPortraitPreview');
    if(sel){sel.value=pt.getStyle();sel.addEventListener('change',function(){pt.setStyle(sel.value);});window.addEventListener('imagestyle:changed',function(e){var v=(e&&e.detail&&e.detail.style)||pt.getStyle();if(sel.value!==v)sel.value=v;});}
    function setMsg(t){if(status)status.textContent=t||'';}
    function activeCard(){try{return window.__character&&window.__character.getActiveCard&&window.__character.getActiveCard();}catch(e){return null;}}
    function refreshWho(){var who=document.getElementById('imgPortraitWho'),c=activeCard();if(who)who.innerHTML=c?'当前角色：<b>'+((c.icon?c.icon+' ':'')+(c.name||'(未命名)'))+'</b>':'<span style="color:#e5484d;">未选择角色卡 — 先去左侧「角色卡」选一个</span>';try{if(window.__chatImage&&window.__chatImage.getBaseImage&&c){Promise.resolve(window.__chatImage.getBaseImage({characterId:c.id||'default'})).then(function(b){if(b&&preview&&!preview.querySelector('[data-gen]'))preview.innerHTML='<div style="text-align:center;"><img src="'+b+'" style="max-width:140px;border-radius:8px;display:block;"><div style="font-size:11px;opacity:.6;margin-top:4px;">当前基准图</div></div>';}).catch(function(){});}}catch(e){}}
    if(genBtn)genBtn.addEventListener('click',async function(){genBtn.disabled=true;setMsg('生成中…（约 10-30 秒）');try{var r=await pt.generateForActive();if(preview)preview.innerHTML='<div style="text-align:center;"><img data-gen="1" src="'+r.url+'" style="max-width:160px;border-radius:8px;display:block;"><div style="font-size:11px;opacity:.6;margin-top:4px;">新立绘 · '+(r.name||'')+'</div></div>';if(setBtn)setBtn.disabled=false;setMsg('生成完成，点「设为基准图」锁定。');}catch(e){setMsg('错误：'+((e&&e.message)||e));}genBtn.disabled=false;});
    if(setBtn)setBtn.addEventListener('click',async function(){setBtn.disabled=true;setMsg('保存基准图中…');try{await pt.setAsBase();setMsg('已设为当前角色的发图基准图。');}catch(e){setMsg('错误：'+((e&&e.message)||e));setBtn.disabled=false;}});
    if(delBtn)delBtn.addEventListener('click',async function(){if(!(window.__chatImage&&window.__chatImage.clearBaseImage)){setMsg('发图模块未就绪');return;}if(!confirm('清除当前角色的发图基准图？'))return;var c=activeCard();delBtn.disabled=true;setMsg('清除中…');try{await window.__chatImage.clearBaseImage({characterId:(c&&c.id)||'default'});if(preview)preview.innerHTML='';if(setBtn)setBtn.disabled=true;setMsg('已清除。');}catch(e){setMsg('错误：'+((e&&e.message)||e));}delBtn.disabled=false;});
    refreshWho(); window.addEventListener('character:changed',refreshWho);
  }

  function mountImgCacheCard(){
    var slot=getSlot(); if(!slot||document.getElementById('imgCacheCard'))return;
    var cache=window.__imageCache; if(!cache)return;
    var card=document.createElement('div'); card.className='card'; card.id='imgCacheCard';
    card.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>提示词缓存去重</h4><p>相同提示词在短期内再次生成时，直接复用上次的图，<b>不再消耗当日额度</b>。仅文生图，缓存 6 小时，<b>仅本设备</b>。</p><label class="rowline" style="align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="imgCacheToggle"><span>启用缓存去重</span></label><div id="imgCacheStats" style="font-size:12px;opacity:.75;margin-top:8px;"></div><div class="rowline" style="margin-top:8px;"><div></div><div class="btns"><button class="smallbtn danger" id="imgCacheClear">清空缓存</button></div></div>';
    slot.appendChild(card);
    var tog=document.getElementById('imgCacheToggle'),clr=document.getElementById('imgCacheClear'),st=document.getElementById('imgCacheStats');
    function refresh(){if(tog)tog.checked=cache.isEnabled();if(st){var s=cache.stats();st.textContent='已缓存 '+s.count+' 条 · 累计省下 '+s.saved+' 次生成';}}
    if(tog)tog.addEventListener('change',function(){cache.setEnabled(tog.checked);});
    if(clr)clr.addEventListener('click',function(){cache.clear();});
    window.addEventListener('imagecache:changed',refresh); refresh();
  }

  // 4.72 §十.A: 发图扩写器模型选择(LS cfw_expander_model_v1;留空=自动选 gpt-oss)
  function mountImgExpanderCard(){
    var slot=getSlot(); if(!slot||document.getElementById('imgExpanderCard'))return;
    var K='cfw_expander_model_v1';
    var list=[]; try{list=window.APP_MODELS_FREE||[];}catch(e){}
    var opts='<option value="">默认 · 自动选 gpt-oss-120b</option>';
    for(var i=0;i<list.length;i++){var id=(list[i]&&list[i].id)||'';if(!id)continue;var nm=(list[i].name||id);opts+='<option value="'+id+'">'+nm+'</option>';}
    var card=document.createElement('div'); card.className='card'; card.id='imgExpanderCard';
    card.innerHTML='<h4>发图扩写器模型</h4><p>非限制级发图时，用这个免费模型把中文发图信号扩写成英文画面描述；限制级(≥1)走本地模板、不调此模型。留「默认」即自动选 gpt-oss-120b。<b>仅本设备</b>。</p><div class="rowline" style="align-items:center;gap:10px;margin-top:6px;"><label style="font-size:12px;opacity:.6;">扩写模型</label><select id="imgExpanderSelect" style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;">'+opts+'</select></div>';
    slot.appendChild(card);
    var sel=document.getElementById('imgExpanderSelect');
    if(sel){try{sel.value=localStorage.getItem(K)||'';}catch(e){}sel.addEventListener('change',function(){try{if(sel.value)localStorage.setItem(K,sel.value);else localStorage.removeItem(K);}catch(e){}});}
  }

  function mountImgAlbumCard(){
    var slot=getSlot(); if(!slot||document.getElementById('imgAlbumCard'))return;
    var album=window.__album; if(!album)return;
    var card=document.createElement('div'); card.className='card'; card.id='imgAlbumCard';
    card.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M4 17.5l5-5 3.2 3.2 3.2-3.8 4.1 5"/></svg>本地画廊</h4><p>工坊/立绘/发图生成的图会自动收进本地相册（浏览器 IndexedDB，最多 60 张）。每张可一键：设为基准图 / 插入对话 / 再改一张 / 下载 / 删除，<b>仅本设备</b>。</p><div id="imgAlbumStat" style="font-size:12px;opacity:.75;margin:6px 0;"></div><div class="rowline"><div></div><div class="btns"><button class="smallbtn" id="imgAlbumOpen">打开画廊</button><button class="smallbtn danger" id="imgAlbumClear">清空</button></div></div>';
    slot.appendChild(card);
    var stat=document.getElementById('imgAlbumStat');
    function refresh(){album.list().then(function(a){if(stat)stat.textContent='已收藏 '+a.length+' 张';});}
    var ob=document.getElementById('imgAlbumOpen'); if(ob)ob.addEventListener('click',function(){album.open();});
    var cb=document.getElementById('imgAlbumClear'); if(cb)cb.addEventListener('click',function(){if(confirm('清空本地画廊？'))album.clear();});
    window.addEventListener('imagealbum:changed',refresh); refresh();
  }

  function mountTtsCard(){
    if(!window.__TAURI__)return;
    var slot=getVoiceSlot(); if(!slot||document.getElementById('omniTtsCard'))return; // 语音 slot(本地 GPT-SoVITS 是本机服务、非外接 API,留「语音」tab)
    var tts=window.__omniTTS; if(!tts)return;
    var c=tts.cfg();
    var LR='cfw_tts_ref_audio_v1',LP='cfw_tts_prompt_text_v1',LA='cfw_tts_autoplay_v1';
    function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
    var card=document.createElement('div'); card.className='card'; card.id='omniTtsCard';
    card.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>本地语音 (TTS · 仅桌面版)</h4><p>用本机 GPT-SoVITS 把 AI 回复读出来。先在托盘「语音·启动服务」，再填参考音频。<b>仅本设备</b>。</p><div style="margin-top:8px;"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">参考音频完整路径 (.wav)</label><input id="omniTtsRef" type="text" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div><div style="margin-top:10px;"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">参考音频对应文字 (可留空)</label><input id="omniTtsPrompt" type="text" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div><div class="rowline" style="margin-top:10px;"><div class="toggle"><input type="checkbox" id="omniTtsAuto"><label for="omniTtsAuto">自动朗读每条 AI 回复(默认关)</label></div><div class="btns"><button class="smallbtn" id="omniTtsTest" type="button">▶ 试听</button></div></div><div class="rowline" style="margin-top:10px;align-items:center;gap:10px;"><div style="font-size:12px;color:var(--muted);flex:1;">情绪音库 · 按句首 [情绪:强度] 逐句切参考音(开心/愤怒/呻吟…不同音色),没填的自动回落默认音</div><div class="btns"><button class="smallbtn" id="omniTtsEmoMgr" type="button">管理情绪音库 →</button></div></div><div id="omniTtsStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div>';
    slot.appendChild(card);
    var refEl=card.querySelector('#omniTtsRef'),promptEl=card.querySelector('#omniTtsPrompt'),autoEl=card.querySelector('#omniTtsAuto');
    refEl.value=c.refAudioPath; promptEl.value=c.promptText; autoEl.checked=c.autoplay;
    function renderStatus(){
      var s=card.querySelector('#omniTtsStatus'); if(!s)return;
      var cc=tts.cfg();
      if(cc.serviceRunning===null){s.textContent='';return;}
      s.textContent=cc.serviceRunning?('✓ 语音服务运行中 · 端口 '+cc.port+(cc.ttsDir?' · '+cc.ttsDir:'')):'● 语音服务未启动 — 先在托盘点「语音·启动服务」';}
    renderStatus();
    refEl.addEventListener('change',function(){lsSet(LR,refEl.value.trim());});
    promptEl.addEventListener('change',function(){lsSet(LP,promptEl.value.trim());});
    autoEl.addEventListener('change',function(){lsSet(LA,autoEl.checked?'1':'0');});
    card.querySelector('#omniTtsTest').addEventListener('click',async function(){
      lsSet(LR,refEl.value.trim()); lsSet(LP,promptEl.value.trim());
      await tts.refreshNativeCfg(); renderStatus();
      tts.stop(); tts.speak('你好呀，现在能听到我说话了吗？');
    });
    var emoBtn=card.querySelector('#omniTtsEmoMgr');
    if(emoBtn)emoBtn.addEventListener('click',function(){if(window.__unlimitedEditor&&window.__unlimitedEditor.open)window.__unlimitedEditor.open('voice');else alert('解限编辑器未加载(检查 index.html 是否引了 unlimited-editor.js)');});
  }

  // ─── §模型API. 聊天模型自定义直连配置卡 ───
  // endpoint/model/key 存 LS cfw_byo_provider_v1(JSON);消费方读 window.__byoProvider.get()。
  function mountByoCard() {
    // 2026-06-24: 归「模型 API」分类(setModelApiSlot)——外接模型 API 统一入口,原在「对话」tab(setChatSlot)
    var slot = document.getElementById('setModelApiSlot') || document.getElementById('settings');
    if (!slot || document.getElementById('byoProviderCard')) return;
    var K = 'cfw_byo_provider_v1';
    function read() { try { var o = JSON.parse(localStorage.getItem(K) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    var cur = read();
    var card = document.createElement('div'); card.className = 'card'; card.id = 'byoProviderCard';
    card.innerHTML = '<h4>聊天模型 · 自定义直连</h4><p>填自带的 OpenAI 兼容端点(GPT/Qwen/GLM/Kimi/本地 vLLM 等)。填了就<b>跳过内置白名单</b>直连该端点;<b>留空则用内置 free/fast 模型</b>。自定义模型仍吃解限底座。Key <b>仅存本设备</b>、不进云同步。</p>'
      + '<div style="margin-top:8px;"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Endpoint(/v1/chat/completions 全路径)</label><input id="byoEndpoint" type="text" placeholder="https://api.openai.com/v1/chat/completions" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div>'
      + '<div style="margin-top:10px;"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">模型名(model)</label><input id="byoModel" type="text" placeholder="gpt-4o / qwen-max / glm-4-plus ..." style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div>'
      + '<div style="margin-top:10px;"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">API Key(本地 vLLM/ollama 可留空)</label><input id="byoKey" type="password" placeholder="Bearer Token" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;"></div>'
      + '<div class="rowline" style="margin-top:10px;align-items:center;gap:10px;"><label class="toggle" style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" id="byoThinking"><span>该模型支持思考(thinking,会补 reasoning 历史)</span></label></div>'
      + '<div class="rowline" style="margin-top:10px;"><div></div><div class="btns"><button class="smallbtn" id="byoSave">保存</button><button class="smallbtn danger" id="byoClear">清除·回内置</button></div></div>'
      + '<div id="byoStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div>';
    slot.appendChild(card);
    var ep = document.getElementById('byoEndpoint'), md = document.getElementById('byoModel'), ky = document.getElementById('byoKey'), tk = document.getElementById('byoThinking'), sts = document.getElementById('byoStatus');
    ep.value = cur.endpoint || ''; md.value = cur.model || ''; ky.value = cur.apiKey || ''; tk.checked = cur.supportsThinking === true;
    function setMsg() { var o = read(); sts.textContent = (o.endpoint && o.model) ? ('● 已启用自定义直连 · ' + o.model) : '○ 未配置 · 当前用内置 free/fast 模型'; }
    setMsg();
    document.getElementById('byoSave').addEventListener('click', function () {
      var o = { endpoint: (ep.value || '').trim(), model: (md.value || '').trim(), apiKey: (ky.value || '').trim(), supportsThinking: !!tk.checked, needsReasoningHistory: !!tk.checked };
      if (o.endpoint && !o.model) { alert('填了 Endpoint 就必须填模型名'); return; }
      if (!o.endpoint && !o.model) { try { localStorage.removeItem(K); } catch (e) {} setMsg(); return; }
      try { localStorage.setItem(K, JSON.stringify(o)); } catch (e) {}
      setMsg();
    });
    document.getElementById('byoClear').addEventListener('click', function () { try { localStorage.removeItem(K); } catch (e) {} ep.value = ''; md.value = ''; ky.value = ''; tk.checked = false; setMsg(); });
  }

  // ─── init ───
  function init() {
    mountStaticSettingsCards();
    initCatNav();
    initPanelToggle();
    initTopbarToggles();
    initChatToggles();
    initSyncChatToggle();
    initSyncWipeBtn();
    initCloudExcludeSection();
    setupSyncAuthUI();
    setupThinkDisplaySetting();
    window.addEventListener('load', mountImageCards);
    window.addEventListener('load', mountVoiceCards); // 4.71
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();