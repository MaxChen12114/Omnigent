// public/dev.js — 开发者模式中央 (4.17 新增,集中所有 dev-only 逻辑)
// API: window.__dev = { isOn, toggle, enable, disable, debug, log, exportLS, setLastPayload, openPanel }
//
// 设计原则:
//   1. 所有 dev-only 入口/调试逻辑集中此模块,不散落到 character.js / app.js / index.html
//   2. 加载顺序: auth.js → dev.js → 其他。dev.js 内 monkey-patch window.fetch,
//      包裹 auth.js 的 Authorization 注入,无副作用(只在 /api/chat 路径抓 payload 旁路存储)
//   3. Easter-egg: 长按底栏 #githubBtn 1.2 秒切换 dev mode (短按仍跳转 GitHub)
//   4. DOM 上凡是 [data-dev-only] 的元素,普通模式自动 display:none
//   5. dev mode ON 时右上角常驻 🛠 角标(短按打开 Dev Panel,长按 1.5 秒关闭 dev mode)
//
// LS keys:
//   cfw_dev_mode_v1="1"  开发者模式总开关
//   cfw_dev_debug_v1="1" verbose console log 开关(window.__dev.debug)
(function(){
  "use strict";
  const KEY="cfw_dev_mode_v1";
  const DBG="cfw_dev_debug_v1";
  const isOn=()=>localStorage.getItem(KEY)==="1";

  // === Public API ===
  const api={
    isOn,
    debug:localStorage.getItem(DBG)==="1",
    log(...a){if(api.debug)console.log("[dev]",...a);},
    enable(){localStorage.setItem(KEY,"1");location.reload();},
    disable(){localStorage.removeItem(KEY);location.reload();},
    toggle:toggleDev,
    exportLS:exportCfwLs,
    setLastPayload,
    openPanel,
  };
  window.__dev=api;

  // === Toast helper ===
  function toast(msg,ms){
    const t=document.createElement("div");
    t.textContent=msg;
    t.style.cssText="position:fixed;left:50%;top:24px;transform:translateX(-50%);padding:10px 18px;background:rgba(0,0,0,.88);color:#fff;border-radius:10px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.4);backdrop-filter:blur(8px);";
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),ms||1200);
    return t;
  }

  // === Toggle ===
  function toggleDev(){
    const cur=isOn();
    if(cur)localStorage.removeItem(KEY);else localStorage.setItem(KEY,"1");
    try{navigator.vibrate&&navigator.vibrate([30,60,30]);}catch{}
    toast((cur?"[关] 开发者模式 OFF":"[开] 开发者模式 ON")+" · 1 秒后刷新",1000);
    setTimeout(()=>location.reload(),1000);
  }

  // === Apply [data-dev-only] visibility ===
  function applyVisibility(){
    document.documentElement.classList.toggle("dev-mode",isOn());
    document.querySelectorAll("[data-dev-only]").forEach(el=>{
      el.style.display=isOn()?"":"none";
    });
  }

  // === 🛠 角标 ===
  // 4.18 (fix v2): 彻底不再 fixed 浮动,改为 wire index.html 顶栏 #devBadgeTopbar 按钮
  // (该按钮带 data-dev-only,普通模式被 applyVisibility 隐藏,dev mode ON 才出现)
  // 顺手清理可能残留的旧 fixed badge
  function ensureBadge(){
    const old=document.getElementById("dev-badge");
    if(old)old.remove();
    const b=document.getElementById("devBadgeTopbar");
    if(!b)return;
    if(b.dataset.wired==="1")return;
    b.dataset.wired="1";
    let t=null,fired=false;
    b.addEventListener("pointerdown",()=>{fired=false;if(t)clearTimeout(t);t=setTimeout(()=>{fired=true;toggleDev();},1500);});
    b.addEventListener("pointerup",()=>{if(t){clearTimeout(t);t=null;}});
    b.addEventListener("pointerleave",()=>{if(t){clearTimeout(t);t=null;}});
    b.addEventListener("pointercancel",()=>{if(t){clearTimeout(t);t=null;}});
    b.addEventListener("click",(e)=>{if(fired){fired=false;e.preventDefault();e.stopPropagation();return;}openPanel();});
  }

  // === Easter-egg: 长按 GitHub 按钮 1.2 秒切换 (4.18 加震动+缩放+光晕反馈,原 2s 无反馈太迷糊) ===
  function wireGithubLongPress(){
    const g=document.getElementById("githubBtn");
    if(!g)return;
    let lpT=null,lpF=false,vibT=null;
    const HOLD_MS=1200;
    function start(){
      lpF=false;
      if(lpT)clearTimeout(lpT);
      // 按下瞬间: 缩放反馈 + 启动光晕
      g.style.transition="transform .15s ease, box-shadow .15s ease";
      g.style.transform="scale(0.92)";
      g.style.boxShadow="0 0 0 0 rgba(140,100,220,.6)";
      // 1.2s 内光晕渐进扩散 (模拟蓄力倒计时)
      requestAnimationFrame(()=>{
        g.style.transition="transform .15s ease, box-shadow "+HOLD_MS+"ms ease";
        g.style.boxShadow="0 0 0 18px rgba(140,100,220,0)";
      });
      // 三段震动: 按下 / 中段 / 触发
      try{navigator.vibrate&&navigator.vibrate(15);}catch{}
      vibT=setTimeout(()=>{try{navigator.vibrate&&navigator.vibrate(25);}catch{}},600);
      lpT=setTimeout(()=>{
        lpF=true;
        try{navigator.vibrate&&navigator.vibrate([40,30,40,30,80]);}catch{}
        toggleDev();
      },HOLD_MS);
    }
    function cancel(){
      if(lpT){clearTimeout(lpT);lpT=null;}
      if(vibT){clearTimeout(vibT);vibT=null;}
      g.style.transform="";
      g.style.boxShadow="";
      g.style.transition="";
    }
    g.addEventListener("pointerdown",start);
    g.addEventListener("pointerup",cancel);
    g.addEventListener("pointerleave",cancel);
    g.addEventListener("pointercancel",cancel);
    g.addEventListener("click",(e)=>{if(lpF){e.preventDefault();e.stopPropagation();lpF=false;}});
    g.addEventListener("contextmenu",(e)=>{if(lpT||lpF)e.preventDefault();});
  }

  // === Wire #syncPauseBtn (4.17: 顶栏暂停同步按钮,dev-only) ===
  function wireSyncPauseBtn(){
    const btn=document.getElementById("syncPauseBtn");
    if(!btn)return;
    // 2026-06-16: 替换 emoji 为 SVG(原 textContent=⏸/▶ 会覆盖 HTML 内联 SVG)
    const PAUSE_SVG='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
    const RESUME_SVG='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    function refresh(){
      const paused=window.__sync&&window.__sync.isPaused&&window.__sync.isPaused();
      btn.innerHTML=paused?RESUME_SVG:PAUSE_SVG;
      btn.title=paused?"恢复同步(目前已暂停)":"暂停同步(临时不推 KV,避免乱聊污染云端)";
      btn.style.background=paused?"rgba(255,160,80,0.25)":"";
    }
    btn.addEventListener("click",()=>{
      if(!window.__sync)return;
      if(window.__sync.isPaused())window.__sync.resume();
      else window.__sync.pause();
      refresh();
      toast(window.__sync.isPaused()?"⏸ 同步已暂停":"▶ 同步已恢复",1200);
    });
    refresh();
  }

  // ============== 4.23 Dev 测试增强 · 状态 ==============
  const OVR_KEY="cfw_dev_overrides_v1";
  const NOTES_KEY="cfw_dev_notes_v1";
  const HUD_KEY="cfw_dev_hud_v1";
  const INJECT_ID="__dev_inject__";
  let ovr=(function(){try{return JSON.parse(localStorage.getItem(OVR_KEY)||"{}")||{};}catch(e){return{};}})();
  let fault=null;
  let faultMs=4000;
  function saveOvr(){try{localStorage.setItem(OVR_KEY,JSON.stringify(ovr));}catch(e){}}
  const hud={inflight:false,ms:0,bytes:0,at:0,model:""};
  let snapshots=[];

  // === Prompt 调试: monkey-patch fetch,旁路存 /api/chat payload ===
  // 2026-06-15 升级: 单条 lastPayload → 环形缓冲(最多 MAX_PAYLOADS 条),面板可列表切换查看历史请求;
  // 每条记录 status/ms/bytes(由 measureStream 回填)。lastPayload 保留为"最新一条"做向后兼容(buildReport/replay 等仍可用)。
  const MAX_PAYLOADS=25;
  let payloads=[];
  let selPayload=-1;
  let inspectTab="overview"; // 2026-06-15 I/O 探查器当前子标签
  let lastPayload=null;
  function setLastPayload(p){
    const entry={at:Date.now(),payload:p,status:null,ms:0,bytes:0,done:false};
    payloads.push(entry);
    if(payloads.length>MAX_PAYLOADS)payloads.splice(0,payloads.length-MAX_PAYLOADS);
    selPayload=payloads.length-1;
    lastPayload=entry;
    api.log("capture payload",p);
    return entry;
  }
  function selectedPayload(){
    if(selPayload>=0&&selPayload<payloads.length)return payloads[selPayload];
    return payloads.length?payloads[payloads.length-1]:null;
  }
  (function patchFetch(){
    if(!window.fetch)return;
    const orig=window.fetch.bind(window);
    window.fetch=async function(input,init){
      let isChat=false;
      let _curEntry=null;
      try{
        const url=typeof input==="string"?input:(input&&input.url)||"";
        isChat=url.indexOf("/api/chat")>=0;
        if(isChat&&init&&init.body){
          try{
            let b=typeof init.body==="string"?JSON.parse(init.body):init.body;
            _curEntry=setLastPayload(b);
            b._debugEcho=true; // 2026-06-15 dev 面板:请求服务端只读回显真实装配(worker 仅 unlocked 本人响应,只反射不改 prompt)
            if(typeof ovr.temp==="number")b.temperature=ovr.temp;
            if(typeof ovr.maxTokens==="number")b.max_tokens=ovr.maxTokens;
            init=Object.assign({},init,{body:JSON.stringify(b)});
            if(b&&b.model)hud.model=b.model;
          }catch(e){}
        }
      }catch(e){}
      if(isChat&&fault){
        api.log("fault inject",fault);
        if(fault==="error")return Promise.reject(new TypeError("[dev] 故障注入:模拟网络中断"));
        if(fault==="http500")return new Response('{"error":"[dev] injected 500"}',{status:500,statusText:"Dev Injected",headers:{"content-type":"application/json"}});
        if(fault==="slow")await new Promise(r=>setTimeout(r,faultMs));
      }
      if(!isChat)return orig(input,init);
      const t0=(window.performance&&performance.now)?performance.now():Date.now();
      hud.inflight=true;try{updateHud();}catch(e){}
      let resp;
      try{resp=await orig(input,init);}catch(e){hud.inflight=false;if(_curEntry){_curEntry.done=true;_curEntry.status="ERR";}try{updateHud();}catch(_){}try{if(mask&&mask.style.display!=="none")renderPanel();}catch(_){}throw e;}
      if(_curEntry)_curEntry.status=resp.status;
      try{measureStream(resp.clone(),t0,_curEntry);}catch(e){hud.inflight=false;try{updateHud();}catch(_){}}
      return resp;
    };
  })();

  // 2026-06-15 重写:不再只数字节,而是真正解析入站 SSE 流——逐块累加 content/reasoning、抓 usage、记 TTFB(首块)/总耗时/分块数/字节、抓服务端装配回显(": __dbg__")。全部写进 entry 供 I/O 探查器渲染。
  function measureStream(resp,t0,entry){
    const rd=(resp&&resp.body&&resp.body.getReader)?resp.body.getReader():null;
    if(!rd){hud.inflight=false;if(entry)entry.done=true;try{updateHud();}catch(e){}return;}
    const dec=new TextDecoder();
    let bytes=0,raw="",content="",reasoning="",chunks=0,firstAt=0,usage=null,sseBuf="";
    const RAW_CAP=400000;
    const now=()=>(window.performance&&performance.now)?performance.now():Date.now();
    function flushLine(line){
      const t=line.replace(/\r$/,"").trim();
      if(!t)return;
      if(t.charAt(0)===":"){ // SSE 注释:可能是 dev 装配回显 ": __dbg__ {...}"
        const k=t.indexOf("__dbg__");
        if(k>=0&&entry&&!entry.dbg){try{entry.dbg=JSON.parse(t.slice(k+7).trim());}catch(e){}}
        return;
      }
      if(t.indexOf("data:")===0){
        const d=t.slice(5).trim();
        if(!d||d==="[DONE]")return;
        try{
          const j=JSON.parse(d);chunks++;
          const dl=j.choices&&j.choices[0]&&j.choices[0].delta;
          if(dl){if(typeof dl.content==="string")content+=dl.content;if(typeof dl.reasoning_content==="string")reasoning+=dl.reasoning_content;}
          if(j.usage)usage=j.usage;
        }catch(e){}
      }
    }
    function finalize(entryDone){
      if(entry){entry.bytes=bytes;entry.done=true;entry.raw=raw;entry.content=content;entry.reasoning=reasoning;entry.chunks=chunks;entry.usage=usage;if(entryDone)entry.ms=entryDone.ms;if(entryDone)entry.ttfb=entryDone.ttfb;}
      hud.bytes=bytes;hud.at=Date.now();hud.inflight=false;
      try{updateHud();}catch(e){}
      try{if(mask&&mask.style.display!=="none")renderPanel();}catch(e){}
    }
    (function pump(){
      rd.read().then(function(o){
        if(o.done){
          const t1=now();const ms=Math.round(t1-t0);hud.ms=ms;
          finalize({ms:ms,ttfb:firstAt?Math.round(firstAt-t0):0});
          return;
        }
        if(!firstAt)firstAt=now();
        bytes+=o.value?o.value.length:0;
        const txt=dec.decode(o.value,{stream:true});
        if(raw.length<RAW_CAP)raw+=txt;
        sseBuf+=txt;
        let idx;
        while((idx=sseBuf.indexOf("\n"))>=0){const line=sseBuf.slice(0,idx);sseBuf=sseBuf.slice(idx+1);flushLine(line);}
        pump();
      }).catch(function(){finalize(null);});
    })();
  }

  // === LS 导出 ===
  function exportCfwLs(){
    const obj={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.indexOf("cfw_")===0)obj[k]=localStorage.getItem(k);
    }
    navigator.clipboard.writeText(JSON.stringify(obj,null,2));
    return obj;
  }
  function exportAllLs(){
    const obj={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k)obj[k]=localStorage.getItem(k);
    }
    navigator.clipboard.writeText(JSON.stringify(obj,null,2));
    return obj;
  }
  // 2026-06-16 §十.C: 一键导出最近捕获的请求 I/O 记录(出站 body / 入站流 / 真实装配 / reasoning)为 JSON
  function tsName(){const d=new Date();const p=function(n){return String(n).padStart(2,"0");};return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+"-"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());}
  async function exportAllRecords(){
    if(!payloads.length){toast("还没有可导出的记录",1200);return;}
    const recs=payloads.map(function(e,i){return {idx:i+1,at:e.at,time:new Date(e.at).toISOString(),status:e.status,ms:e.ms||0,ttfb:e.ttfb||0,bytes:e.bytes||0,chunks:e.chunks||0,done:!!e.done,model:(e.payload&&e.payload.model)||null,request:e.payload||null,assembled:e.dbg||null,content:e.content||"",reasoning:e.reasoning||"",usage:e.usage||null,raw:e.raw||""};});
    const out={exportedAt:new Date().toISOString(),count:recs.length,records:recs};
    const json=JSON.stringify(out,null,2);
    const fname="omnigent-dev-records-"+tsName()+".json";
    // 2026-06-20 修:桌面壳(Tauri)里 <a download>.click() 经常不真正写盘,toast 却照样谎报成功。
    // 改为:桌面端走原生 export_text_file 真落盘(写成功才弹真实路径),网页端保留 <a download>;两路都加剪贴板兜底。
    const inv=(window.__TAURI__&&window.__TAURI__.core&&typeof window.__TAURI__.core.invoke==="function")?window.__TAURI__.core.invoke.bind(window.__TAURI__.core):null;
    async function clip(tip){try{await navigator.clipboard.writeText(json);toast(tip+" · 已复制到剪贴板("+recs.length+"条)",2600);}catch(_){toast("写盘+剪贴板都失败,请从控制台取 __dev 数据",3000);}}
    if(inv){
      try{
        const savedPath=await inv("export_text_file",{suggestedName:fname,content:json});
        if(savedPath)toast("已写盘 "+recs.length+" 条 → "+savedPath,2600);
        else toast("已取消保存(未写盘)",1400);
      }catch(e){await clip("原生写盘失败:"+String(e).slice(0,50));}
      return;
    }
    try{
      const blob=new Blob([json],{type:"application/json"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=fname;a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
      toast("已导出 "+recs.length+" 条记录",1400);
    }catch(e){await clip("下载失败:"+String(e).slice(0,50));}
  }

  function readLsAll(){const o={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k)o[k]=localStorage.getItem(k);}return o;}
  function modelOptions(){const sel=document.getElementById("modelSel");return sel?Array.prototype.map.call(sel.options,function(o){return{v:o.value,t:o.textContent};}):[];}
  function setModel(v){const sel=document.getElementById("modelSel");if(sel){sel.value=v;sel.dispatchEvent(new Event("change",{bubbles:true}));}}
  function setNsfw(v){localStorage.setItem("cfw_nsfw_mode_v1",String(v));try{window.dispatchEvent(new Event("theme:changed"));}catch(e){}}
  function clickThink(){const b=document.getElementById("thinkToggle");if(b)b.click();}
  function setStrict(on){localStorage.setItem("cfw_strict_roleplay_v1",on?"1":"0");}
  function setReplyStyle(v){localStorage.setItem("cfw_reply_style_v1",v);}
  function getInject(){try{const a=JSON.parse(localStorage.getItem("cfw_prompt_presets_v1")||"[]");const p=(Array.isArray(a)?a:[]).find(function(x){return x&&x.id===INJECT_ID;});return p?p.content:"";}catch(e){return"";}}
  function setInject(text){let a;try{a=JSON.parse(localStorage.getItem("cfw_prompt_presets_v1")||"[]");if(!Array.isArray(a))a=[];}catch(e){a=[];}a=a.filter(function(x){return !(x&&x.id===INJECT_ID);});if(text&&text.trim()){const mo=a.reduce(function(m,x){return Math.max(m,x.order||0);},0);a.push({id:INJECT_ID,name:"🧪 DEV注入",content:text,enabled:true,order:mo+1,group:"DEV"});}try{localStorage.setItem("cfw_prompt_presets_v1",JSON.stringify(a));}catch(e){}}
  function snapTake(name){const slot={name:name||("存档 "+(snapshots.length+1)),at:Date.now(),ls:readLsAll()};snapshots.push(slot);return slot;}
  function snapRestore(i){const s=snapshots[i];if(!s)return;if(!confirm("回滚到「"+s.name+"」？\n会覆盖当前 localStorage 并刷新(IndexedDB 角色卡/道具不受影响)。"))return;try{localStorage.clear();Object.keys(s.ls).forEach(function(k){localStorage.setItem(k,s.ls[k]);});}catch(e){alert("回滚失败:"+e);return;}location.reload();}
  function snapDownload(i){const s=(i>=0&&snapshots[i])?snapshots[i]:{name:"current",at:Date.now(),ls:readLsAll()};const blob=new Blob([JSON.stringify(s,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="snapshot-"+Date.now()+".json";a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},2000);}
  function snapUpload(file){const r=new FileReader();r.onload=function(){try{const s=JSON.parse(r.result);if(!s||!s.ls)throw new Error("格式不对");if(!confirm("从文件回滚?会覆盖当前 localStorage 并刷新。"))return;localStorage.clear();Object.keys(s.ls).forEach(function(k){localStorage.setItem(k,s.ls[k]);});location.reload();}catch(e){alert("读取失败:"+e);}};r.readAsText(file);}
  function notesLoad(){try{const r=JSON.parse(localStorage.getItem(NOTES_KEY)||"[]");return Array.isArray(r)?r:[];}catch(e){return[];}}
  function notesSave(a){try{localStorage.setItem(NOTES_KEY,JSON.stringify(a));}catch(e){}}
  function noteAdd(text){if(!text||!text.trim())return;const a=notesLoad();const ch=window.__character;const cardName=(ch&&ch.getActiveCard&&(ch.getActiveCard()||{}).name)||"";const ctx={model:hud.model||"",nsfw:localStorage.getItem("cfw_nsfw_mode_v1")||"0",theme:localStorage.getItem("cfw_theme_v1")||"minimal",card:cardName};a.push({at:Date.now(),text:text.trim(),ctx:ctx});notesSave(a);}
  function noteDel(i){const a=notesLoad();a.splice(i,1);notesSave(a);}
  let hudEl=null;
  function showHud(){if(!hudEl){hudEl=document.createElement("div");hudEl.id="dev-hud";hudEl.style.cssText="position:fixed;left:12px;bottom:72px;z-index:9000;background:var(--bg,#16161e);color:inherit;border:1px solid var(--border,rgba(127,127,127,.35));border-radius:12px;padding:9px 11px;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;max-width:240px;box-shadow:0 8px 24px rgba(0,0,0,.4);backdrop-filter:blur(8px);cursor:move;";document.body.appendChild(hudEl);dragify(hudEl);}localStorage.setItem(HUD_KEY,"1");hudEl.style.display="block";updateHud();}
  function hideHud(){localStorage.setItem(HUD_KEY,"0");if(hudEl)hudEl.style.display="none";}
  function dragify(el){let sx,sy,ox,oy,on=false;el.addEventListener("pointerdown",function(e){if(e.target.closest&&e.target.closest("[data-hud-x]"))return;on=true;sx=e.clientX;sy=e.clientY;const r=el.getBoundingClientRect();ox=r.left;oy=r.top;try{el.setPointerCapture(e.pointerId);}catch(_){}});el.addEventListener("pointermove",function(e){if(!on)return;el.style.left=(ox+e.clientX-sx)+"px";el.style.top=(oy+e.clientY-sy)+"px";el.style.bottom="auto";});el.addEventListener("pointerup",function(){on=false;});}
  function updateHud(){if(!hudEl||hudEl.style.display==="none")return;const nsf=localStorage.getItem("cfw_nsfw_mode_v1")||"0";const th=localStorage.getItem("cfw_theme_v1")||"minimal";const think=(document.getElementById("thinkToggle")||{}).textContent||"";let sync="—",push="—";try{if(window.__sync&&window.__sync.getStatus){const s=window.__sync.getStatus();sync=s.enabled?(s.paused?"暂停":"开"):"关";push=s.pushCount;}}catch(e){}const spd=hud.ms?(Math.round(hud.bytes/1024/(hud.ms/1000)*10)/10+"KB/s"):"—";hudEl.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:inherit;opacity:.65;letter-spacing:.04em;">DEV HUD</b><span data-hud-x style="cursor:pointer;color:#e8607d;">关闭</span></div><div>模型 '+esc(hud.model||"—")+'</div><div>NSFW '+nsf+' · '+esc(th)+'</div><div>'+esc(think)+'</div><div>同步 '+sync+' · push '+push+'</div><div>'+(hud.inflight?'<span style="color:#fd6;">请求中…</span>':('上次 '+(hud.ms||0)+'ms · '+spd))+'</div>'+(fault?'<div style="color:#f66;">故障注入:'+fault+'</div>':'');const x=hudEl.querySelector("[data-hud-x]");if(x)x.onclick=hideHud;}
  setInterval(function(){try{updateHud();}catch(e){}},2000);
  function buildReport(){const notes=notesLoad();const lines=["# 测试报告 "+new Date().toLocaleString(),"","## 环境","- 模型(最近): "+(hud.model||"—"),"- NSFW: "+(localStorage.getItem("cfw_nsfw_mode_v1")||"0"),"- 主题: "+(localStorage.getItem("cfw_theme_v1")||"minimal"),"- UA: "+navigator.userAgent,"","## Bug / 笔记 ("+notes.length+")"];notes.forEach(function(n,i){lines.push((i+1)+". ["+new Date(n.at).toLocaleString()+"] "+n.text+"  \n   _ctx: 模型="+n.ctx.model+" NSFW="+n.ctx.nsfw+" 主题="+n.ctx.theme+(n.ctx.card?" 角色="+n.ctx.card:"")+"_");});if(lastPayload){lines.push("","## 最近一次请求 payload","```json",JSON.stringify(lastPayload.payload,null,2),"```");}return lines.join("\n");}
  function buildScene(n,startMode){const ch=window.__character,M=window.__multi;if(!M||!ch){alert("多智能体/角色模块未就绪");return;}const archs=(ch.archetypes||[]).slice(0,Math.max(2,Math.min(6,n||3)));if(!archs.length){alert("没有可用原型");return;}M.setMulti(true);M.getSceneIds().slice().forEach(function(id){M.removeFromScene(id);});archs.forEach(function(a){M.addToScene(a.id);});if(ch.setActiveId&&archs[0])ch.setActiveId(archs[0].id);const fb=window.__fishbowl;if(startMode&&fb){fb.setMode(startMode);if(fb.setMaxRounds)fb.setMaxRounds(6);if(startMode==="discuss"&&fb.setTopic)fb.setTopic("测试议题:今晚吃什么");setTimeout(function(){if(fb.start)fb.start();},250);}toast("🎭 已造场景:"+archs.length+" 人"+(startMode?" · "+startMode:""),1600);}
  function chaos(){const themes=["minimal","glass","lewd-peach","lewd-doll"];const t=themes[Math.floor(Math.random()*themes.length)];if(window.__theme&&window.__theme.set)window.__theme.set(t);else localStorage.setItem("cfw_theme_v1",t);const nv=String(Math.floor(Math.random()*3));setNsfw(nv);const opts=modelOptions();if(opts.length)setModel(opts[Math.floor(Math.random()*opts.length)].v);const styles=["default","wechat","verbose"];setReplyStyle(styles[Math.floor(Math.random()*styles.length)]);setStrict(Math.random()<0.5);toast("🎰 混沌:"+t+" · NSFW"+nv,2000);setTimeout(function(){if(mask&&mask.style.display!=="none")renderPanel();},120);}
  async function replay(){if(!lastPayload){alert("还没捕获到 payload,先发一条消息");return;}const t0=Date.now();try{const r=await window.fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(lastPayload.payload)});const txt=await r.text();alert("重放完成 "+(Date.now()-t0)+"ms · HTTP "+r.status+"\n\n"+txt.slice(0,800));}catch(e){alert("重放失败:"+e);}}
  function dtParam(){
    const opts=modelOptions(),cur=(document.getElementById("modelSel")||{}).value||"";
    const nsf=localStorage.getItem("cfw_nsfw_mode_v1")||"0",rs=localStorage.getItem("cfw_reply_style_v1")||"default",strict=localStorage.getItem("cfw_strict_roleplay_v1")==="1";
    return '<div class="devx-card"><div class="devx-h">参数快切台</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"><select data-q-model class="dev-in">'+opts.map(function(o){return '<option value="'+esc(o.v)+'"'+(o.v===cur?" selected":"")+'>'+esc(o.t)+'</option>';}).join("")+'</select><select data-q-nsfw class="dev-in">'+[0,1,2,3].map(function(v){return '<option value="'+v+'"'+(String(v)===nsf?" selected":"")+'>NSFW '+v+'</option>';}).join("")+'</select><select data-q-style class="dev-in"><option value="default"'+(rs==="default"?" selected":"")+'>默认</option><option value="wechat"'+(rs==="wechat"?" selected":"")+'>微信连发</option><option value="verbose"'+(rs==="verbose"?" selected":"")+'>长段叙事</option></select><button class="dev-btn" data-q-think>思考模式</button><label style="display:flex;gap:4px;align-items:center;"><input type="checkbox" data-q-strict'+(strict?" checked":"")+'>严格RP</label></div><div style="display:flex;gap:6px;margin-top:6px;align-items:center;"><span style="color:var(--muted);">temp</span><input data-q-temp class="dev-in" type="number" step="0.1" style="width:60px;" value="'+(typeof ovr.temp==="number"?ovr.temp:"")+'" placeholder="默认"><span style="color:var(--muted);">max</span><input data-q-max class="dev-in" type="number" style="width:80px;" value="'+(typeof ovr.maxTokens==="number"?ovr.maxTokens:"")+'" placeholder="默认"></div><div class="devx-tip">temp/max 为追加叠加;worker 不读则无害</div></div>';
  }
  function dtPrompt(){
    return '<div class="devx-card"><div class="devx-h">Prompt 透视 + 实时注入</div><button class="dev-btn" data-x-payload>解析最近 payload</button><div class="devx-tip" style="margin:6px 0 4px;">下面内容作为追加预设(🧪DEV注入)走真实通道,只追加不动解限 base:</div><textarea data-inject class="dev-in" rows="3" style="width:100%;" placeholder="临时追加到 system…">'+esc(getInject())+'</textarea><div style="display:flex;gap:6px;margin-top:4px;"><button class="dev-btn" data-inject-save>启用注入</button><button class="dev-btn" data-inject-clear>清除注入</button></div></div>';
  }
  function dtSnap(){
    return '<div class="devx-card"><div class="devx-h">状态快照 / 回滚</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="dev-btn" data-snap-take>存档(内存)</button><button class="dev-btn" data-snap-dl>下载当前</button><label class="dev-btn" style="cursor:pointer;">从文件回滚<input type="file" data-snap-up accept=".json" style="display:none;"></label></div><div data-snap-list style="margin-top:6px;font-size:11px;"></div><div class="devx-tip">快照只含 localStorage;IndexedDB 的角色卡/道具不在内</div></div>';
  }
  function dtNotes(){
    return '<div class="devx-card"><div class="devx-h">Bug 速记 / 测试报告</div><div style="display:flex;gap:6px;"><input data-note class="dev-in" style="flex:1;" placeholder="记一条 bug/观察(自动附环境)…"><button class="dev-btn" data-note-add>+ 记</button></div><div data-note-list style="margin-top:6px;font-size:11px;max-height:160px;overflow:auto;"></div><div style="display:flex;gap:6px;margin-top:6px;"><button class="dev-btn" data-report-md>复制报告(MD)</button><button class="dev-btn" data-report-dl>下载报告</button></div></div>';
  }
  function dtHud(){
    return '<div class="devx-card"><div class="devx-h">实时 HUD 浮层</div><div style="display:flex;gap:6px;"><button class="dev-btn" data-hud-on>显示 HUD</button><button class="dev-btn" data-hud-off>隐藏 HUD</button></div><div class="devx-tip">浮层可拖动 · 显示模型/NSFW/同步/上次请求耗时速度/故障状态</div></div>';
  }
  // 2026-06-15 瘦身:删掉与主站重复的参数快切 + 酒馆味玩法(造场景/混沌/重放/快照/笔记),只留主站 UI 没有的采样覆盖 + 故障注入 + HUD。
  function dtSampling(){
    return '<div class="devx-card"><div class="devx-h">采样参数覆盖(仅调试 · 主站 UI 无此项)</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span style="color:var(--muted);">temperature</span><input data-q-temp class="dev-in" type="number" step="0.1" style="width:72px;" value="'+(typeof ovr.temp==="number"?ovr.temp:"")+'" placeholder="默认"><span style="color:var(--muted);">max_tokens</span><input data-q-max class="dev-in" type="number" style="width:90px;" value="'+(typeof ovr.maxTokens==="number"?ovr.maxTokens:"")+'" placeholder="默认"></div><div class="devx-tip">留空=不覆盖。fetch 拦截层会把这两个值追加进 /api/chat body(worker 不读则无害),用于对照同一对话不同采样下的输出。</div></div>';
  }
  function dtFault(){
    return '<div class="devx-card"><div class="devx-h">故障注入(调错误处理/重试/超时)</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><select data-fault class="dev-in"><option value="">关</option><option value="error"'+(fault==="error"?" selected":"")+'>网络中断</option><option value="http500"'+(fault==="http500"?" selected":"")+'>HTTP 500</option><option value="slow"'+(fault==="slow"?" selected":"")+'>慢响应</option></select><input data-fault-ms class="dev-in" type="number" style="width:84px;" value="'+faultMs+'"><span style="color:var(--muted);">ms</span></div>'+(fault?'<div style="color:#f66;font-size:11px;margin-top:4px;">故障注入生效中,测完记得关</div>':'')+'</div>';
  }
  function devToolsSectionHtml(){
    const style='<style>#dev-panel .devx-card{background:var(--bubble-ai,#101010);border:1px solid var(--border,#242424);border-radius:14px;padding:14px 16px;margin-bottom:12px;}#dev-panel .devx-h{font-weight:600;margin-bottom:8px;font-size:13px;letter-spacing:.01em;color:inherit;}#dev-panel .devx-tip{color:var(--muted,#8a8a8a);font-size:11px;margin-top:6px;line-height:1.55;}#dev-panel .dev-in{background:rgba(127,127,127,.1);color:inherit;border:1px solid rgba(127,127,127,.28);border-radius:8px;padding:5px 8px;font-size:12px;max-width:100%;}#dev-panel .dev-in:focus{outline:none;border-color:var(--btn-bg,#9aa3ff);}</style>';
    return '<div style="margin:4px 0 12px;padding-top:6px;font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#9a9aab);">底层调试工具 · 2026-06-15</div>'+dtSampling()+dtFault()+dtHud()+style;
  }
  function dtPlay(){
    return '<div class="devx-card"><div class="devx-h">玩法 / 容错测试</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="dev-btn" data-scene-3>造场景(3人)</button><button class="dev-btn" data-scene-relay>3人接龙</button><button class="dev-btn" data-scene-discuss>3人讨论</button><button class="dev-btn" data-chaos>混沌随机</button><button class="dev-btn" data-replay>重放上条</button></div><div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;"><span style="color:var(--muted);">故障注入</span><select data-fault class="dev-in"><option value="">关</option><option value="error"'+(fault==="error"?" selected":"")+'>网络中断</option><option value="http500"'+(fault==="http500"?" selected":"")+'>HTTP 500</option><option value="slow"'+(fault==="slow"?" selected":"")+'>慢响应</option></select><input data-fault-ms class="dev-in" type="number" style="width:74px;" value="'+faultMs+'"><span style="color:var(--muted);">ms</span></div>'+(fault?'<div style="color:#f66;font-size:11px;margin-top:4px;">故障注入生效中,测完记得关</div>':'')+'</div>';
  }
  function renderDevDynamic(p){
    const sl=p.querySelector("[data-snap-list]");
    if(sl)sl.innerHTML=snapshots.length?snapshots.map(function(s,i){return '<div style="display:flex;justify-content:space-between;gap:6px;padding:2px 0;"><span>'+esc(s.name)+' · '+new Date(s.at).toLocaleTimeString()+'</span><span><button class="dev-btn" data-snap-restore="'+i+'">回滚</button> <button class="dev-btn" data-snap-dli="'+i+'">下载</button></span></div>';}).join(""):'<span style="color:var(--muted);">暂无内存存档</span>';
    const nl=p.querySelector("[data-note-list]");const notes=notesLoad();
    if(nl)nl.innerHTML=notes.length?notes.map(function(n,i){return '<div style="display:flex;justify-content:space-between;gap:6px;padding:2px 0;border-bottom:1px solid var(--border);"><span>['+new Date(n.at).toLocaleTimeString()+'] '+esc(n.text)+'</span><button class="dev-btn" data-note-del="'+i+'">删</button></div>';}).join(""):'<span style="color:var(--muted);">还没记录</span>';
  }
  function wireDevTools(p){wireParamTools(p);wirePromptTools(p);wireSnapTools(p);wireNoteTools(p);wirePlayTools(p);wireHudTools(p);}
  function wireParamTools(p){
    p.querySelector("[data-q-model]")?.addEventListener("change",function(e){setModel(e.target.value);toast("模型→"+e.target.value,1000);});
    p.querySelector("[data-q-nsfw]")?.addEventListener("change",function(e){setNsfw(e.target.value);});
    p.querySelector("[data-q-style]")?.addEventListener("change",function(e){setReplyStyle(e.target.value);});
    p.querySelector("[data-q-think]")?.addEventListener("click",function(){clickThink();});
    p.querySelector("[data-q-strict]")?.addEventListener("change",function(e){setStrict(e.target.checked);});
    p.querySelector("[data-q-temp]")?.addEventListener("change",function(e){const v=parseFloat(e.target.value);if(isNaN(v))delete ovr.temp;else ovr.temp=v;saveOvr();});
    p.querySelector("[data-q-max]")?.addEventListener("change",function(e){const v=parseInt(e.target.value,10);if(isNaN(v))delete ovr.maxTokens;else ovr.maxTokens=v;saveOvr();});
  }
  function wirePromptTools(p){
    p.querySelector("[data-x-payload]")?.addEventListener("click",function(){if(!lastPayload){alert("还没捕获 payload");return;}const b=lastPayload.payload||{};const msgs=Array.isArray(b.messages)?b.messages:[];const lastU=(msgs.filter(function(m){return m.role==="user";}).pop()||{}).content||"";const lines=["模型: "+(b.model||"—"),"消息数: "+msgs.length,"角色卡: "+((b.characterCard&&b.characterCard.name)||b.characterCard||"—"),"关系: "+(b.relation||"—")+" 情绪: "+(b.emotion||"—"),"temperature: "+(b.temperature==null?"(默认)":b.temperature),"max_tokens: "+(b.max_tokens==null?"(默认)":b.max_tokens),"","最后一条 user: "+String(lastU).slice(0,300)];alert("🔬 payload 解析\n\n"+lines.join("\n"));});
    p.querySelector("[data-inject-save]")?.addEventListener("click",function(){const v=p.querySelector("[data-inject]").value;setInject(v);toast(v.trim()?"💉 注入已启用(走预设通道)":"已清空注入",1400);});
    p.querySelector("[data-inject-clear]")?.addEventListener("click",function(){setInject("");p.querySelector("[data-inject]").value="";toast("已清除注入",1000);});
  }
  function wireSnapTools(p){
    p.querySelector("[data-snap-take]")?.addEventListener("click",function(){const n=prompt("存档名:","存档 "+(snapshots.length+1));if(n===null)return;snapTake(n);renderDevDynamic(p);toast("📸 已存档(内存)",1000);});
    p.querySelector("[data-snap-dl]")?.addEventListener("click",function(){snapDownload(-1);});
    p.querySelector("[data-snap-up]")?.addEventListener("change",function(e){const f=e.target.files&&e.target.files[0];if(f)snapUpload(f);});
    const sl=p.querySelector("[data-snap-list]");
    if(sl)sl.addEventListener("click",function(e){const b=e.target.closest("button");if(!b)return;if(b.dataset.snapRestore!=null)snapRestore(parseInt(b.dataset.snapRestore,10));else if(b.dataset.snapDli!=null)snapDownload(parseInt(b.dataset.snapDli,10));});
  }
  function wireNoteTools(p){
    const add=function(){const inp=p.querySelector("[data-note]");if(!inp)return;noteAdd(inp.value);inp.value="";renderDevDynamic(p);};
    p.querySelector("[data-note-add]")?.addEventListener("click",add);
    p.querySelector("[data-note]")?.addEventListener("keydown",function(e){if(e.key==="Enter")add();});
    p.querySelector("[data-report-md]")?.addEventListener("click",function(){navigator.clipboard.writeText(buildReport());toast("📋 报告已复制(Markdown)",1400);});
    p.querySelector("[data-report-dl]")?.addEventListener("click",function(){const blob=new Blob([buildReport()],{type:"text/markdown"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="test-report-"+Date.now()+".md";a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},2000);});
    const nl=p.querySelector("[data-note-list]");
    if(nl)nl.addEventListener("click",function(e){const b=e.target.closest("button[data-note-del]");if(b){noteDel(parseInt(b.dataset.noteDel,10));renderDevDynamic(p);}});
  }
  function wirePlayTools(p){
    p.querySelector("[data-scene-3]")?.addEventListener("click",function(){buildScene(3,null);});
    p.querySelector("[data-scene-relay]")?.addEventListener("click",function(){buildScene(3,"relay");});
    p.querySelector("[data-scene-discuss]")?.addEventListener("click",function(){buildScene(3,"discuss");});
    p.querySelector("[data-chaos]")?.addEventListener("click",chaos);
    p.querySelector("[data-replay]")?.addEventListener("click",replay);
    p.querySelector("[data-fault]")?.addEventListener("change",function(e){fault=e.target.value||null;renderPanel();toast(fault?"🐛 故障注入:"+fault:"故障注入已关",1400);});
    p.querySelector("[data-fault-ms]")?.addEventListener("change",function(e){const v=parseInt(e.target.value,10);if(!isNaN(v))faultMs=Math.max(100,v);});
  }
  function wireHudTools(p){
    p.querySelector("[data-hud-on]")?.addEventListener("click",showHud);
    p.querySelector("[data-hud-off]")?.addEventListener("click",hideHud);
  }
  // === Dev Panel ===
  let mask=null;
  function openPanel(){
    if(mask){mask.style.display="flex";renderPanel();return;}
    mask=document.createElement("div");
    mask.id="dev-panel-mask";
    mask.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:99997;padding:20px;backdrop-filter:blur(6px);box-sizing:border-box;";
    const p=document.createElement("div");
    p.id="dev-panel";
    p.style.cssText="box-sizing:border-box;background:var(--bg,#0f0f0f);color:inherit;border:1px solid var(--border,#2a2a2a);border-radius:18px;padding:20px;max-width:760px;width:100%;max-height:85vh;overflow-y:auto;overflow-x:hidden;font-size:13px;line-height:1.6;box-shadow:0 30px 80px rgba(0,0,0,.5);font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;";
    mask.appendChild(p);
    document.body.appendChild(mask);
    mask.addEventListener("click",(e)=>{if(e.target===mask)mask.style.display="none";});
    renderPanel();
  }
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  // ===== 2026-06-15 请求 I/O 探查器渲染 =====
  function fmtBytes(n){n=n||0;if(n<1024)return n+"B";if(n<1048576)return (n/1024).toFixed(1)+"KB";return (n/1048576).toFixed(2)+"MB";}
  function kvRow(k,v){return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(127,127,127,.12);"><span style="color:var(--muted);">'+esc(k)+'</span><span style="text-align:right;word-break:break-all;max-width:62%;">'+esc(v)+'</span></div>';}
  function preBox(s,mh){return '<pre style="background:var(--bg,#000);color:inherit;padding:12px;border-radius:10px;border:1px solid var(--border,#242424);max-height:'+(mh||360)+'px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.55;font-family:ui-monospace,Menlo,Consolas,monospace;">'+esc(s)+'</pre>';}
  function estCostCNY(model,usage){try{const P=window.DEEPSEEK_PRICING||{};const p=P[model];if(!p||!usage)return null;const prompt=usage.prompt_tokens||0,comp=usage.completion_tokens||0,cached=usage.prompt_cache_hit_tokens||0;const normal=Math.max(0,prompt-cached);return (cached*(p.cache_hit||0)+normal*(p.input||0)+comp*(p.output||0))/1e6;}catch(e){return null;}}
  function inspectorBody(lp){
    if(!lp)return "";
    const tab=inspectTab,pay=lp.payload||{},dbg=lp.dbg||null;
    if(tab==="overview"){
      const u=lp.usage||null,secs=lp.ms?lp.ms/1000:0;
      let html='<div style="font-size:12px;line-height:1.6;">';
      html+=kvRow("模型",(pay.model||"—")+"  ("+(pay.mode||"?")+")");
      if(dbg)html+=kvRow("上游 / 解锁",(dbg.upstream||"?")+" · "+(dbg.unlocked?"已解锁":"锁定态"));
      html+=kvRow("思考",dbg?dbg.thinking:(pay.thinking||"—"));
      html+=kvRow("TTFB 首字节",lp.ttfb?lp.ttfb+"ms":"—");
      html+=kvRow("总耗时",lp.ms?lp.ms+"ms":(lp.done?"—":"进行中…"));
      if(u&&u.completion_tokens&&secs)html+=kvRow("输出速度",(u.completion_tokens/secs).toFixed(1)+" tok/s");
      else if(lp.content&&secs)html+=kvRow("输出速度",(lp.content.length/secs).toFixed(1)+" 字/s");
      html+=kvRow("流分块数",lp.chunks!=null?String(lp.chunks):"—");
      html+=kvRow("响应字节",fmtBytes(lp.bytes||0));
      html+=kvRow("正文 / 思考 字数",(lp.content?lp.content.length:0)+" / "+(lp.reasoning?lp.reasoning.length:0));
      if(u){
        const cached=u.prompt_cache_hit_tokens||0,prompt=u.prompt_tokens||0,rate=prompt?Math.round(cached/prompt*100):0;
        html+=kvRow("Token","prompt "+prompt+" · completion "+(u.completion_tokens||0)+" · total "+(u.total_tokens||0));
        html+=kvRow("缓存命中",cached+" / "+prompt+" prompt ("+rate+"%)");
        const c=estCostCNY(pay.model,u);if(c!=null)html+=kvRow("本条估算费用","¥"+c.toFixed(5));
      }else{html+='<div style="color:var(--muted);margin-top:6px;">usage 未捕获(免费/NVIDIA 路径常不回 usage,或仍在流式)。</div>';}
      if(dbg&&dbg.flags){const f=dbg.flags;html+='<div style="margin-top:8px;color:var(--muted);">服务端实际标志位</div>';html+=kvRow("解限底座",f.useBuiltinPersona?"ON":"OFF");html+=kvRow("NSFW / 严格RP",(f.nsfwLevel)+" / "+(f.strictRoleplay?"ON":"OFF"));html+=kvRow("强制顺从 / 风格",(f.devForceComply?"ON":"OFF")+" / "+(f.replyStyle||"default"));html+=kvRow("system 装配",dbg.sysParts+" · "+dbg.sysChars+" 字 · "+dbg.msgCount+" 条消息");}
      else{html+='<div style="margin-top:8px;color:var(--muted);">未拿到服务端装配快照(需已解锁本人;dev 面板会自动带 _debugEcho,worker 只反射不改)。</div>';}
      html+='</div>';return html;
    }
    if(tab==="request"){
      return '<div style="color:var(--muted);font-size:11px;margin-bottom:6px;">前端实际 POST /api/chat 的 body(含 dev 注入的 _debugEcho / 采样覆盖):</div>'+preBox(JSON.stringify(pay,null,2),420)+'<div style="display:flex;gap:6px;margin-top:8px;"><button class="dev-btn" data-copy-payload>复制 body JSON</button><button class="dev-btn" data-copy-curl>复制 cURL</button></div>';
    }
    if(tab==="assembled"){
      if(!dbg)return '<div style="color:var(--muted);font-size:12px;padding:12px;background:var(--bubble-ai,#0a0a0a);border-radius:10px;border:1px dashed var(--border,#333);">这条没有服务端装配快照。<br><br>真实 prompt 回显仅对「已解锁(掌握访问码)的本人」生效——dev 面板自动带 _debugEcho,worker 只反射不改任何 prompt。锁定态不下发解限底座,装配无意义故不回显。<br><br>先解锁(连点版本号 7 下输入访问码)再发一条。</div>';
      let html='<div style="color:var(--muted);font-size:11px;margin-bottom:6px;">服务端真正拼好、喂给模型的 system('+dbg.sysChars+' 字 · '+dbg.sysParts+'):</div>'+preBox(dbg.systemContent||"",300)+'<button class="dev-btn" data-copy-sys style="margin:8px 0;">复制 system</button>';
      html+='<div style="color:var(--muted);font-size:11px;margin:10px 0 6px;">最终 messages 数组('+dbg.msgCount+' 条,第 0 条即上面 system):</div><div style="display:flex;flex-direction:column;gap:6px;">';
      const msgs=Array.isArray(dbg.messages)?dbg.messages:[];
      msgs.forEach((m,i)=>{const role=(m&&m.role)||"?";const col=role==="system"?"#c39bd3":role==="user"?"#7fb3d5":role==="assistant"?"#7dcea0":"#aaa";const c=typeof m.content==="string"?m.content:JSON.stringify(m.content);html+='<details style="border:1px solid var(--border,#242424);border-radius:8px;overflow:hidden;"><summary style="padding:6px 10px;cursor:pointer;font-size:11px;"><span style="color:'+col+';font-weight:600;">#'+i+' '+esc(role)+'</span> <span style="color:var(--muted);">· '+(c?c.length:0)+' 字</span></summary>'+preBox(c||"",240)+'</details>';});
      html+='</div>';return html;
    }
    if(tab==="stream"){
      let html='<div style="color:var(--muted);font-size:11px;margin-bottom:4px;">reasoning_content 流(模型思考 · '+(lp.reasoning?lp.reasoning.length:0)+' 字):</div>'+preBox(lp.reasoning||"(无)",200);
      html+='<div style="color:var(--muted);font-size:11px;margin:10px 0 4px;">content 流(正文原始 · 未清洗 · '+(lp.content?lp.content.length:0)+' 字):</div>'+preBox(lp.content||"(无)",240);
      html+='<div style="display:flex;gap:6px;margin:8px 0;"><button class="dev-btn" data-copy-content>复制原始正文</button><button class="dev-btn" data-copy-reason>复制思考</button></div>';
      html+='<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:11px;color:var(--muted);">原始 SSE 字节流('+fmtBytes(lp.bytes||0)+' · '+(lp.chunks||0)+' 块)</summary>'+preBox((lp.raw||"").slice(0,40000),300)+'</details>';
      return html;
    }
    if(tab==="pipeline"){
      if(!window.__pipeline||!window.__pipeline.trace)return '<div style="color:var(--muted);font-size:12px;padding:12px;">清洗管线探针未就绪(app.js __pipeline 未加载)。</div>';
      if(!lp.content)return '<div style="color:var(--muted);font-size:12px;padding:12px;">这条还没有正文输出可追踪。</div>';
      let tr;try{tr=window.__pipeline.trace(lp.content,{wechat:(pay.replyStyle==="wechat")});}catch(e){return '<div style="color:#f66;">trace 失败: '+esc(String(e))+'</div>';}
      let html='<div style="color:var(--muted);font-size:11px;margin-bottom:8px;">原始正文依次跑过清洗各级——<span style="color:#e8607d;">红=该级裁掉</span>、<span style="color:#5ec98a;">绿=新增/改写</span>。重点看正文在哪一级被吃掉。</div>';
      (tr.stages||[]).forEach((s,i)=>{const dc=s.delta<0?"#e8607d":s.delta>0?"#5ec98a":"var(--muted)";html+='<div style="border:1px solid var(--border,#242424);border-radius:10px;padding:10px 12px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><span style="font-weight:600;font-size:12px;">'+i+'. '+esc(s.name)+'</span><span style="font-size:11px;color:'+dc+';">'+s.chars+' 字 ('+(s.delta>0?"+":"")+s.delta+')</span></div>';if(s.note)html+='<div style="color:var(--muted);font-size:10px;margin:2px 0 6px;">'+esc(s.note)+'</div>';if(s.removed)html+='<div style="font-size:11px;margin-top:4px;"><span style="color:#e8607d;">− 裁掉:</span> <span style="background:rgba(232,96,125,.12);padding:1px 4px;border-radius:4px;white-space:pre-wrap;word-break:break-all;">'+esc(s.removed.slice(0,600))+(s.removed.length>600?"…":"")+'</span></div>';if(s.added)html+='<div style="font-size:11px;margin-top:4px;"><span style="color:#5ec98a;">+ 新增:</span> <span style="background:rgba(94,201,138,.12);padding:1px 4px;border-radius:4px;white-space:pre-wrap;word-break:break-all;">'+esc(s.added.slice(0,600))+'</span></div>';if(s.captured)html+='<div style="font-size:11px;margin-top:4px;color:var(--muted);">↳ 归档进思考折叠块: '+esc(s.captured.slice(0,300))+(s.captured.length>300?"…":"")+'</div>';html+='</div>';});
      if(tr.inlineThink)html+='<div style="color:var(--muted);font-size:11px;margin-top:4px;">内联 think 捕获: '+esc(tr.inlineThink.slice(0,300))+(tr.inlineThink.length>300?"…":"")+'</div>';
      html+='<div style="margin-top:8px;font-size:11px;"><b>最终正文('+(tr.finalBody?tr.finalBody.length:0)+' 字)</b></div>'+preBox(tr.finalBody||"",200);
      return html;
    }
    return "";
  }
  function renderPanel(){
    const p=document.getElementById("dev-panel");
    if(!p)return;
    const lp=selectedPayload();
    const h=[];
    h.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid var(--border,#2a2a2a);padding-bottom:12px;"><h3 style="margin:0;font-size:15px;font-weight:700;letter-spacing:.02em;display:flex;align-items:center;gap:9px;color:inherit;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2-2z"/></svg>Dev Panel</h3><button data-close style="background:var(--bubble-ai,#141414);color:inherit;border:1px solid var(--border,#2a2a2a);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;">关闭</button></div>`);
    h.push(`<div style="margin-bottom:12px;padding:14px 16px;background:var(--bubble-ai,#101010);border:1px solid var(--border,#242424);border-radius:14px;"><label style="display:flex;gap:8px;align-items:center;cursor:pointer;"><input type="checkbox" ${api.debug?"checked":""} data-debug-toggle><span>Console verbose log <code style="font-size:11px;background:rgba(127,127,127,.16);padding:1px 6px;border-radius:5px;">window.__dev.debug</code></span></label></div>`);
    // 4.17: 云同步状态 + KV 配额监控
    if(window.__sync&&window.__sync.getStatus){
      const ss=window.__sync.getStatus();
      const quotaColor=ss.pushCount>=800?"#f60":ss.pushCount>=500?"#fc0":"#888";
      h.push(`<div style="margin-bottom:12px;padding:14px 16px;background:var(--bubble-ai,#101010);border:1px solid var(--border,#242424);border-radius:14px;font-size:12px;line-height:1.7;"><div style="color:inherit;font-weight:600;margin-bottom:4px;letter-spacing:.02em;">云同步状态</div><div>启用: <code>${ss.enabled?"YES":"NO"}</code> · 暂停: <code>${ss.paused?"YES":"NO"}</code> · 同步聊天: <code>${ss.includeChat?"YES":"NO"}</code></div><div>今日 push: <code style="color:${quotaColor};">${ss.pushCount}</code> / 1000 (Cloudflare KV 免费层)</div></div>`);
    }
    h.push(`<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;"><button class="dev-btn" data-export-cfw>复制 cfw_* localStorage</button><button class="dev-btn" data-export-all>复制全部 localStorage</button><button class="dev-btn danger" data-disable>关闭开发者模式</button></div>`);
    try{h.push(devToolsSectionHtml());}catch(e){}
    // ===== 2026-06-15 重做:请求级 I/O 探查器(替换旧"worker 请求记录",不再是抄酒馆的便利开关)=====
    h.push(`<div style="margin:4px 0 8px;display:flex;justify-content:space-between;align-items:center;gap:8px;"><span style="font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#9a9aab);">请求 I/O 探查 · 最近 ${payloads.length}/${MAX_PAYLOADS} 条</span>${payloads.length?`<button class="dev-btn" data-export-records style="font-size:11px;padding:4px 10px;">导出全部记录</button>`:""}</div>`);
    if(!payloads.length){
      h.push(`<div style="color:var(--muted);font-size:12px;padding:12px;background:var(--bubble-ai,#0a0a0a);border-radius:10px;border:1px dashed var(--border,#333);">暂未捕获。发一条消息后再来——只拦 /api/chat:出站 body、入站 SSE 流(逐块/TTFB/usage)、服务端真实装配、正文清洗管线。</div>`);
    }else{
      h.push(`<div data-req-list style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px;max-height:130px;overflow:auto;">`);
      for(let i=payloads.length-1;i>=0;i--){
        const e=payloads[i];
        const agoI=Math.floor((Date.now()-e.at)/1000);
        const mdl=(e.payload&&e.payload.model)||"—";
        const st=e.done?(((e.status==null?"":("HTTP "+e.status))+(e.ms?(" · "+e.ms+"ms"):"")).trim()||"完成"):"进行中…";
        const isSel=i===selPayload;
        h.push(`<button class="dev-btn" data-req="${i}" style="justify-content:space-between;${isSel?"border-color:var(--btn-bg,#9aa3ff);background:rgba(127,127,127,.24);":""}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%;">#${i+1} ${esc(String(mdl))}</span><span style="color:var(--muted);font-size:10px;white-space:nowrap;">${agoI}s · ${esc(st)}${e.dbg?" · 装配✓":""}</span></button>`);
      }
      h.push(`</div>`);
      const TABS=[["overview","概览"],["request","出站请求"],["assembled","真实Prompt"],["stream","入站流"],["pipeline","清洗管线"]];
      h.push(`<div data-itabs style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid var(--border,#242424);padding-bottom:8px;">`);
      for(const tb of TABS){h.push(`<button class="dev-btn" data-itab="${tb[0]}" style="${inspectTab===tb[0]?"border-color:var(--btn-bg,#9aa3ff);background:rgba(127,127,127,.24);font-weight:600;":""}">${tb[1]}</button>`);}
      h.push(`</div>`);
      h.push(inspectorBody(lp));
    }
    h.push(`<style>#dev-panel,#dev-panel *{box-sizing:border-box;}#dev-panel code{color:inherit;}#dev-panel select,#dev-panel input,#dev-panel textarea{max-width:100%;}#dev-panel .dev-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(127,127,127,.14);color:inherit;border:1px solid rgba(127,127,127,.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s;}#dev-panel .dev-btn:hover{background:rgba(127,127,127,.24);border-color:rgba(127,127,127,.5);}#dev-panel .dev-btn.danger{border-color:rgba(232,96,125,.4);background:rgba(232,96,125,.12);color:#e8607d;}#dev-panel .dev-btn.danger:hover{background:rgba(232,96,125,.22);border-color:rgba(232,96,125,.6);}#dev-panel input[type=checkbox]{accent-color:var(--btn-bg,#9aa3ff);}@media(max-width:640px){#dev-panel-mask{padding:0!important;align-items:stretch!important;height:100vh!important;height:100dvh!important;}#dev-panel{max-width:100%!important;width:100%!important;max-height:100vh!important;max-height:100dvh!important;height:100vh!important;height:100dvh!important;border-radius:0!important;border:none!important;padding:16px 14px calc(40px + env(safe-area-inset-bottom))!important;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}}</style>`);
    p.innerHTML=h.join("");
    try{wireDevTools(p);renderDevDynamic(p);}catch(e){console.warn("[dev] tools wire fail",e);}
    p.querySelector("[data-close]")?.addEventListener("click",()=>{mask.style.display="none";});
    p.querySelector("[data-debug-toggle]")?.addEventListener("change",(e)=>{api.debug=e.target.checked;localStorage.setItem(DBG,api.debug?"1":"0");});
    p.querySelector("[data-export-cfw]")?.addEventListener("click",()=>{const o=exportCfwLs();toast("已复制 cfw_* · "+Object.keys(o).length+" 项",1200);});
    p.querySelector("[data-export-all]")?.addEventListener("click",()=>{const o=exportAllLs();toast("已复制全部 · "+Object.keys(o).length+" 项",1200);});
    p.querySelector("[data-export-records]")?.addEventListener("click",exportAllRecords);
    p.querySelector("[data-disable]")?.addEventListener("click",()=>{if(confirm("关闭开发者模式并刷新?"))api.disable();});
    p.querySelector("[data-copy-payload]")?.addEventListener("click",()=>{navigator.clipboard.writeText(JSON.stringify(lp.payload,null,2));toast("payload 已复制",1000);});
    p.querySelector("[data-req-list]")?.addEventListener("click",(e)=>{const b=e.target.closest&&e.target.closest("button[data-req]");if(!b)return;const i=parseInt(b.dataset.req,10);if(!isNaN(i)){selPayload=i;renderPanel();}});
    p.querySelector("[data-itabs]")?.addEventListener("click",(e)=>{const b=e.target.closest&&e.target.closest("button[data-itab]");if(!b)return;inspectTab=b.dataset.itab;renderPanel();});
    p.querySelector("[data-copy-curl]")?.addEventListener("click",()=>{const b=JSON.stringify(lp.payload);const c="curl -X POST '"+location.origin+"/api/chat' -H 'content-type: application/json' --data '"+b.replace(/'/g,"'\\''")+"'";navigator.clipboard.writeText(c);toast("cURL 已复制",1000);});
    p.querySelector("[data-copy-sys]")?.addEventListener("click",()=>{navigator.clipboard.writeText((lp.dbg&&lp.dbg.systemContent)||"");toast("system 已复制",1000);});
    p.querySelector("[data-copy-content]")?.addEventListener("click",()=>{navigator.clipboard.writeText(lp.content||"");toast("原始正文已复制",1000);});
    p.querySelector("[data-copy-reason]")?.addEventListener("click",()=>{navigator.clipboard.writeText(lp.reasoning||"");toast("思考已复制",1000);});
  }

  // === 4.71: 自挂载开发者设置卡(从 index.html 收口) ===
  // index.html 仅保留 <div id="setDevSlot"></div> 空槽(dev 分类内)。
  // 槽不存在 / 已挂载 时静默跳过,兼容尚未改 index.html 的旧页面。
  function mountCard(){
    var slot=document.getElementById("setDevSlot");
    if(!slot||document.getElementById("devToolsCard"))return;
    // 卡1: 开发者面板入口
    var c1=document.createElement("div"); c1.className="card"; c1.id="devToolsCard";
    c1.setAttribute("data-dev-only","");
    c1.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2-2z"/></svg>开发者工具</h4>'
      +'<p>打开调试面板——请求 I/O 探查、故障注入、参数覆盖、prompt 透视、清洗管线追踪。顶栏 Dev 按钮<b>长按 1.5 秒</b>可关闭开发者模式。</p>'
      +'<div class="rowline"><div class="btns">'
      +'<button class="smallbtn" id="devOpenPanelBtn">打开 Dev Panel</button>'
      +'<button class="smallbtn" id="devHudOnBtn">显示 HUD</button>'
      +'<button class="smallbtn danger" id="devDisableBtn">关闭开发者模式</button>'
      +'</div></div>'
      +'<div class="settings-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg><span>长按 GitHub 按钮 1.2s 可切换开发者模式（无需打开设置）。</span></div>';
    slot.appendChild(c1);
    // 卡2: 一键导出
    var c2=document.createElement("div"); c2.className="card"; c2.id="devExportCard";
    c2.setAttribute("data-dev-only","");
    c2.innerHTML='<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V5"/><path d="M8 11l4 4 4-4"/><path d="M5 18v1.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V18"/></svg>一键导出</h4>'
      +'<p>把本地数据复制到剪贴板或下载为文件，方便迁移 / 调试 / 备份。</p>'
      +'<div class="rowline"><div class="btns">'
      +'<button class="smallbtn" id="exportCfwLsBtn">复制 cfw_* LS</button>'
      +'<button class="smallbtn" id="exportAllLsBtn">复制全部 LS</button>'
      +'<button class="smallbtn" id="exportRecordsBtn">下载 I/O 记录</button>'
      +'</div></div>';
    slot.appendChild(c2);
    // 按钮接线
    var op=document.getElementById("devOpenPanelBtn"); if(op)op.addEventListener("click",openPanel);
    var hud=document.getElementById("devHudOnBtn"); if(hud)hud.addEventListener("click",showHud);
    var dis=document.getElementById("devDisableBtn"); if(dis)dis.addEventListener("click",function(){if(confirm("关闭开发者模式并刷新?"))api.disable();});
    var ex1=document.getElementById("exportCfwLsBtn"); if(ex1)ex1.addEventListener("click",function(){var o=exportCfwLs();toast("已复制 cfw_* · "+Object.keys(o).length+" 项",1200);});
    var ex2=document.getElementById("exportAllLsBtn"); if(ex2)ex2.addEventListener("click",function(){var o=exportAllLs();toast("已复制全部 · "+Object.keys(o).length+" 项",1200);});
    var ex3=document.getElementById("exportRecordsBtn"); if(ex3)ex3.addEventListener("click",exportAllRecords);
  }

  // === Boot ===
  document.addEventListener("DOMContentLoaded",()=>{
    mountCard();
    applyVisibility();
    ensureBadge();
    wireGithubLongPress();
    wireSyncPauseBtn();
    try{if(localStorage.getItem(HUD_KEY)==="1"&&isOn())showHud();}catch(e){}
    api.log("dev.js loaded · dev mode =",isOn()?"ON":"OFF");
  });
})();