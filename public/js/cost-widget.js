// 路径: public/js/cost-widget.js
/* 通用「费用统计」窗口 —— 次级工作页(coding / studio / write / image …)顶栏复用。
   读同源 localStorage 的 cfw_cost_log_v1(主站 app.js 在快速模式下按天/设备写入),
   只读展示「今日 / 总计」,点开看 今日·近7天·本月·累计 明细。
   展示部分不联网;此外自 2026-06-17 起额外提供:
   ① record() 主动记账方法,② 全局 /api/chat fetch 拦截器,
   让各工具页 / agent 模式的快速模式消费也能写进同一本账。 */
(function () {
  var LS = 'cfw_cost_log_v1';
  function isFlat(e) {
    return !!(e && typeof e === 'object' && !Array.isArray(e) &&
      (typeof e.cost === 'number' || typeof e.requests === 'number' ||
       typeof e.prompt === 'number' || typeof e.completion === 'number'));
  }
  function deviceId() { try { return localStorage.getItem('cfw_device_id_v1') || ''; } catch (e) { return ''; } }
  function sumDay(d, dev) {
    var o = { cost: 0, requests: 0 };
    if (!d || typeof d !== 'object') return o;
    if (isFlat(d)) { o.cost += d.cost || 0; o.requests += d.requests || 0; return o; }
    Object.keys(d).forEach(function (k) {
      if (dev && k !== dev) return;
      var e = d[k];
      if (e && typeof e === 'object') { o.cost += e.cost || 0; o.requests += e.requests || 0; }
    });
    return o;
  }
  function load() {
    try { var raw = localStorage.getItem(LS); if (!raw) return {}; var o = JSON.parse(raw); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
    catch (e) { return {}; }
  }
  function dayStr(t) { var d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function stats(dev) {
    var log = load(), today = dayStr(Date.now()), mp = today.slice(0, 7), ws = dayStr(Date.now() - 6 * 86400000);
    var s = { today: 0, week: 0, month: 0, total: 0, requests: 0 };
    for (var d in log) {
      var c = sumDay(log[d], dev);
      s.total += c.cost; s.requests += c.requests;
      if (d === today) s.today += c.cost;
      if (d >= ws) s.week += c.cost;
      if (d.indexOf(mp) === 0) s.month += c.cost;
    }
    return s;
  }
  function fmt(n) { return '¥' + (n || 0).toFixed(4); }

  // ── 共享记账(record) + /api/chat fetch 拦截器（2026-06-17）──
  function ensureDeviceId() {
    try {
      var id = localStorage.getItem('cfw_device_id_v1');
      if (!id) { id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('cfw_device_id_v1', id); }
      return id;
    } catch (e) { return 'dev_unknown'; }
  }
  // 与 app.js calcCost 同公式:cache_hit 折价 + 未命中 input + output,单位 ¥/1M tokens
  function calcCost(model, promptTokens, completionTokens, cachedTokens) {
    var P = (typeof window !== 'undefined' && window.DEEPSEEK_PRICING) || {};
    var p = P[model];
    if (!p) return 0;
    var normalInput = Math.max(0, (promptTokens || 0) - (cachedTokens || 0));
    return ((cachedTokens || 0) * (p.cache_hit || 0) + normalInput * (p.input || 0) + (completionTokens || 0) * (p.output || 0)) / 1000000;
  }
  var _lastRec = { key: '', t: 0 };
  // record({ model, mode, usage }) —— 仅快速(fast)模式按量计费;免费/无价目/零成本不记。
  // 防抖:显式调用与 fetch 拦截器可能对同一响应各记一次,3 秒内同签名只计一次。
  function record(info) {
    try {
      info = info || {};
      if (info.mode !== 'fast') return 0;
      var u = info.usage || {};
      var p = u.prompt_tokens || 0, c = u.completion_tokens || 0, cached = u.prompt_cache_hit_tokens || 0;
      var cost = calcCost(info.model, p, c, cached);
      if (!cost || cost <= 0) return 0;
      var key = (info.model || '') + ':' + p + ':' + c + ':' + cached;
      var now = Date.now();
      if (key === _lastRec.key && (now - _lastRec.t) < 3000) return 0;
      _lastRec.key = key; _lastRec.t = now;
      var log = load();
      var day = dayStr(now);
      var dev = ensureDeviceId();
      var dayObj = isFlat(log[day]) ? { legacy: log[day] }
        : (log[day] && typeof log[day] === 'object' ? log[day] : {});
      var e = dayObj[dev] || { cost: 0, prompt: 0, completion: 0, requests: 0 };
      e.cost = (e.cost || 0) + cost;
      e.prompt = (e.prompt || 0) + p;
      e.completion = (e.completion || 0) + c;
      e.requests = (e.requests || 0) + 1;
      dayObj[dev] = e;
      log[day] = dayObj;
      try { localStorage.setItem(LS, JSON.stringify(log)); } catch (e2) {}
      try { if (window.__sync && window.__sync.markCostDirty) window.__sync.markCostDirty(); } catch (e3) {}
      if (el) render();
      return cost;
    } catch (e) { return 0; }
  }
  // 全局拦截 /api/chat:把响应流 tee 一份后台解析 SSE 末尾 usage 记账。
  // 主站 app.js 自带 window.__cost 记账器 → 凡其在场一律不记,绝不重复计;
  // 仅快速模式、成功且可读流时才 tee,其余原样放行,零副作用。
  (function installFetchTap() {
    try {
      if (typeof window === 'undefined' || !window.fetch || window.__costFetchTapped) return;
      window.__costFetchTapped = true;
      var orig = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = '';
        try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
        var pr = orig(input, init);
        if (url.indexOf('/api/chat') < 0) return pr;
        var info = { mode: 'free', model: '' };
        try { var rb = init && init.body; if (typeof rb === 'string') { var b = JSON.parse(rb); info.mode = b.mode || 'free'; info.model = b.model || ''; } } catch (e) {}
        return pr.then(function (resp) {
          try {
            if (window.__cost || info.mode !== 'fast' || !resp || !resp.ok || !resp.body || !resp.body.tee) return resp;
            var pair = resp.body.tee();
            var mine = pair[1].getReader(), dec = new TextDecoder(), buf = '', usage = null;
            (function pump() {
              mine.read().then(function (r) {
                if (r.done) { if (usage) { try { record({ model: info.model, mode: 'fast', usage: usage }); } catch (e) {} } return; }
                buf += dec.decode(r.value, { stream: true });
                var i;
                while ((i = buf.indexOf('\n')) >= 0) {
                  var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                  if (!line || line.indexOf('data:') !== 0) continue;
                  var data = line.slice(5).trim();
                  if (data === '[DONE]') continue;
                  try { var j = JSON.parse(data); if (j && j.usage) usage = j.usage; } catch (e) {}
                }
                pump();
              }).catch(function () { if (usage) { try { record({ model: info.model, mode: 'fast', usage: usage }); } catch (e) {} } });
            })();
            var hdrs;
            try { hdrs = new Headers(resp.headers); hdrs.delete('content-encoding'); hdrs.delete('content-length'); } catch (e) { hdrs = resp.headers; }
            return new Response(pair[0], { status: resp.status, statusText: resp.statusText, headers: hdrs });
          } catch (e) { return resp; }
        });
      };
    } catch (e) {}
  })();

  var el = null, started = false;
  function ensureEl() {
    el = document.getElementById('costWidget');
    if (!el) {
      el = document.createElement('span');
      el.id = 'costWidget';
      el.style.position = 'fixed';
      el.style.top = '10px';
      el.style.right = '14px';
      el.style.zIndex = '9998';
      document.body.appendChild(el);
    }
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.gap = '6px';
    el.style.padding = '5px 11px';
    el.style.borderRadius = '9px';
    el.style.border = '1px solid rgba(125,108,255,.35)';
    el.style.background = 'rgba(125,108,255,.12)';
    el.style.color = '#c9c3ff';
    el.style.font = '12px/1.2 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    el.style.cursor = 'pointer';
    el.style.whiteSpace = 'nowrap';
    el.style.userSelect = 'none';
    el.title = '点击查看费用明细（今日 / 近7天 / 本月 / 累计）';
    el.addEventListener('click', showDetail);
    return el;
  }
  function render() {
    if (!el) return;
    var s = stats();
    el.innerHTML = '<span style="opacity:.8">费用</span> <b style="font-weight:600">今日 ' + fmt(s.today) + '</b> <span style="opacity:.5">·</span> <span>总计 ' + fmt(s.total) + '</span>';
  }
  function showDetail() {
    var all = stats(), mine = stats(deviceId());
    var multi = mine.total > 0 && (all.total - mine.total) > 1e-9;
    var msg = '账户费用统计（仅「快速」按量计费模式累计，免费模式不计费）\n\n';
    if (multi) {
      msg += '【本机】\n'
        + '今日 ' + fmt(mine.today) + ' · 近7天 ' + fmt(mine.week) + '\n'
        + '本月 ' + fmt(mine.month) + ' · 累计 ' + fmt(mine.total) + '\n\n'
        + '【全设备合计】\n'
        + '今日 ' + fmt(all.today) + ' · 近7天 ' + fmt(all.week) + '\n'
        + '本月 ' + fmt(all.month) + ' · 累计 ' + fmt(all.total) + '\n'
        + '累计请求 ' + all.requests + ' 次\n\n'
        + '全设备合计来自已同步到本机的费用日志;在主站开启云同步后各设备数据会合并。';
    } else {
      msg += '今日：' + fmt(all.today) + '\n'
        + '近 7 天：' + fmt(all.week) + '\n'
        + '本月：' + fmt(all.month) + '\n'
        + '累计：' + fmt(all.total) + '\n'
        + '累计请求：' + all.requests + ' 次\n\n'
        + '数据来自本机浏览器（与主站「酒馆」共享）;跨设备请在主站开启云同步后查看合并总额。';
    }
    alert(msg);
  }
  function start() {
    if (started) return; started = true;
    ensureEl(); render();
    setInterval(render, 5000);
    window.addEventListener('storage', function (e) { if (!e || e.key === LS || e.key === null) render(); });
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  }
  try {
    window.__costWidget = { record: record, refresh: render, stats: stats, calcCost: calcCost };
    window.__costRecord = record;
  } catch (e) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
