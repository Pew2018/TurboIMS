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
  for(const id of ["enabled","selection","interval","features","probe","apply","restore","export","refresh","sim-edit-country","sim-edit-carrier","accent-scope-choice","accent-toolbar","accent-section-labels","accent-navigation-icons"])
    assert.ok(html.includes('id="'+id+'"'));
});
test("default config is deliberately paused",()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,"../module/default-config.json"),"utf8"));
  assert.equal(config.enabled,false);assert.equal(config.periodic_check_enabled,false);
  assert.equal(config.interval_seconds,1800);assert.equal(Object.keys(config.features).length,7);
});

async function appHarness() {
  const vm=require("node:vm");
  function element() {
    const el = {children:[], options:[], value:"", textContent:"", className:"", dataset:{}, style:{setProperty(){}},
      hidden:false, isConnected:true, checked:false, scrollTop:0,
      append(...items) { this.children.push(...items); this.options.push(...items); }, setSelectionRange(start,end) { this.selectionStart=start; this.selectionEnd=end; },
      replaceChildren(...items) { this.children=[...items]; },
      attributes:{}, setAttribute(key,value) { this.attributes[key]=value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() {}, closest:()=>null, querySelector:()=>null, querySelectorAll:()=>[] };
    Object.defineProperty(el,"id",{get() { return this._id; },set(id) { this._id=id; elements.set(id,this); }});
    return el;
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
        if(id==="interval")el.options=[600,1800,3600,7200].map(x=>({value:String(x),textContent:x+" 秒"}));
        elements.set(id,el);
      }
      return elements.get(id);
    }};
  const calls=[];
  const storageMap=new Map();
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
    TurboBridge:{call:async(action,payload)=>{calls.push([action,payload]);
      if(action==="save")return {ok:true,config:JSON.parse(Buffer.from(payload,"base64").toString()),phase:"saved"};
      return {phase:"not_started"};}},
    localStorage:{getItem:key=>storageMap.get(key)||null,setItem:(key,value)=>storageMap.set(key,value)},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    btoa:s=>Buffer.from(s).toString("base64"), setTimeout, clearTimeout
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
  await new Promise(resolve=>setTimeout(resolve,180));
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
test("accent colors apply immediately and extended targets stay opt-in",async()=>{
  const {elements,doc,calls}=await appHarness();
  assert.equal(doc.documentElement.style.properties["--accent"],"#42A5F5");
  assert.equal(elements.get("accent-label").textContent,"OnePlus Blue");
  assert.equal(doc.documentElement.dataset.accentToolbar,"false");
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  elements.get("accent-choice").onclick();
  assert.equal(elements.get("accent-page").hidden,false);
  assert.equal(elements.get("oneplus-colors").children.length,8);
  elements.get("oneplus-colors").children[1].onclick();
  assert.equal(doc.documentElement.style.properties["--accent"],"#CC6F4E");
  const field=elements.get("custom-hex");
  field.value="#123";field.oninput();
  assert.match(elements.get("hex-error").textContent,/6 位/);
  assert.equal(doc.documentElement.style.properties["--accent"],"#CC6F4E");
  field.value="123456";field.oninput();
  await new Promise(resolve=>setTimeout(resolve,220));
  assert.equal(doc.documentElement.style.properties["--accent"],"#123456");
  assert.equal(field.value,"#123456");
  elements.get("accent-toolbar").checked=true;elements.get("accent-toolbar").onchange();
  assert.equal(doc.documentElement.dataset.accentToolbar,"true");
  assert.equal(doc.documentElement.style.properties["--toolbar-foreground"],"#ffffff");
  elements.get("accent-navigation-icons").checked=true;elements.get("accent-navigation-icons").onchange();
  assert.equal(doc.documentElement.dataset.accentNavigationIcons,"false");
  elements.get("accent-toolbar").checked=false;elements.get("accent-toolbar").onchange();
  assert.equal(doc.documentElement.dataset.accentNavigationIcons,"true");
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("IMS config semantics survive preference presentation",async()=>{
  const {context,doc}=await appHarness();
  context.form({enabled:true,periodic_check_enabled:true,selection:"slot:1",interval_seconds:3600,
    features:{volte:"off",vowifi:"on",vt:"default",vonr:"on",cross_sim:"off",ut:"default","5g_nr":"on"}});
  const config=context.configFromForm();
  assert.equal(config.enabled,true);
  assert.equal(config.selection,"slot:1");
  assert.equal(config.interval_seconds,3600);
  assert.equal(config.periodic_check_enabled,true);
  assert.equal(config.features.volte,"off");
  assert.equal(config.features.vt,"default");
});
test("secondary pages preserve status and show diagnostics as selectable text",async()=>{
  const {elements,doc,calls}=await appHarness();
  elements.get("tab-settings-page").onclick();
  elements.get("open-appearance").onclick();
  assert.equal(elements.get("home").hidden,true);
  assert.equal(elements.get("appearance-page").hidden,false);
  assert.equal(elements.get("page-title").textContent,"TurboIMS Next");
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
  assert.equal(rows[5].children[1].textContent,"尚未启动");
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
  assert.equal(elements.get("page-title").textContent,"TurboIMS Next");
  assert.equal(elements.get("bottom-nav").hidden,false);
  assert.equal(elements.get("back").hidden,true);
  doc.getElementById("enabled").checked=true;
  doc.getElementById("volte").value="off";
  const viewport=doc.getElementById("page-content");
  viewport.scrollTop=420;
  elements.get("tab-sim-page").onclick();
  assert.equal(elements.get("sim-page").hidden,false);
  assert.equal(elements.get("page-title").textContent,"TurboIMS Next");
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
  const appearance=html.split('<main id="appearance-page"')[1].split("</main>")[0];
  assert.match(appearance,/强调色应用范围/);
  assert.match(settings,/open-diagnostics/);
  assert.match(html,/<main id="sim-page" class="page" hidden>/);
  assert.match(html, /id="sim-save"/); // SIM controls are part of the primary navigation contract
  const nav=html.split('<nav id="bottom-nav"')[1].split('</nav>')[0];
  assert.equal((nav.match(/<svg /g)||[]).length,3);
  assert.match(nav,/tab-home[^]*tab-sim-page[^]*tab-settings-page/);
});

test("SIM custom editors stay draft-only and preserve the saved schema",async()=>{
  const {context,elements,calls}=await appHarness();
  const profileConfig={schema:1,enabled:false,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    features:{volte:"default",vowifi:"default",vt:"default",vonr:"default",cross_sim:"default",ut:"default","5g_nr":"default"},
    sim_profiles:{"0":{country_iso:"TW",carrier_name:"FarEasTone"}}};
  context.render({config:profileConfig,status:{...profileConfig,phase:"probe",
    subscriptions:[{slot:0,sub_id:9,phase:"probe",effective:{sim_country_iso_override_string:"TW",carrier_name_string:"FarEasTone"}}]}},true);
  assert.equal(elements.get("sim-country-choice").textContent,"台湾 (TW)");
  assert.equal(elements.get("sim-carrier-choice").textContent,"远传电信");
  elements.get("sim-edit-country").onclick();
  let field=elements.get("sheet-content").children[0];
  field.value="1";field.oninput();
  assert.equal(elements.get("sheet-actions").children[0].disabled,true);
  assert.match(elements.get("sheet-content").children[1].textContent,/两位英文字母/);
  field.value="jp";field.oninput();assert.equal(field.value,"JP");
  elements.get("sheet-actions").children[0].onclick();
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(elements.get("sim-custom-country-value").textContent,"JP");
  assert.match(elements.get("sim-country-summary").textContent,/JP/);
  assert.equal(calls.filter(([action])=>action==="save"||action==="apply").length,0);
  elements.get("sim-edit-country").onclick();
  elements.get("sheet-actions").children[0].onclick();
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(elements.get("sim-custom-country-value").textContent,"未设置");
  assert.equal(elements.get("sim-country-choice").textContent,"台湾 (TW)");
  elements.get("sim-edit-carrier").onclick();
  field=elements.get("sheet-content").children[0];field.value="Custom Carrier";field.oninput();
  elements.get("sheet-actions").children[0].onclick();
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(elements.get("sim-custom-carrier-value").textContent,"Custom Carrier");
  elements.get("sim-edit-carrier").onclick();
  elements.get("sheet-actions").children[0].onclick();
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(elements.get("sim-custom-carrier-value").textContent,"未设置");
  assert.equal(elements.get("sim-carrier-choice").textContent,"远传电信");
  await elements.get("sim-save").onclick();
  const payload=JSON.parse(Buffer.from(calls.find(([action])=>action==="save")[1],"base64").toString());
  assert.deepEqual(payload.sim_profiles,{"0":{country_iso:"TW",carrier_name:"FarEasTone"}});
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  const sim=html.split('<main id="sim-page"')[1].split("</main>")[0];
  assert.doesNotMatch(sim,/sim-info-card|sim-custom-country\"|sim-custom-carrier\"|CarrierConfig/);
  assert.match(fs.readFileSync(path.join(__dirname,"../module/webroot/feedback.js"),"utf8"),/\.sim-edit-row/);
});
test("scroll rows have no blue WebView tap overlay and no ripple listeners",()=>{
  const feedback=fs.readFileSync(path.join(__dirname,"../module/webroot/feedback.js"),"utf8");
  assert.doesNotMatch(feedback,/document\.addEventListener\("pointer|pointermove/);
  assert.match(feedback,/Math\.abs\(scroll-tap\.scroll\)>2/);
  assert.match(feedback,/pointercancel/);
  const style=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(style,/\* \{ box-sizing:border-box; -webkit-tap-highlight-color:transparent;/);
  assert.doesNotMatch(style,/\.feature:active|\.setting-row:active/);
  assert.match(style,/-webkit-overflow-scrolling: touch/);
});

test("dark mode publishes matching WebView chrome colors",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  for (const id of ["theme-color","status-bar-color","navigation-bar-color"])
    assert.match(html,new RegExp('id="'+id+'"'));
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  assert.match(app,/chromeColor = dark \? "#121212" : "#ffffff"/);
  assert.match(app,/navigation-bar-color/);
});
test("IMS rows have only switches; Settings retains individual DEFAULT",async()=>{
  const {context,elements,doc}=await appHarness();
  const rows=elements.get("features").children;
  assert.equal(rows.length,7);
  const controls=rows[0].children[1], toggle=controls.children[0].children[0];
  assert.equal(controls.children.length,1);
  assert.equal(doc.getElementById("volte").value,"default");
  toggle.checked=true;toggle.onchange();
  assert.equal(doc.getElementById("volte").value,"on");
  toggle.checked=false;toggle.onchange();
  assert.equal(doc.getElementById("volte").value,"off");
  elements.get("tab-settings-page").onclick();
  elements.get("reset-features").onclick();
  assert.equal(elements.get("sheet-content").children[0].textContent,"VoLTE");
  elements.get("sheet-content").children[0].onclick();
  assert.equal(doc.getElementById("volte").value,"default");
  context.form({enabled:false,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    features:{volte:"off",vowifi:"on",vt:"default",vonr:"on",cross_sim:"off",ut:"default","5g_nr":"on"}});
  assert.equal(doc.getElementById("volte").value,"off");
  assert.equal(context.configFromForm().features.vt,"default");
});
test("unrelated operations preserve the disabled interval state",async()=>{
  const {elements}=await appHarness();
  assert.equal(elements.get("interval-choice").disabled,true);
  await elements.get("probe").onclick();
  assert.equal(elements.get("interval-choice").disabled,true);
});
test("schedule switch saves immediately and interval is disabled when off",async()=>{
  const {context,elements,calls,doc}=await appHarness();
  const config={enabled:true,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(key=>[key,"on"]))};
  context.form(config);
  assert.equal(elements.get("interval-choice").disabled,true);
  doc.getElementById("periodic-check").checked=true;
  await elements.get("periodic-check").onchange();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get("interval-choice").disabled,false);
  assert.equal(calls.filter(([action])=>action==="save").length,1);
  const saved=JSON.parse(Buffer.from(calls.find(([action])=>action==="save")[1],"base64").toString());
  assert.equal(saved.periodic_check_enabled,true);
  assert.equal(saved.interval_seconds,1800);
});
test("compact controls retain confirmed tap ripples without global tracking",()=>{
  const feedback=fs.readFileSync(path.join(__dirname,"../module/webroot/feedback.js"),"utf8");
  assert.match(feedback,/\.bottom-tab,\.switch-hit,\.text-action,\.choice/);
  assert.match(feedback,/\.option,\.swatch-item,\.sim-edit-row/);
  assert.match(feedback,/\.dialog-cancel/);
  assert.match(feedback,/surface\.addEventListener\("pointerup"/);
  assert.match(feedback,/Math\.hypot\(event\.clientX-tap\.x,event\.clientY-tap\.y\)>slop/);
  assert.doesNotMatch(feedback,/document\.addEventListener\("pointer|pointermove/);
  const style=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(style,/@keyframes tap-ripple/);
  assert.match(style,/\.tap-ripple/);
});
test("system bar background opts into KernelSU insets without touching core",()=>{
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  const style=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(app,/location\.hostname === "mui\.kernelsu\.org"/);
  assert.match(app,/insets\.href = "\/internal\/insets\.css"/);
  assert.match(style,/--inset-top:var\(--safe-area-inset-top/);
  assert.match(style,/--inset-bottom:var\(--safe-area-inset-bottom/);
  assert.match(style,/body::before/);
  assert.match(app,/--system-bar-bg/);
});
