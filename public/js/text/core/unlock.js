// public/js/text/core/unlock.js — 私密解锁门 (2026-06-04)
// 默认锁定(正经态):html:not(.unlocked) 下隐藏一切 [data-nsfw]。证明掌握访问码才解锁。
// 解锁后给 <html>.unlocked + 给 /api/chat 注入 unlockToken;真正守门在 worker(isUnlocked)。
// 触发:设置底部版本号小字 #appVersionTag 连点 7 下 → 访问码弹窗 → POST /api/unlock。
(function(){
  "use strict";
  var FLAG="cfw_unlocked_v1", TOK="cfw_unlock_token_v1";
  function unlocked(){ try{ return localStorage.getItem(FLAG)==="1"; }catch(e){ return false; } }
  function tok(){ try{ return localStorage.getItem(TOK)||""; }catch(e){ return ""; } }

  (function(){
    if(!window.fetch) return;
    var orig=window.fetch.bind(window);
    window.fetch=function(input,init){
      try{
        var url=typeof input==="string"?input:(input&&input.url)||"";
        if(url.indexOf("/api/chat")>=0 && unlocked() && tok() && init && init.body){
          var b=typeof init.body==="string"?JSON.parse(init.body):init.body;
          b.unlockToken=tok();
          init=Object.assign({},init,{body:JSON.stringify(b)});
        }
      }catch(e){}
      return orig(input,init);
    };
  })();

  // 资金/云同步鉴权复用解锁码:已解锁但还没设 auth token 时,用解锁 token 回填,
  // 让资金跨设备同步开箱即用(解锁码 === CHAT_PASSWORD === /sync 鉴权 token,本就是同一个密码)。
  // 必须同步执行(在 sync.js 之前),sync.js boot 的 pullCostOnStartup 才能立刻读到 token。
  try{
    if(localStorage.getItem(FLAG)==="1" && (localStorage.getItem(TOK)||"") && !localStorage.getItem("cfw_auth_token_v1")){
      localStorage.setItem("cfw_auth_token_v1", localStorage.getItem(TOK));
    }
  }catch(e){}

  function applyVisibility(){
    var on=unlocked();
    document.documentElement.classList.toggle("unlocked",on);
    if(on) document.querySelectorAll("[data-nsfw]").forEach(function(el){ if(el.style.display==="none") el.style.display=""; });
  }

  function toast(msg){
    var t=document.createElement("div");
    t.textContent=msg;
    t.style.cssText="position:fixed;left:50%;top:24px;transform:translateX(-50%);padding:10px 18px;background:rgba(0,0,0,.88);color:#fff;border-radius:10px;font-size:13px;font-weight:600;z-index:99999;";
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); },1400);
  }

  var modal=null;
  function openPrompt(){
    if(modal){ modal.style.display="flex"; var ii=modal.querySelector("input"); if(ii){ ii.value=""; ii.focus(); } return; }
    modal=document.createElement("div");
    modal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99998;padding:20px;backdrop-filter:blur(6px);box-sizing:border-box;";
    var box=document.createElement("div");
    box.style.cssText="box-sizing:border-box;width:100%;max-width:320px;background:var(--bg,#16161e);color:inherit;border:1px solid var(--border,rgba(127,127,127,.3));border-radius:16px;padding:22px 20px;box-shadow:0 24px 60px rgba(0,0,0,.5);";
    box.innerHTML='<div style="font-size:14px;font-weight:600;margin-bottom:12px;">访问码</div><input type="password" autocomplete="off" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.1);color:inherit;font-size:14px;"><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;"><button data-c style="padding:7px 14px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:13px;cursor:pointer;">取消</button><button data-k style="padding:7px 14px;border-radius:8px;border:none;background:#9aa3ff;color:#fff;font-size:13px;cursor:pointer;">确定</button></div>';
    modal.appendChild(box);
    document.body.appendChild(modal);
    var input=box.querySelector("input"), ok=box.querySelector("[data-k]"), cancel=box.querySelector("[data-c]");
    function close(){ modal.style.display="none"; }
    function shake(){ if(box.animate) box.animate([{transform:"translateX(0)"},{transform:"translateX(-8px)"},{transform:"translateX(8px)"},{transform:"translateX(0)"}],{duration:280}); }
    function submit(){
      var v=(input.value||"").trim();
      if(!v){ shake(); return; }
      ok.disabled=true;
      fetch("/api/unlock",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:v})})
        .then(function(r){ return r.json().catch(function(){ return {ok:false}; }); })
        .then(function(d){
          ok.disabled=false;
          // 解锁成功同时写 cfw_auth_token_v1(=解锁码=CHAT_PASSWORD):让资金/云同步的 /sync 鉴权 token 一并就位,资金跨设备同步无需再单独开云同步。
          if(d&&d.ok){ try{ localStorage.setItem(FLAG,"1"); localStorage.setItem(TOK,v); localStorage.setItem("cfw_auth_token_v1",v); }catch(e){} close(); location.reload(); }
          else{ input.value=""; shake(); }
        })
        .catch(function(){ ok.disabled=false; input.value=""; shake(); });
    }
    ok.addEventListener("click",submit);
    cancel.addEventListener("click",close);
    input.addEventListener("keydown",function(e){ if(e.key==="Enter") submit(); });
    modal.addEventListener("click",function(e){ if(e.target===modal) close(); });
    input.focus();
  }

  function wireTrigger(){
    // 2026-06-04: 同时挂设置底部 #appVersionTag 与主页左侧栏底部 #appVersionTagHome,任一连点 7 下都能触发
    ["appVersionTag","appVersionTagHome"].forEach(function(id){
      var tag=document.getElementById(id);
      if(!tag||tag.dataset.wired==="1") return;
      tag.dataset.wired="1";
      var n=0,timer=null;
      tag.addEventListener("click",function(){
        n++;
        if(timer) clearTimeout(timer);
        timer=setTimeout(function(){ n=0; },1500);
        if(n>=7){ n=0; openPrompt(); }
      });
    });
  }

  function doRelock(){
    try{
      localStorage.removeItem(FLAG); localStorage.removeItem(TOK);
      var th=localStorage.getItem("cfw_theme_v1");
      if(th==="lewd-peach"||th==="lewd-doll") localStorage.setItem("cfw_theme_v1","minimal");
      localStorage.setItem("cfw_nsfw_mode_v1","0");
    }catch(e){}
    toast("已退出私密模式");
    setTimeout(function(){ location.reload(); },700);
  }
  function wireLockBtn(){
    if(!unlocked()) return;
    if(document.getElementById("relockBtn")) return;
    var b=document.createElement("button");
    b.id="relockBtn";
    // 4.71: 去掉 🔒 emoji，按钮已有 .smallbtn 样式自带锁图标语境
    b.textContent="退出私密模式";
    // 优先落进设置面板底部「关闭设置」那一行(#settingsFooter .btns):随 footer 被 index.html 的 moveToEnd 永远兜底在最底,
    // 不会被运行时 append 的图像卡挤到面板中间,用户一定找得到;退回挂在版本号小字后面只是兜底。
    var footer=document.getElementById("settingsFooter");
    var host=footer?footer.querySelector(".btns"):null;
    if(host){
      b.className="smallbtn";
      b.addEventListener("click",doRelock);
      host.insertBefore(b,host.firstChild);
      return;
    }
    var tag=document.getElementById("appVersionTag");
    if(!tag) return;
    b.style.cssText="display:block;margin:10px auto 0;padding:6px 14px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:#9aa3ff;font-size:12px;cursor:pointer;";
    b.addEventListener("click",doRelock);
    tag.parentNode.insertBefore(b,tag.nextSibling);
  }

  document.addEventListener("DOMContentLoaded",function(){
    applyVisibility(); wireTrigger(); wireLockBtn();
    // 设置面板打开时重挂退出按钮:防运行时 DOM 重排(图像卡 append / moveToEnd)后按钮丢失或被挤走
    var sb=document.getElementById("settingsBtn");
    if(sb) sb.addEventListener("click",function(){ setTimeout(wireLockBtn,120); });
  });
})();