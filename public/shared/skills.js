// public/shared/skills.js
// Skill 系统 v1（MVP）— 纯 Markdown SKILL.md 加载器
// 设计依据：「Skill 系统接入交接文档（新对话执行）」§五 MVP 七步 + §八 四决策（已拍板）
//
// 决策落地（§八）：
//   ① 注入位置 → 复用 worker 的 extraSystemPrompts 槽：前端把启用的 skill 正文并进
//      /api/chat 的 payload.extraSystemPrompts（app.js 两处 send 路径各 + 一项），worker.js 零改动。
//      worker 端 extraSystemPrompts 拼在 staticParts，位于 replyStyle 之后、世界书/状态之前；
//      优先级低于解限底座 PROMPT_1/2/3 与 META_IDENTITY（绝不改动它们，skill 仅为追加的额外系统块）。
//   ② 存储 → 新开命名空间 cfw_skills_v1（仿 cfw_prompt_presets_v1 结构）。
//   ③ 作用域 → 全局（仿预设：每条 skill 各自 enabled，对所有对话生效）+ 一个总开关方便整体启停。
//   ④ references 多文件 → 存下但 MVP 只注入正文；卡片标「含 N 个 reference · 未注入」（P2 再做渐进披露）。
//
// 本轮边界（§七）：不做 scripts 执行、不做自动路由、不碰 MCP。
// 安全：社区 skill 视为不可信（可能含 prompt-injection）。导入默认 enabled=false，需用户手动开启。
//
// 暴露：window.__skills = { getEnabledPrompt, list, getAll, save, remove, setEnabled,
//                          setGlobalEnabled, isGlobalEnabled, importFromText, importFromUrl, parseSkillMd }
// 位置：本文件属 public/shared/（全局能力层 SDK，与「壳」解耦），随 /shared/ 组在 app.js 之后加载（getEnabledPrompt 在 send 时才被调用）。
// 跨侧：mountCard 仅在存在 #setSkillSlot（文本侧设置·「技能」分类）时挂卡；其他壳/页面自动跳过、只暴露 window.__skills（仿 shared/tts.js 在网页端的静默降级）。
(() => {
  const LS_SKILLS = "cfw_skills_v1";            // 仿 cfw_prompt_presets_v1（数组）
  const LS_SKILLS_ON = "cfw_skills_enabled_v1"; // 总开关（默认开；仅 "0" 视为关）

  // ─── 存储读写 ───
  function getAll() {
    try {
      const raw = localStorage.getItem(LS_SKILLS);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveAll(arr) {
    try { localStorage.setItem(LS_SKILLS, JSON.stringify(Array.isArray(arr) ? arr : [])); } catch {}
  }
  function isGlobalEnabled() { return (localStorage.getItem(LS_SKILLS_ON) ?? "1") !== "0"; }
  function setGlobalEnabled(on) { try { localStorage.setItem(LS_SKILLS_ON, on ? "1" : "0"); } catch {} renderList(); }
  function uid() { return "sk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ─── 注入：仿 app.js getExtraSystemPrompts（filter enabled → sort order → join 正文）───
  // 返回字符串；前端把它接到 payload.extraSystemPrompts 尾部。空则返回 ""，零副作用。
  function getEnabledPrompt() {
    try {
      if (!isGlobalEnabled()) return "";
      const arr = getAll()
        .filter(s => s && s.enabled && typeof s.content === "string" && s.content.trim())
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (!arr.length) return "";
      const blocks = arr.map(s => "【技能 · " + String(s.name || "未命名技能").trim() + "】\n" + s.content.trim());
      // 整体作为一个额外系统块，前置分隔符与 worker staticParts 风格一致
      return "\n\n" + blocks.join("\n\n");
    } catch { return ""; }
  }

  // ─── YAML frontmatter 解析（轻量，不引外部库）───
  // 支持标准 SKILL.md：--- frontmatter --- + body。frontmatter 取 name / description / references。
  // references 支持「行内逗号串」或「下方 - 列表」。无 frontmatter 时取首个 # 标题作 name，全文为正文。
  function stripQuotes(s) {
    s = String(s == null ? "" : s).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    return s;
  }
  function parseSkillMd(text) {
    const src = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let name = "", description = "", references = [], body = src.trim();
    const fm = src.match(/^\uFEFF?---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fm) {
      const meta = fm[1];
      body = (fm[2] || "").trim();
      let curKey = null;
      for (const ln of meta.split("\n")) {
        const listM = ln.match(/^\s*-\s+(.*)$/);
        if (listM && curKey === "references") { const v = stripQuotes(listM[1].trim()); if (v) references.push(v); continue; }
        const kv = ln.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!kv) continue;
        const key = kv[1].toLowerCase();
        const val = kv[2].trim();
        curKey = key;
        if (key === "name") name = stripQuotes(val);
        else if (key === "description") description = stripQuotes(val);
        else if (key === "references" || key === "resources") {
          if (val) references = val.split(",").map(x => stripQuotes(x.trim())).filter(Boolean);
        }
      }
    }
    if (!name) { const h = body.match(/^#\s+(.+)$/m); if (h) name = h[1].trim(); }
    if (!name) name = "未命名技能";
    return { name, description, references, content: body };
  }

  // ─── 导入 / CRUD ───
  // 安全默认 enabled=false：社区 skill 不可信，导入后需用户手动开启（先阅读正文）。
  function importFromText(text, source) {
    const parsed = parseSkillMd(text);
    if (!parsed.content && !parsed.name) throw new Error("解析为空：不是有效的 SKILL.md");
    const arr = getAll();
    const order = arr.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1;
    const skill = {
      id: uid(),
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      references: parsed.references || [],
      enabled: false,
      order,
      source: source || "import",
      createdAt: Date.now(),
    };
    arr.push(skill);
    saveAll(arr);
    return skill;
  }
  async function importFromUrl(url) {
    const u = String(url || "").trim();
    if (!u) throw new Error("请填链接");
    if (!/^https?:\/\//i.test(u)) throw new Error("链接需以 http(s):// 开头");
    const r = await fetch(u);
    if (!r.ok) throw new Error("拉取失败: " + r.status);
    const text = await r.text();
    return importFromText(text, u);
  }
  function save(skill) {
    if (!skill || !skill.id) return;
    const arr = getAll();
    const i = arr.findIndex(s => s && s.id === skill.id);
    if (i >= 0) arr[i] = Object.assign({}, arr[i], skill);
    else arr.push(skill);
    saveAll(arr);
  }
  function remove(id) { saveAll(getAll().filter(s => s && s.id !== id)); }
  function setEnabled(id, on) {
    const arr = getAll();
    const s = arr.find(x => x && x.id === id);
    if (s) { s.enabled = !!on; saveAll(arr); }
  }
  function list() { return getAll(); }

  // ─── 起始技能库：从 public/starter-skills.json 拉取（替代旧的硬编码单一示例，提高自由度）───
  // 库文件是若干条标准 SKILL.md；导入复用 importFromText → 默认 enabled=false，需手动开启。
  const STARTER_SKILLS_URL = "/presets/starter-skills.json";
  async function importStarterLibrary() {
    const r = await fetch(STARTER_SKILLS_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("拉取起始技能库失败: " + r.status);
    const data = await r.json();
    const skills = Array.isArray(data) ? data : (data && Array.isArray(data.skills) ? data.skills : []);
    if (!skills.length) throw new Error("起始技能库为空");
    const existing = new Set(getAll().map(s => (s.name || "").trim()));
    let added = 0;
    for (const item of skills) {
      const text = typeof item === "string" ? item : (item && item.content) || "";
      if (!text.trim()) continue;
      const parsed = parseSkillMd(text);
      if (existing.has((parsed.name || "").trim())) continue; // 同名去重
      importFromText(text, "starter-library");
      existing.add((parsed.name || "").trim());
      added++;
    }
    return added;
  }

  // ─── 设置卡（仿 settings.js mount*Card 模式，挂 #setSkillSlot · 独立「技能」分类）───
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function renderList() {
    const el = document.getElementById("skillList");
    const gt = document.getElementById("skillGlobalToggle");
    if (gt) gt.checked = isGlobalEnabled();
    if (!el) return;
    const arr = getAll().slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!arr.length) { el.innerHTML = '<div style="font-size:11px;color:var(--muted);">（还没有导入技能）</div>'; return; }
    el.innerHTML = arr.map(function (s) {
      const refN = (s.references && s.references.length) || 0;
      const badge = refN ? '<span style="font-size:10px;color:var(--muted);border:1px solid var(--border,#333);border-radius:4px;padding:1px 5px;margin-left:6px;">含 ' + refN + ' 个 reference · 未注入</span>' : '';
      const desc = s.description ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + esc(s.description) + '</div>' : '';
      return '<div style="border:1px solid var(--border,#333);border-radius:8px;padding:8px 10px;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
        + '<div style="min-width:0;"><b style="font-size:13px;">' + esc(s.name) + '</b>' + badge + desc + '</div>'
        + '<div class="btns" style="flex:none;align-items:center;">'
        + '<label class="toggle" style="margin:0;"><input type="checkbox" data-act="toggle" data-id="' + esc(s.id) + '" ' + (s.enabled ? 'checked' : '') + '></label>'
        + '<button class="smallbtn danger" data-act="del" data-id="' + esc(s.id) + '">删除</button>'
        + '</div></div></div>';
    }).join("");
  }

  function wireCard(card) {
    const status = card.querySelector("#skillImportStatus");
    function setMsg(t) { if (status) status.textContent = t || ""; }

    const gt = card.querySelector("#skillGlobalToggle");
    if (gt) { gt.checked = isGlobalEnabled(); gt.addEventListener("change", function () { setGlobalEnabled(gt.checked); }); }

    const listEl = card.querySelector("#skillList");
    if (listEl) {
      listEl.addEventListener("change", function (e) { const t = e.target.closest('input[data-act="toggle"]'); if (!t) return; setEnabled(t.getAttribute("data-id"), t.checked); });
      listEl.addEventListener("click", function (e) { const b = e.target.closest('button[data-act="del"]'); if (!b) return; if (!confirm("删除这条技能？")) return; remove(b.getAttribute("data-id")); renderList(); });
    }

    const pasteBtn = card.querySelector("#skillPasteBtn"), pasteText = card.querySelector("#skillPasteText");
    if (pasteBtn && pasteText) pasteBtn.addEventListener("click", function () {
      try { const s = importFromText(pasteText.value, "paste"); pasteText.value = ""; renderList(); setMsg("已导入「" + s.name + "」（默认未启用，请在上方开启）"); }
      catch (e) { setMsg("导入失败：" + (e && e.message || e)); }
    });

    const fileBtn = card.querySelector("#skillFileBtn"), fileInput = card.querySelector("#skillFileInput");
    if (fileBtn && fileInput) {
      fileBtn.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function (e) {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const reader = new FileReader();
        reader.onload = function () { try { const s = importFromText(String(reader.result), f.name); renderList(); setMsg("已从文件导入「" + s.name + "」（默认未启用）"); } catch (err) { setMsg("导入失败：" + (err && err.message || err)); } };
        reader.onerror = function () { setMsg("读取文件失败"); };
        reader.readAsText(f); fileInput.value = "";
      });
    }

    const urlBtn = card.querySelector("#skillUrlBtn"), urlInput = card.querySelector("#skillUrlInput");
    if (urlBtn && urlInput) urlBtn.addEventListener("click", async function () {
      urlBtn.disabled = true; setMsg("拉取中…");
      try { const s = await importFromUrl(urlInput.value); urlInput.value = ""; renderList(); setMsg("已从链接导入「" + s.name + "」（默认未启用，请先阅读正文再开）"); }
      catch (e) { setMsg("拉取失败：" + (e && e.message || e)); }
      urlBtn.disabled = false;
    });

    const sampleBtn = card.querySelector("#skillSampleBtn");
    if (sampleBtn) sampleBtn.addEventListener("click", async function () {
      sampleBtn.disabled = true; setMsg("拉取起始技能库…");
      try { const n = await importStarterLibrary(); renderList(); setMsg(n ? ("已导入起始技能库 " + n + " 条（默认未启用，逐条阅读后再开）。") : "起始技能库已全部导入过，无新增。"); }
      catch (e) { setMsg("导入失败：" + (e && e.message || e)); }
      sampleBtn.disabled = false;
    });
  }

  function mountCard() {
    const slot = document.getElementById("setSkillSlot");
    if (!slot || document.getElementById("skillSystemCard")) return;
    const IN = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid var(--border,#333);background:transparent;color:inherit;font-size:13px;';
    const card = document.createElement("div");
    card.className = "card";
    card.id = "skillSystemCard";
    card.innerHTML =
      '<h4>Skill 系统（技能）</h4>'
      + '<p>导入 <b>SKILL.md</b>（纯 Markdown + YAML frontmatter）作为额外系统提示注入对话。启用的技能正文会接在系统提示末尾，<b>优先级低于解限底座与人设铁则</b>。随云同步、跨设备可用。</p>'
      + '<div class="rowline"><div class="toggle"><input type="checkbox" id="skillGlobalToggle"><label for="skillGlobalToggle">启用 Skill 系统（总开关）</label></div></div>'
      + '<div id="skillList" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>'
      + '<div style="margin-top:14px;"><div style="font-size:12px;color:var(--muted);margin-bottom:6px;">导入技能</div>'
      + '<textarea id="skillPasteText" rows="4" placeholder="粘贴 SKILL.md 内容…" style="' + IN + 'resize:vertical;"></textarea>'
      + '<div class="rowline" style="margin-top:8px;"><div></div><div class="btns">'
      + '<button class="smallbtn" id="skillPasteBtn">从文本导入</button>'
      + '<button class="smallbtn" id="skillFileBtn">从文件导入</button>'
      + '<input type="file" id="skillFileInput" accept=".md,.markdown,.txt" style="display:none">'
      + '<button class="smallbtn" id="skillSampleBtn">导入起始技能库</button>'
      + '</div></div>'
      + '<div class="rowline" style="margin-top:6px;align-items:center;gap:8px;"><input type="text" id="skillUrlInput" placeholder="GitHub raw 链接（raw.githubusercontent.com/…/SKILL.md）" style="flex:1;' + IN + '"><button class="smallbtn" id="skillUrlBtn">拉取</button></div>'
      + '<div id="skillImportStatus" style="font-size:11px;color:var(--muted);margin-top:8px;"></div></div>'
      + '<div class="settings-warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg><span>第三方 / 社区技能可能含提示词注入，<b>导入后默认不启用</b>；请先阅读正文再手动开启。含 reference 的技能当前只注入正文，附件文件不注入。</span></div>';
    slot.appendChild(card);
    wireCard(card);
    renderList();
  }

  // ─── 暴露 + 初始化 ───
  window.__skills = {
    getEnabledPrompt, list, getAll, save, remove, setEnabled,
    setGlobalEnabled, isGlobalEnabled, importFromText, importFromUrl, parseSkillMd,
  };

  function init() { mountCard(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();