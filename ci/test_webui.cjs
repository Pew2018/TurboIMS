const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const bridge=require("../module/webroot/bridge.js");

test("operations are whitelisted",()=>assert.throws(()=>bridge.command("reboot")));
test("arguments forbidden except save",()=>assert.throws(()=>bridge.command("apply","extra")));
test("shell injection is rejected",()=>assert.throws(()=>bridge.command("save","x'; reboot; '")));
test("base64 config is passed as a single quoted argument",()=>{
  const data=Buffer.from('{"schema":1}').toString("base64");
  assert.equal(bridge.command("save",data),
    "/system/bin/sh '/data/adb/modules/turboims_next/control.sh' save '"+data+"'");
});
test("native async callback parses JSON",async()=>{
  global.ksu={exec(cmd,opts,callback){assert.equal(opts,"{}");
    global[callback](0,'{"ok":true,"phase":"probe"}',"");}};
  const result=await bridge.call("probe");
  assert.equal(result.phase,"probe");
  assert.equal(Object.keys(global).filter(k=>k.startsWith("__turboims_cb_")).length,0);
  delete global.ksu;
});
test("nonzero exit retains structured diagnostics",async()=>{
  global.ksu={exec(cmd,opts,callback){global[callback](2,
    '{"ok":false,"phase":"waiting"}',"");}};
  await assert.rejects(bridge.call("apply"),e=>e.result.phase==="waiting");
  delete global.ksu;
});
test("missing bridge never fabricates success",async()=>{
  delete global.ksu;await assert.rejects(bridge.call("probe"),/KernelSU Next/);
});
test("malformed runner output is an error",async()=>{
  global.ksu={exec(cmd,opts,callback){global[callback](1,"","ClassNotFound");}};
  await assert.rejects(bridge.call("probe"),/ClassNotFound/);delete global.ksu;
});
test("WebUI has offline assets and no CDN dependencies",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  for(const file of ["bridge.js","feedback.js","app.js","style.css"])
    assert.ok(fs.existsSync(path.join(__dirname,"../module/webroot",file)));
  assert.ok(!/https?:\/\/|<iframe/i.test(html));
  for(const id of ["enabled","selection","interval","features","probe","apply","restore","export","refresh"])
    assert.ok(html.includes('id="'+id+'"'));
});
test("default config is deliberately paused",()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,"../module/default-config.json"),"utf8"));
  assert.equal(config.enabled,false);assert.equal(Object.keys(config.features).length,7);
});

async function appHarness() {
  const vm=require("node:vm");
  function element() {
    return {children:[], options:[], value:"", textContent:"", className:"", dataset:{}, style:{setProperty(){}},
      hidden:false, isConnected:true, checked:false, scrollTop:0,
      append(...items) { this.children.push(...items); this.options.push(...items); },
      replaceChildren(...items) { this.children=[...items]; },
      attributes:{}, setAttribute(key,value) { this.attributes[key]=value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() {}, closest:()=>null, querySelector:()=>null, querySelectorAll:()=>[] };
  }
  const elements=new Map();
  const doc={activeElement:null, body:{style:{}},
    documentElement:{dataset:{},style:{properties:{},setProperty(name,value) { this.properties[name]=value; }}},
    addEventListener() {}, createElement:element, querySelectorAll:()=>[],
    getElementById(id) {
      if(!elements.has(id)) {
        const el=element();
        if(id==="sheet")el.hidden=true;
        if(id==="selection")el.options=[{value:"all",textContent:"所有活跃 SIM"},{value:"slot:0",textContent:"SIM 卡槽 1"},{value:"slot:1",textContent:"SIM 卡槽 2"}];
        if(id==="interval")el.options=[15,30,60,120,300].map(x=>({value:String(x),textContent:x+" 秒"}));
        elements.set(id,el);
      }
      return elements.get(id);
    }};
  const calls=[];
  const listeners = new Map();
  const location = {hash:""};
  const stack = [{state:null,url:""}];
  let index = 0;
  const history = {
    get state() { return stack[index].state; },
    get length() { return stack.length; },
    replaceState(state, _, url) { stack[index] = {state,url}; location.hash = url; },
    pushState(state, _, url) { stack.splice(index+1); stack.push({state,url}); index++; location.hash = url; },
    back() { if (index) { index--; location.hash=stack[index].url; dispatch("popstate"); dispatch("hashchange"); } },
    forward() { if (index < stack.length-1) { index++; location.hash=stack[index].url; dispatch("popstate"); dispatch("hashchange"); } }
  };
  function dispatch(name) { for (const callback of listeners.get(name) || []) callback(); }
  const window = {scrollY:0,addEventListener(name,callback) {
    if (!listeners.has(name)) listeners.set(name,[]); listeners.get(name).push(callback);
  }};
  const context=vm.createContext({
    window, history, location,
    document:doc,
    TurboBridge:{call:async(action,payload)=>{calls.push([action,payload]);return {phase:"not_started"};}},
    localStorage:{getItem:()=>null,setItem(){}},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    btoa:s=>Buffer.from(s).toString("base64")
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8"),context);
  await Promise.resolve();await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
  return {context,elements,calls,doc,history,location};
}
test("native dialogs and visible browser pickers are absent",()=>{
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  assert.doesNotMatch(app,/\b(?:confirm|alert|prompt)\s*\(/);
  assert.match(html,/id="sheet"/);
  for(const id of ["selection","interval"]) {
    assert.match(html,new RegExp('id="'+id+'" class="visually-hidden"'));
    assert.match(html,new RegExp('id="'+id+'-choice"'));
  }
  for(const color of ["#2196F3","#009688"]) assert.ok(app.includes(color));
});
test("choice and appearance changes never call the privileged bridge",async()=>{
  const {elements,calls,doc}=await appHarness();
  elements.get("selection-choice").onclick();
  const options=elements.get("sheet-content").children;
  options[1].onclick();
  assert.equal(elements.get("selection").value,"slot:0");
  elements.get("theme-choice").onclick();
  elements.get("sheet-content").children[2].onclick();
  assert.equal(doc.documentElement.dataset.theme,"dark");
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("cancelled apply does not save or apply",async()=>{
  const {elements,calls,doc}=await appHarness();
  doc.getElementById("enabled").checked=true;
  const click=elements.get("apply").onclick();
  elements.get("sheet-close").onclick();
  await click;
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("OnePlus Blue defaults to a separate Classic color page",async()=>{
  const {elements,doc,calls}=await appHarness();
  assert.equal(doc.documentElement.style.properties["--accent"],"#42A5F5");
  assert.equal(elements.get("accent-label").textContent,"OnePlus Blue");
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  elements.get("accent-choice").onclick();
  assert.equal(elements.get("accent-page").hidden,false);
  assert.equal(elements.get("page-title").textContent,"强调色");
  assert.equal(elements.get("oneplus-colors").children.length,8);
  assert.ok(elements.get("material-colors").children.length>=2);
  elements.get("oneplus-colors").children[1].onclick();
  assert.equal(doc.documentElement.style.properties["--accent"],"#CC6F4E");
  elements.get("custom-hex").value="bad";
  elements.get("apply-hex").onclick();
  assert.match(elements.get("hex-error").textContent,/六位 HEX/);
  elements.get("custom-hex").value="#123456";
  elements.get("apply-hex").onclick();
  assert.equal(doc.documentElement.style.properties["--accent"],"#123456");
  elements.get("back").onclick();
  assert.equal(elements.get("appearance-page").hidden,false);
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("IMS config semantics survive preference presentation",async()=>{
  const {context,doc}=await appHarness();
  context.form({enabled:true,selection:"slot:1",interval_seconds:60,
    features:{volte:"off",vowifi:"on",vt:"default",vonr:"on",cross_sim:"off",ut:"default","5g_nr":"on"}});
  const config=context.configFromForm();
  assert.equal(config.enabled,true);
  assert.equal(config.selection,"slot:1");
  assert.equal(config.interval_seconds,60);
  assert.equal(config.features.volte,"off");
  assert.equal(config.features.vt,"default");
});
test("secondary pages preserve status and show diagnostics as selectable text",async()=>{
  const {elements,doc,calls}=await appHarness();
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  assert.equal(elements.get("home").hidden,true);
  assert.equal(elements.get("appearance-page").hidden,false);
  assert.equal(elements.get("page-title").textContent,"外观");
  elements.get("back").onclick();
  assert.equal(elements.get("settings-page").hidden,false);
  elements.get("tab-settings-page").onclick();
  elements.get("open-diagnostics").onclick();
  await elements.get("export").onclick();
  assert.match(doc.getElementById("diagnostics").textContent,/not_started/);
  assert.ok(calls.some(([action])=>action==="export"));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8"),/<textarea\b/i);
});
test("partial support is a visible warning instead of complete success",async()=>{
  const {context,elements}=await appHarness();
  context.render({ok:false,phase:"partial",subscriptions:[]});
  assert.match(elements.get("message").textContent,/部分配置/);
  assert.equal(elements.get("message").className,"");
  assert.equal(elements.get("status-indicator").dataset.tone,"warning");
});
test("per-SIM errors and unconfirmed writes remain visible",async()=>{
  const {context,elements}=await appHarness();
  context.render({ok:false,phase:"error",subscriptions:[
    {slot:0,sub_id:17,phase:"error",unsupported:[],error:"Binder denied",write_state_unknown:true},
    {slot:1,sub_id:41,phase:"verified",unsupported:[]}
  ]});
  const rows=elements.get("sims").children;
  assert.equal(rows.length,2);assert.match(rows[0].textContent,/Binder denied/);
  assert.match(rows[0].textContent,/未确认/);assert.match(rows[1].textContent,/verified/);
});
test("aggregate blocked result has a readable reason",async()=>{
  const {context,elements}=await appHarness();
  context.render({status:{phase:"error"},blocked:{phase:"ownership_lost"}});
  assert.match(elements.get("message").textContent,/自动应用已停止/);
  assert.match(elements.get("details").textContent,/ownership_lost/);
  assert.doesNotMatch(elements.get("message").textContent,/ownership_lost/);
  assert.equal(elements.get("status-indicator").dataset.tone,"danger");
  assert.doesNotMatch(elements.get("message").textContent,/undefined/);
});

test("history returns nested pages one level at a time without a duplicate root",async()=>{
  const {elements,history,location,calls}=await appHarness();
  assert.equal(history.length,1);
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  elements.get("accent-choice").onclick();
  assert.equal(location.hash,"#/accent");
  assert.equal(history.length,3);
  history.back();
  assert.equal(elements.get("appearance-page").hidden,false);
  history.back();
  assert.equal(elements.get("settings-page").hidden,false);
  assert.equal(history.state.page,"settings-page");
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("system back cancels confirmation first and never saves config",async()=>{
  const {elements,doc,history,calls}=await appHarness();
  doc.getElementById("enabled").checked=true;
  const pending=elements.get("apply").onclick();
  assert.equal(elements.get("sheet").hidden,false);
  assert.ok(history.state.dialog);
  history.back();
  await pending;
  assert.equal(elements.get("sheet").hidden,true);
  assert.equal(history.state.page,"home");
  assert.deepEqual(calls.map(([action])=>action),["status"]);
  history.forward();
  assert.equal(elements.get("sheet").hidden,true);
  assert.equal(history.state.dialog,undefined);
});
test("dialog back retains appearance and unsaved IMS selections",async()=>{
  const {elements,history,doc,calls}=await appHarness();
  doc.getElementById("volte").value="off";
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  elements.get("theme-choice").onclick();
  history.back();
  assert.equal(elements.get("appearance-page").hidden,false);
  assert.equal(elements.get("sheet").hidden,true);
  assert.equal(doc.getElementById("volte").value,"off");
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("diagnostic summary never invents success for missing capabilities",async()=>{
  const {context,elements}=await appHarness();
  context.renderDiagnosticSummary({phase:"probe",uid:0});
  const rows=elements.get("diagnostic-summary").children;
  assert.equal(rows[0].children[1].textContent,"只读检测完成");
  assert.equal(rows[5].children[1].textContent,"未取得");
  assert.equal(rows[6].children[1].textContent,"尚未检测");
});
test("normal homepage excludes technical per-SIM data and only page links have chevrons",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  const home=html.split('<main id="home"')[1].split('</main>')[0];
  assert.doesNotMatch(home,/id="sims"|subId|SDK|UID/);
  for (const id of ["probe","refresh","apply","restore","export"]) {
    const button=html.match(new RegExp('<button id="'+id+'"[^]*?</button>'))[0];
    assert.doesNotMatch(button,/chevron/);
  }
});

test("homepage summarizes detection without pretending to verify writes",async()=>{
  const {context,elements}=await appHarness();
  context.render({phase:"probe",uid:0,sdk:36,device:"husky",
    subscriptions:[{slot:0,sub_id:17,phase:"probe",unsupported:[]}]});
  assert.equal(elements.get("message").textContent,"检测完成");
  assert.match(elements.get("device").textContent,/只读检测.*尚未验证/);
  assert.equal(elements.get("sim-summary").textContent,"已检测到 SIM 卡 1");
  assert.doesNotMatch(elements.get("device").textContent,/UID|SDK|subId|husky/);
  context.render({phase:"active",write_readback_verified:false});
  assert.equal(elements.get("status-indicator").dataset.tone,"warning");
  assert.match(elements.get("device").textContent,/尚未确认写入/);
  context.render({phase:"active",write_readback_verified:true});
  assert.equal(elements.get("status-indicator").dataset.tone,"success");
  assert.match(elements.get("device").textContent,/运营商支持/);
});
test("technical failure details stay in diagnostics while home remains readable",async()=>{
  const {context,elements}=await appHarness();
  context.render({phase:"error",error:"Binder UID 0 denied",subscriptions:[]});
  assert.equal(elements.get("message").textContent,"操作失败");
  assert.doesNotMatch(elements.get("device").textContent,/Binder|UID/);
  assert.match(elements.get("details").textContent,/Binder UID 0 denied/);
  assert.equal(elements.get("status-indicator").dataset.tone,"danger");
});
test("radio selection updates both visual and accessibility state",async()=>{
  const {elements}=await appHarness();
  elements.get("selection-choice").onclick();
  const options=elements.get("sheet-content").children;
  options[1].onclick();
  assert.equal(options[1].attributes["aria-checked"],"true");
  assert.equal(options[0].attributes["aria-checked"],"false");
  assert.equal(options[1].children[0].className,"radio-mark");
});
test("probe and refresh keep their original privileged operation semantics",async()=>{
  const {elements,calls}=await appHarness();
  await elements.get("probe").onclick();
  await elements.get("refresh").onclick();
  assert.deepEqual(calls.map(([action])=>action),["status","probe","status"]);
});

test("equal root destinations replace history and retain IMS form and scroll",async()=>{
  const {elements,doc,history,calls}=await appHarness();
  assert.equal(elements.get("page-title").textContent,"IMS");
  assert.equal(elements.get("bottom-nav").hidden,false);
  assert.equal(elements.get("back").hidden,true);
  doc.getElementById("enabled").checked=true;
  doc.getElementById("volte").value="off";
  const viewport=doc.getElementById("page-content");
  viewport.scrollTop=420;
  elements.get("tab-sim-page").onclick();
  assert.equal(elements.get("sim-page").hidden,false);
  assert.equal(elements.get("page-title").textContent,"SIM 卡信息");
  assert.equal(viewport.scrollTop,0);
  elements.get("tab-settings-page").onclick();
  viewport.scrollTop=30;
  elements.get("tab-home").onclick();
  assert.equal(viewport.scrollTop,420);
  assert.equal(doc.getElementById("enabled").checked,true);
  assert.equal(doc.getElementById("volte").value,"off");
  elements.get("tab-settings-page").onclick();
  assert.equal(viewport.scrollTop,30);
  assert.equal(history.length,1);
  assert.equal(history.state.page,"settings-page");
  assert.equal(elements.get("tab-settings-page").attributes["aria-current"],"page");
  assert.equal(elements.get("tab-home").attributes["aria-current"],undefined);
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("secondary history returns to selected Settings and restores root navigation",async()=>{
  const {elements,history}=await appHarness();
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  assert.equal(elements.get("bottom-nav").hidden,true);
  assert.equal(elements.get("back").hidden,false);
  elements.get("theme-choice").onclick();
  history.back();
  assert.equal(elements.get("sheet").hidden,true);
  assert.equal(elements.get("appearance-page").hidden,false);
  history.back();
  assert.equal(elements.get("settings-page").hidden,false);
  assert.equal(elements.get("bottom-nav").hidden,false);
  assert.equal(elements.get("back").hidden,true);
  assert.equal(elements.get("tab-settings-page").attributes["aria-current"],"page");
});
test("SIM is empty and existing tools belong exclusively to Settings",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  const home=html.split('<main id="home"')[1].split('</main>')[0];
  const settings=html.split('<main id="settings-page"')[1].split('</main>')[0];
  assert.doesNotMatch(home,/open-appearance|open-diagnostics|chevron/);
  assert.match(settings,/open-appearance/);
  assert.match(settings,/open-diagnostics/);
  assert.match(html,/<main id="sim-page" class="page" hidden><\/main>/);
  const nav=html.split('<nav id="bottom-nav"')[1].split('</nav>')[0];
  assert.equal((nav.match(/<svg /g)||[]).length,3);
  assert.match(nav,/tab-home[^]*tab-sim-page[^]*tab-settings-page/);
});

test("touch feedback uses a scroll-safe slop and suppresses cancelled clicks",()=>{
  const feedback=fs.readFileSync(path.join(__dirname,"../module/webroot/feedback.js"),"utf8");
  assert.match(feedback,/TOUCH_SLOP = 14/);
  assert.match(feedback,/MOUSE_SLOP = 8/);
  assert.match(feedback,/Capture this before row handlers/);
  const style=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(style,/\[data-feedback="row"\][^}]*touch-action: pan-y/);
});

test("dark mode publishes matching WebView chrome colors",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  for (const id of ["theme-color","status-bar-color","navigation-bar-color"])
    assert.match(html,new RegExp('id="'+id+'"'));
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  assert.match(app,/chromeColor = dark \? "#121212" : "#ffffff"/);
  assert.match(app,/navigation-bar-color/);
});
test("IMS feature preferences are switch controls without feature dialogs",()=>{
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  assert.match(app,/className = "feature-switch"/);
  assert.match(app,/setAttribute\("role","switch"\)/);
  assert.match(app,/cycleFeature\(select,toggle\)/);
  assert.doesNotMatch(app,/button\.id = key\+"-choice"/);
});
test("touch ripples are deferred until a tap is confirmed",()=>{
  const feedback=fs.readFileSync(path.join(__dirname,"../module/webroot/feedback.js"),"utf8");
  assert.match(feedback,/Touch feedback is deferred until pointerup/);
  assert.match(feedback,/pointerType === "touch"/);
  assert.match(feedback,/if \(cancelled\)/);
  const style=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(style,/-webkit-overflow-scrolling: touch/);
});

test("pointer clicks have a ripple fallback when pointerup is unavailable",()=>{
  const feedback=fs.readFileSync(path.join(__dirname,"../module/webroot/feedback.js"),"utf8");
  assert.match(feedback,/Pointer-up normally creates the ripple/);
  assert.match(feedback,/pointerActivation && surface\.querySelector\("\.touch-ripple"\)/);
});
