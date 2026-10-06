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
// Model KernelSU Next 3.3.0 spawn events, not an instantly returning exec.
function streamHarness(spawn) {
  const vm=require("node:vm");
  const timers=new Map(); let timerId=0;
  const root={
    setTimeout(fn,ms) { const id=++timerId; timers.set(id,{fn,ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    ksu:{spawn(...args) { spawn(root,...args); },
      exec() { throw new Error("synchronous exec must never be used"); }}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../module/webroot/bridge.js"),"utf8"),root);
  return {root,timers,bridge:root.TurboBridge};
}
test("spawn streams JSON and cleans its callback after late exit/error events",async()=>{
  let receiver;
  const h=streamHarness((root,cmd,args,opts,callback)=>{
    assert.equal(cmd,"/system/bin/sh"); assert.equal(opts,"{}");
    assert.deepEqual(JSON.parse(args),["'/data/adb/modules/turboims_next/control.sh'","probe"]);
    receiver=root[callback];
    receiver.stdout.emit("data",'{"ok":true,"phase":"probe"}');
    receiver.emit("exit",0);
    receiver.emit("error",{message:"late event"});
  });
  const result=await h.bridge.call("probe");
  assert.equal(result.phase,"probe");
  assert.equal(h.timers.size,1);
  for(const {fn,ms} of h.timers.values()) {assert.equal(ms,1000);fn();}
  assert.equal(Object.keys(h.root).filter(k=>k.startsWith("__turboims_cb_")).length,0);
});
test("nonzero streamed exit retains structured diagnostics",async()=>{
  const h=streamHarness((root,cmd,args,opts,callback)=>{
    const receiver=root[callback];
    receiver.stdout.emit("data",'{"ok":false,"phase":"verification_failed"}');
    receiver.emit("exit",2);
    receiver.emit("error",{message:"must not replace the structured result"});
  });
  await assert.rejects(h.bridge.call("apply"),e=>e.result.phase==="verification_failed");
});
test("spawn joins stdout lines and safely passes base64 save arguments",async()=>{
  const payload=Buffer.from('{"carrier_name":"Chunghwa Telecom"}').toString("base64");
  const h=streamHarness((root,cmd,args,opts,callback)=>{
    assert.deepEqual(JSON.parse(args),["'/data/adb/modules/turboims_next/control.sh'","save","'"+payload+"'"]);
    root[callback].stdout.emit("data","runner diagnostic line");
    root[callback].stdout.emit("data",'{"ok":true}');
    root[callback].emit("exit",0);
  });
  assert.equal((await h.bridge.call("save",payload)).ok,true);
});
test("missing async bridge never falls back to blocking exec",async()=>{
  const h=streamHarness(()=>{throw new Error("not reached");});
  delete h.root.ksu.spawn;
  await assert.rejects(h.bridge.call("probe"),/KernelSU Next/);
});
test("malformed streamed runner output retains stderr",async()=>{
  const h=streamHarness((root,cmd,args,opts,callback)=>{
    root[callback].stderr.emit("data","ClassNotFound");
    root[callback].emit("exit",1);
  });
  await assert.rejects(h.bridge.call("probe"),/ClassNotFound/);
});
test("spawn start error is reported and a late exit cannot invent success",async()=>{
  const h=streamHarness((root,cmd,args,opts,callback)=>{
    root[callback].emit("error",{message:"root shell unavailable"});
    root[callback].stdout.emit("data",'{"ok":true}');
    root[callback].emit("exit",0);
  });
  await assert.rejects(h.bridge.call("apply"),/root shell unavailable/);
});
test("slow runner stays asynchronous and the bridge deadline outlives control.sh",async()=>{
  let receiver;
  const h=streamHarness((root,cmd,args,opts,callback)=>{receiver=root[callback];});
  const pending=h.bridge.call("apply");
  const deadline=[...h.timers.values()][0];
  assert.equal(deadline.ms,190000);
  let finished=false; pending.then(()=>{finished=true;},()=>{finished=true;});
  await Promise.resolve(); assert.equal(finished,false);
  const rejection=assert.rejects(pending,/期限内结束/);
  deadline.fn(); await rejection;
  receiver.stdout.emit("data",'{"ok":true}');
  receiver.emit("exit",0);
});
test("WebUI has offline assets and no CDN dependencies",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  for(const file of ["theme-palette.js","startup.js","bridge.js","feedback.js","app.js","style.css"])
    assert.ok(fs.existsSync(path.join(__dirname,"../module/webroot",file)));
  assert.ok(!/https?:\/\/|<iframe/i.test(html));
  for(const id of ["enabled","selection","interval","features","probe","apply","restore","export","refresh","sim-edit-country","sim-edit-carrier","accent-scope-choice","accent-toolbar","accent-section-labels","accent-navigation-icons","card-groups"])
    assert.ok(html.includes('id="'+id+'"'));
});
test("default config is deliberately paused",()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,"../module/default-config.json"),"utf8"));
  assert.equal(config.enabled,false);assert.equal(config.periodic_check_enabled,false);
  assert.equal(config.interval_seconds,1800);assert.equal(Object.keys(config.features).length,7);
});

async function appHarness(options = {}) {
  const vm=require("node:vm");
  function element() {
    const el = {children:[], options:[], value:"", textContent:"", className:"", dataset:{}, style:{setProperty(){}},
      hidden:false, isConnected:true, checked:false, scrollTop:0,
      append(...items) { this.children.push(...items); this.options.push(...items); }, setSelectionRange(start,end) { this.selectionStart=start; this.selectionEnd=end; }, blur() {},
      replaceChildren(...items) { this.children=[...items]; },
      attributes:{}, setAttribute(key,value) { this.attributes[key]=value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() {}, closest:()=>null, querySelector:()=>null, querySelectorAll:()=>[], scrollIntoView() {} };
    Object.defineProperty(el,"id",{get() { return this._id; },set(id) { this._id=id; elements.set(id,this); }});
    return el;
  }
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  const declaredIds=new Set([...html.matchAll(/id=["']([^"']+)["']/g)].map(match=>match[1]));
  const elements=new Map();
  const doc={activeElement:null, body:{style:{}},
    documentElement:{dataset:{},style:{properties:{},setProperty(name,value) { this.properties[name]=value; },removeProperty(name) { delete this.properties[name]; }}},
    addEventListener() {}, createElement:element, querySelectorAll:()=>[],
    getElementById(id) {
      if(!elements.has(id)) {
        if(options.strictIds && !declaredIds.has(id)) return null;
        const el=element();
        el.id=id;
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
  const window = {scrollY:0,innerHeight:600,addEventListener(name,callback) {
    if (!listeners.has(name)) listeners.set(name,[]); listeners.get(name).push(callback);
  }};
  const context=vm.createContext({
    window, history, location,
    document:doc,
    TurboBridge:{call:async(action,payload)=>{calls.push([action,payload]);
      if(action==="status") return options.initialStatus || {ok:true,phase:"not_started",session:"test-boot",time_ms:1000,
        config:{schema:1,enabled:true,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
          implementation_mode:"turboims",sim_profiles:{},
          features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(k=>[k,"default"]))},
        subscriptions:[{slot:0,sub_id:1,phase:"verified"}]};
      if(action==="save")return {ok:true,config:JSON.parse(Buffer.from(payload,"base64").toString()),phase:"saved"};
      return {phase:"not_started"};}},
    localStorage:{getItem:key=>storageMap.get(key)||null,setItem:(key,value)=>storageMap.set(key,value)},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    btoa:s=>Buffer.from(s).toString("base64"), setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../module/webroot/theme-palette.js"),"utf8"),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../module/webroot/startup.js"),"utf8"),context);
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
test("IMS mode radio choice displays exact option labels and description",async()=>{
  const {context,elements,calls}=await appHarness();
  const config={schema:1,enabled:false,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    implementation_mode:"turboims",features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(k=>[k,"default"]))};
  elements.get("implementation_mode").options=[
    {value:"turboims",textContent:"TurboIMS"},{value:"carrier_ims",textContent:"Carrier IMS"}];
  context.form(config);
  assert.equal(elements.get("implementation-mode-choice").textContent,"TurboIMS");
  assert.equal(elements.get("implementation-mode-description").textContent,"使用 TurboIMS 原有配置路径，检查 IMS 注册。");
  elements.get("implementation-mode-choice").onclick();
  const choices=elements.get("sheet-content").children;
  assert.deepEqual(choices.map(button=>button.textContent.replace("✓","").trim()),["TurboIMS","Carrier IMS"]);
  choices[1].onclick();
  assert.equal(elements.get("implementation_mode").value,"carrier_ims");
  assert.equal(elements.get("implementation-mode-choice").textContent,"Carrier IMS");
  assert.equal(elements.get("implementation-mode-description").textContent,"验证配置后重置 IMS 并检查注册，默认保留真实 SIM 身份。");
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
  assert.equal(doc.documentElement.style.properties["--toolbar-foreground"],"#FFFFFF");
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
  assert.match(rows[0].textContent,/未确认/);assert.match(rows[1].textContent,/已验证/);
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
  assert.deepEqual(elements.get("ims-registration").children.map(row => row.children[0].textContent),["SIM 卡 1"]);
  assert.doesNotMatch(elements.get("device").textContent,/UID|SDK|subId|husky/);
  context.render({phase:"active",write_readback_verified:false});
  assert.equal(elements.get("status-indicator").dataset.tone,"warning");
  assert.match(elements.get("device").textContent,/尚未确认写入/);
  context.render({phase:"active",write_readback_verified:true});
  assert.equal(elements.get("status-indicator").dataset.tone,"success");
  assert.equal(elements.get("message").textContent,"IMS 配置已验证");
  assert.equal(elements.get("device").textContent,"");
  assert.equal(elements.get("device").hidden,true);
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

test("SIM text editors use secondary pages, validate inputs, and keep edits draft-only",async()=>{
  const {context,elements,calls,history}=await appHarness();
  const profileConfig={schema:1,enabled:false,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    features:{volte:"default",vowifi:"default",vt:"default",vonr:"default",cross_sim:"default",ut:"default","5g_nr":"default"},
    sim_profiles:{"0":{country_iso:"TW",carrier_name:"FarEasTone"}}};
  context.render({config:profileConfig,status:{...profileConfig,config:profileConfig,phase:"probe",
    subscriptions:[{slot:0,sub_id:9,phase:"probe",effective:{sim_country_iso_override_string:"TW",carrier_name_string:"FarEasTone"}}]}},true);
  elements.get("tab-sim-page").onclick();
  assert.equal(elements.get("sim-country-choice").textContent,"台湾 (TW)");
  assert.equal(elements.get("sim-carrier-choice").textContent,"远传电信");
  elements.get("sim-edit-country").onclick();
  assert.equal(elements.get("text-editor-page").hidden,false);
  assert.equal(elements.get("sheet").hidden,true);
  assert.equal(elements.get("page-title").textContent,"自定义国家码");
  let field=elements.get("text-editor-input");
  field.value="1";field.oninput();
  assert.equal(elements.get("text-editor-save").disabled,true);
  assert.match(elements.get("text-editor-error").textContent,/两个英文字母/);
  field.value="jp";field.oninput();assert.equal(field.value,"JP");
  history.back();
  assert.equal(elements.get("sim-page").hidden,false);
  assert.equal(elements.get("sim-custom-country-value").textContent,"未设置");
  elements.get("sim-edit-country").onclick();
  field=elements.get("text-editor-input");field.value="jp";field.oninput();
  elements.get("text-editor-save").onclick();
  assert.equal(elements.get("sim-custom-country-value").textContent,"JP");
  assert.equal(calls.filter(([action])=>action==="save"||action==="apply").length,0);
  elements.get("sim-edit-country").onclick();
  const clear=elements.get("text-editor-actions").children.find(button=>button.textContent==="清除");
  clear.onclick();
  assert.equal(elements.get("sim-custom-country-value").textContent,"未设置");
  assert.equal(elements.get("sim-country-choice").textContent,"台湾 (TW)");
  elements.get("sim-edit-carrier").onclick();
  field=elements.get("text-editor-input");field.value="Custom Carrier";field.oninput();
  elements.get("text-editor-save").onclick();
  assert.equal(elements.get("sim-custom-carrier-value").textContent,"Custom Carrier");
  elements.get("sim-edit-carrier-test-mccmnc").onclick();
  field=elements.get("text-editor-input");
  assert.equal(field.inputMode,"numeric");
  field.value="46a6928";field.oninput();
  assert.equal(field.value,"466928");
  assert.equal(elements.get("text-editor-save").disabled,false);
  field.value="4669";field.oninput();
  assert.equal(elements.get("text-editor-save").disabled,true);
  assert.match(elements.get("text-editor-error").textContent,/5 或 6 位/);
  field.value="46692";field.oninput();
  elements.get("text-editor-save").onclick();
  assert.equal(elements.get("sim-carrier-test-mccmnc-value").textContent,"46692");
  await elements.get("sim-save").onclick();
  const payload=JSON.parse(Buffer.from(calls.find(([action])=>action==="save")[1],"base64").toString());
  assert.deepEqual(payload.sim_profiles,{"0":{country_iso:"TW",carrier_name:"Custom Carrier",carrier_test_mccmnc:"46692",carrier_test_enabled:false}});
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
  assert.match(app,/chromeColor = dark \? "#121212" : "#FFFFFF"/);
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
  assert.match(app,/--system-status-bg/);
});

test("appearance refinements are opt-in and preserve current actions",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(html,/id="card-groups"[^>]*role="switch"/);
  assert.match(app,/turboims-card-groups","false"/);
  assert.match(html,/id="apply" class="action-button action-button--primary"/);
  assert.match(html,/id="sim-save" class="action-button action-button--primary"/);
  assert.ok(app.includes('visualViewport.addEventListener("resize",updateWebViewViewport)'));
  assert.match(css,/100dvh/);
  assert.match(css,/\.text-editor-input:focus/);
  assert.match(app,/system-status-bg/);
  assert.match(app,/const statusColor = toolbarColor/);
  assert.ok(css.includes(':root[data-card-groups="true"] .pref-group'));
  assert.match(css,/system-navigation-bg/);
  const settings=html.split('<main id="settings-page"')[1].split("</main>")[0];
  const home=html.split('<main id="home"')[1].split("</main>")[0];
  assert.ok(home.includes('id="device-heading"'));
  assert.ok(home.includes("IMS 注册状态"));
  assert.ok(!settings.includes('id="device-heading"'));
  assert.match(home,/option value="turboims">TurboIMS</);
  assert.match(home,/option value="carrier_ims">Carrier IMS</);
  assert.doesNotMatch(home,/TurboIMS（当前 KSU）/);
  assert.match(fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8"),/\.text-editor-input/);
  assert.ok(!settings.includes("IMS 实现模式"));
});

test("startup uses only preference buttons declared in WebUI markup",async()=>{
  const {calls}=await appHarness({strictIds:true});
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});

test("initial view stays clean until status succeeds or fails",async()=>{
  for (const fail of [false,true]) {
    let resolve,reject;
    const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const {doc,context,calls}=await appHarness({initialStatus:pending});
    assert.notEqual(doc.documentElement.dataset.loading,"false");
    assert.deepEqual(calls.map(([action])=>action),["status"]);
    if(fail)reject(new Error("bridge unavailable"));
    else resolve({phase:"not_started"});
    await new Promise(yes=>setImmediate(yes));
    assert.equal(doc.documentElement.dataset.loading,fail ? "error" : "false");
    assert.equal(require("node:vm").runInContext("busy",context),false);
    assert.deepEqual(calls.map(([action])=>action),["status"]);
  }
});
test("operation buttons use short single-line labels and retain separate actions",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  for(const [id,label] of Object.entries({apply:"应用配置",restore:"停止并恢复","sim-save":"应用信息","sim-restore":"恢复原值"})){
    const button=html.match(new RegExp('<button id="'+id+'"[^>]*>([\\s\\S]*?)</button>'))[0];
    assert.ok(button.includes("action-button"));
    assert.ok(button.includes(label));
    assert.doesNotMatch(button,/<small/);
    assert.ok(label.length>=4 && label.length<=5);
  }
});
test("semantic roles meet contrast in light, dark and system modes without changing seeds or bridge calls",async()=>{
  const {context,doc,calls}=await appHarness();
  const vm=require("node:vm");
  const colors=vm.runInContext('[...onePlusColors,...materialColors].map(x=>x[1])',context);
  colors.push("#FFFFFF","#000000","#FFFF00","#00FF00","#00FFFF","#FF00FF",
    "#FF0000","#0000FF","#808080","#F5F5F5","#212121","#777777","#123456");
  for(let v=0;v<=255;v+=17)colors.push("#"+v.toString(16).padStart(2,"0").repeat(3).toUpperCase());
  const lum=hex=>{
    const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return c[0]*.2126+c[1]*.7152+c[2]*.0722;
  };
  const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  for(const mode of ["light","dark","system"])for(const color of colors){
    context.testAccent=color;context.testTheme=mode;
    vm.runInContext('accent=testAccent;themeMode=testTheme;accentToolbar=true;showAppearance();',context);
    const p=doc.documentElement.style.properties, dark=doc.documentElement.dataset.theme==="dark";
    assert.equal(p["--accent"],color);assert.equal(p["--accent-seed"],color);
    assert.ok(["#FFFFFF","#000000"].includes(p["--toolbar-foreground"]));
    assert.equal(p["--toolbar-foreground"],p["--on-primary"]);
    for(const [fg,bg] of [
      ["--on-primary","--primary-surface"],["--on-primary","--primary-surface-pressed"],
      ["--on-accent","--action-fill"],["--on-accent","--action-primary-pressed"],
      ["--on-action-tonal","--action-tonal"],["--on-action-tonal","--action-tonal-pressed"]
    ]) assert.ok(ratio(p[fg],p[bg])>=4.5,mode+" "+color+" "+fg+"/"+bg);
    for(const bg of dark ? ["#121212","#202020","#212121"] : ["#FFFFFF","#FAFAFA","#EEEEEE"]){
      assert.ok(ratio(p["--accent-ink"],bg)>=4.5,mode+" "+color+" category");
      assert.ok(ratio(p["--control-accent"],bg)>=3,mode+" "+color+" control");
      assert.ok(ratio(p["--switch-on-thumb"],bg)>=3,mode+" "+color+" switch thumb");
    }
    for(const bg of dark ? ["#121212","#212121"] : ["#FFFFFF"]){
      assert.ok(ratio(p["--bottom-active-label"],bg)>=4.5,mode+" "+color+" nav label");
      assert.ok(ratio(p["--bottom-active-icon"],bg)>=3,mode+" "+color+" nav icon");
    }
    assert.ok(ratio(p["--accent-text"],color)>=4.5,color+" picker");
    assert.ok(p["--switch-on-track"].endsWith(",.50)"));
    assert.equal(p["--system-status-bg"],p["--toolbar-tint"]);
    assert.equal(doc.documentElement.dataset.statusBarIcons,p["--on-primary"]==="#000000"?"dark":"light");
    assert.equal(Number(p["--toolbar-contrast"]),Number(ratio(p["--on-primary"],p["--toolbar-tint"]).toFixed(3)));
    assert.equal(Number(p["--on-accent-contrast"]),Number(ratio(p["--on-accent"],p["--action-fill"]).toFixed(3)));
  }
  // Deterministic broad RGB sample: chroma clipping and extremes must still meet
  // final quantized sRGB contrast, without mutating UI or stored preferences.
  vm.runInContext('var paletteSample=0x13579B;',context);
  for(let i=0;i<512;i++){
    const result=vm.runInContext('(paletteSample=(1664525*paletteSample+1013904223)>>>0,generateThemePalette("#"+(paletteSample&0xFFFFFF).toString(16).padStart(6,"0"),'+(i%2===0)+'))',context);
    assert.ok(ratio(result.onPrimary,result.primarySurface)>=4.5);
    assert.ok(ratio(result.onActionPrimary,result.actionPrimaryPressed)>=4.5);
    assert.ok(ratio(result.onActionSecondary,result.actionSecondary)>=4.5);
    assert.ok(ratio(result.onActionSecondary,result.actionSecondaryPressed)>=4.5);
  }
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("classic geometry and role routing avoid raw seed accents on semantic controls",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(css,/--appbar-height:56px/);assert.match(css,/--bottom-nav-height:56px/);
  assert.match(css,/\.toolbar-inner \{[^}]*padding:0 16px; gap:16px/);
  assert.match(css,/\.bottom-tab svg \{ width:24px; height:24px/);
  assert.match(css,/aria-current="page"\] \{ color:var\(--bottom-active-label\)/);
  assert.match(css,/aria-current="page"\] svg \{ color:var\(--bottom-active-icon\)/);
  assert.match(css,/\.action-button:lang\(zh\)[^{]*\{ font-size:15px; font-weight:500/);
  assert.match(css,/--switch-off-track:rgba\(0,0,0,.38\)/);
  assert.match(css,/input\[role="switch"\]:disabled \{ opacity:1; background:var\(--switch-disabled-track\)/);
  for(const selector of [".action-button--primary:active",".action-button--secondary:active"]){
    const rule=css.slice(css.indexOf(selector)).split("}")[0];
    assert.equal(/(?:^|;)\s*color:/.test(rule),false,"pressed must never override foreground");
  }
});

test("toolbar title and contained button retain classic Material emphasis",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  assert.match(css,/\.toolbar h1 \{[^}]*font-size:20px;[^}]*font-weight:500;/);
  assert.match(css,/\.action-button \{[\s\S]*font:500 14px\/1\.2/);
  assert.match(css,/\.action-button--primary \{[\s\S]*color:var\(--on-accent\)/);
});

test("IMS home shows config and actual registration states separately",async()=>{
  const {context,elements}=await appHarness();
  const config={schema:1,enabled:true,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    implementation_mode:"carrier_ims",features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(k=>[k,"on"]))};
  context.render({config,status:{...config,config,phase:"active",write_readback_verified:true,
    subscriptions:[
      {slot:0,sub_id:1,phase:"verified",ims:{slot:0,sub_id:1,phase:"ims_registered",registered:true}},
      {slot:1,sub_id:2,phase:"verified",ims:{slot:1,sub_id:2,phase:"ims_not_registered",registered:false}}
    ]}},true);
  const status=elements.get("ims-registration").children;
  assert.equal(status.length,2);
  assert.equal(status[0].children[0].textContent,"SIM 卡 1");
  assert.equal(status[0].children[1].textContent,"已注册");
  assert.equal(status[1].children[1].textContent,"未注册");
  assert.equal(elements.get("message").textContent,"IMS 配置已验证");
  context.render({config:{...config,implementation_mode:"turboims"},status:{...config,implementation_mode:"turboims",
    config:{...config,implementation_mode:"turboims"},phase:"active",subscriptions:[{slot:0,sub_id:1,
      ims:{slot:0,sub_id:1,phase:"ims_registered",registered:true}}]}},true);
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"已注册");
  context.render({implementation_mode:"turboims",phase:"probe",subscriptions:[{slot:0,sub_id:1}]});
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"未查询");
});
test("Device status is on IMS home and Settings stays focused",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  const settings=html.split('<main id="settings-page"')[1].split("</main>")[0];
  const home=html.split('<main id="home"')[1].split("</main>")[0];
  assert.ok(home.indexOf('id="device-heading"') < home.indexOf("IMS 模式"));
  assert.ok(home.indexOf("IMS 模式") < home.indexOf("自动配置"));
  assert.ok(home.indexOf("自动配置") < home.indexOf("IMS 功能"));
  assert.ok(home.indexOf("IMS 功能") < home.indexOf("操作"));
  assert.equal(settings.includes('id="sim-status-heading"'),false);
  assert.equal(settings.includes('id="sim-status-title"'),false);
  const java=fs.readFileSync(path.join(__dirname,"../root-runner/src/main/java/io/github/turboims/ksu/ModuleMain.java"),"utf8");
  const backend=fs.readFileSync(path.join(__dirname,"../root-runner/src/main/java/io/github/turboims/ksu/AndroidCarrierBackend.java"),"utf8");
  assert.match(java,/New bottom-layer feature: this path only reads/);
  assert.match(java,/\.put\("sim_cards", simCards\(\)\)/);
  assert.match(backend,/public Map<String, String> simIdentity/);
});
test("secondary page actions use accent-tonal surface",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  assert.match(css,/action-button--secondary[\s\S]*background:var\(--action-tonal\)/);
  assert.match(app,/--action-tonal/);
});

test("pending operation keeps its button label and navigation responsive",async()=>{
  const {context,elements,doc,history}=await appHarness();
  const apply=doc.getElementById("apply");
  apply.textContent="应用配置";
  const tab=doc.getElementById("tab-settings-page");
  doc.querySelectorAll=selector=>selector==="button,input,select" ? [apply,tab] : [];
  let finish; const wait=new Promise(resolve=>{finish=resolve;});
  const task=context.operation(()=>wait,"正在处理…",apply);
  assert.equal(apply.textContent,"应用配置");
  assert.equal(apply.disabled,true); assert.notEqual(tab.disabled,true);
  tab.onclick(); assert.equal(history.state.page,"settings-page");
  finish(); await task;
  assert.equal(apply.disabled,false); assert.equal(apply.textContent,"应用配置");
});
test("failed operation releases controls and preserves structured failure details",async()=>{
  const {context,doc}=await appHarness();
  const apply=doc.getElementById("apply");
  apply.textContent="应用配置";
  doc.querySelectorAll=selector=>selector==="button,input,select" ? [apply] : [];
  const error=new Error("changed after verification");
  error.result={ok:false,phase:"verification_failed",subscriptions:[{slot:0,
    verification_mismatches:{carrier_nr_availabilities_int_array:{expected:[1,2],actual:[1]}}}]};
  await context.operation(async()=>{throw error;},"正在处理…",apply);
  assert.equal(apply.disabled,false); assert.equal(apply.textContent,"应用配置");
  assert.match(doc.getElementById("details").textContent,/verification_mismatches/);
});

test("verified settings and absent registration remain separate in WebUI",async()=>{
  const {context,elements}=await appHarness();
  context.render({ok:false,phase:"ims_not_registered",configuration_applied:true,
    write_readback_verified:true,sim_profiles_verified:true,implementation_mode:"carrier_ims",
    subscriptions:[{slot:0,sub_id:1,phase:"unchanged",unsupported:[],conflicts:[],
      ims:{slot:0,sub_id:1,phase:"ims_not_registered",registered:false}}]});
  assert.equal(elements.get("message").textContent,"配置已应用，IMS 尚未注册");
  assert.equal(elements.get("status-indicator").dataset.tone,"warning");
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"未注册");
  assert.match(elements.get("details").textContent,/"ok": false/);
  context.render({ok:false,phase:"superseded",requires_manual_retry:false});
  assert.equal(elements.get("message").textContent,"设置已更新");
  assert.equal(elements.get("status-indicator").dataset.tone,"neutral");
});

test("legacy test PLMN and stored drafts never auto-enable identity after upgrade",async()=>{
  const {context,elements,calls}=await appHarness();
  const config={schema:1,enabled:true,periodic_check_enabled:false,selection:"all",interval_seconds:600,
    implementation_mode:"carrier_ims",
    features:{volte:"on",vowifi:"on",vt:"on",vonr:"on",cross_sim:"on",ut:"on","5g_nr":"on"},
    sim_profiles:{"0":{country_iso:"tw",carrier_name:"Chunghwa Telecom",carrier_test_mccmnc:"46692"}}};
  context.render({config,status:{config,phase:"active",
    subscriptions:[{slot:0,sub_id:1,phase:"verified",effective:{}}]}},true);
  assert.equal(elements.get("sim-carrier-test-enabled").checked,false);
  await elements.get("sim-save").onclick();
  const first=JSON.parse(Buffer.from(calls.find(([action])=>action==="save")[1],"base64").toString());
  assert.equal(first.sim_profiles["0"].carrier_test_enabled,false);
  assert.equal(first.sim_profiles["0"].country_iso,"TW");
  assert.equal(first.sim_profiles["0"].carrier_name,"Chunghwa Telecom");
  elements.get("sim-carrier-test-enabled").checked=true;
  elements.get("sim-carrier-test-enabled").onchange();
  assert.equal(context.simEffectiveProfiles()["0"].carrier_test_enabled,true);
  context.simSetCustom("carrier_test_mccmnc","");
  assert.equal(elements.get("sim-carrier-test-enabled").checked,false);
  assert.equal(context.simEffectiveProfiles()["0"].carrier_test_mccmnc,undefined);
});
test("native display presets do not invent a test MCC/MNC",async()=>{
  const {context}=await appHarness();
  context.simSetPreset("country_preset","TW");
  context.simSetPreset("carrier_preset","Chunghwa Telecom");
  const profile=context.simEffectiveProfiles()["0"];
  assert.equal(profile.country_iso,"TW"); assert.equal(profile.carrier_name,"Chunghwa Telecom");
  assert.equal(profile.carrier_test_mccmnc,undefined);
  assert.notEqual(profile.carrier_test_enabled,true);
});
test("TurboIMS renders actual registration without requiring Carrier IMS mode",async()=>{
  const {context,elements}=await appHarness();
  context.render({phase:"ims_not_registered",ok:false,implementation_mode:"turboims",
    configuration_applied:true,ims_results:[{slot:0,sub_id:1,phase:"ims_not_registered",registered:false}],
    subscriptions:[{slot:0,sub_id:1,phase:"verified"}]});
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"未注册");
  assert.equal(elements.get("message").textContent,"配置已应用，IMS 尚未注册");
});
test("unknown legacy native identity is surfaced as a reboot requirement",async()=>{
  const {context,elements}=await appHarness();
  context.render({ok:false,phase:"carrier_test_cleanup_requires_reboot",requires_reboot:true});
  assert.equal(elements.get("message").textContent,"需要重启清理旧测试身份");
});

test("NR partial configuration preserves registered IMS and independent component results",async()=>{
  const {context,elements}=await appHarness({strictIds:true});
  context.render({status:{phase:"configured_partial",ok:true,
    configuration_partial:true,configuration_applied:false,write_readback_verified:false,
    ims_configuration_verified:true,sim_profiles_verified:true,nr_configuration_verified:false,
    ims_registration_verified:true,ims_registration_state:"verified",
    subscriptions:[{slot:0,sub_id:1,phase:"configured_partial",configuration_partial:true,
      verification_mismatches:{carrier_nr_availabilities_int_array:{expected:[1,2],actual:[1]}},
      ims:{registered:true,phase:"ims_registered"}}]}});
  assert.equal(elements.get("message").textContent,"NR 配置部分生效");
  assert.equal(elements.get("status-indicator").dataset.tone,"warning");
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"已注册");
  const components=elements.get("component-verification").children.map(row=>row.children.map(el=>el.textContent));
  assert.deepEqual(components[0],["IMS 配置","核对通过"]);
  assert.deepEqual(components[1],["SIM 信息","核对通过"]);
  assert.deepEqual(components[2],["5G NR 配置","部分生效"]);
  assert.match(components[3][1],/请求 \[1,2\] · 读回 \[1\]/);
  assert.match(elements.get("details").textContent,/"write_readback_verified": false/);
});
test("read-only registration remains registered without claiming a completed write",async()=>{
  const {context,elements}=await appHarness();
  context.render({phase:"probe",ok:true,action:"probe",configuration_applied:false,
    ims_registration_verified:false,ims_registration_state:"observed_registered",
    ims_configuration_verified:true,sim_profiles_verified:true,nr_configuration_verified:true,
    ims_results:[{slot:0,sub_id:1,registered:true,phase:"ims_registered"}]});
  assert.equal(elements.get("message").textContent,"检测完成");
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"已注册");
  const summary=elements.get("diagnostic-summary").children.map(row=>row.children.map(el=>el.textContent).join(":")).join("\n");
  assert.match(summary,/只读采样已注册/);
  assert.match(elements.get("details").textContent,/"configuration_applied": false/);
});
test("NR partial warning cannot hide real registration or other configuration failures",async()=>{
  const {context,elements}=await appHarness();
  context.render({phase:"ims_not_registered",ok:false,configuration_partial:true,
    ims_configuration_verified:true,sim_profiles_verified:true,nr_configuration_verified:false,
    ims_results:[{slot:0,sub_id:1,registered:false,phase:"ims_not_registered"}]});
  assert.equal(elements.get("message").textContent,"IMS 尚未注册");
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"未注册");
  context.render({status:{phase:"verification_failed",ims_configuration_verified:false,
    sim_profiles_verified:true,nr_configuration_verified:false,
    ims_results:[{slot:0,sub_id:1,registered:true,phase:"ims_registered"}]},
    blocked:{phase:"verification_failed"}});
  assert.equal(elements.get("message").textContent,"验证失败");
  assert.equal(elements.get("status-indicator").dataset.tone,"danger");
  assert.equal(elements.get("ims-registration").children[0].children[1].textContent,"已注册");
  assert.equal(elements.get("component-verification").children[1].children[1].textContent,"核对通过");
});

test("foreground feedback lasts until command verification completes, unrelated browsing stays available",async()=>{
  const {context,doc,elements}=await appHarness();
  const apply=doc.getElementById("apply"),theme=doc.getElementById("theme-choice");
  doc.querySelectorAll=s=>s==="button,input,select" ? [apply,theme] : [];
  let done;const waiting=new Promise(r=>done=r);
  const work=context.operation(()=>waiting,"正在应用 IMS 配置…",apply,"ims-apply");
  assert.equal(elements.get("ims-task").hidden,false);
  assert.equal(elements.get("ims-task-progress").hidden,false);
  assert.equal(elements.get("ims-task").attributes["aria-busy"],"true");
  assert.equal(apply.disabled,true);assert.notEqual(theme.disabled,true);
  context.navigate("settings-page");
  assert.equal(elements.get("ims-task").dataset.visible,"false");
  context.navigate("home");
  assert.equal(elements.get("ims-task").dataset.visible,"true");
  done({ok:true,phase:"verified",ims_configuration_verified:true});await work;
  assert.equal(elements.get("ims-task-progress").hidden,true);
  assert.equal(elements.get("ims-task").attributes["aria-busy"],"false");
  assert.equal(elements.get("ims-task-status").textContent,"IMS 配置已应用");
  assert.equal(apply.disabled,false);
});
test("four actions expose accurate start, success and failure without changing switch positions",async()=>{
  for (const kind of ["ims-apply","ims-restore","sim-apply","sim-restore"]) {
    const {context,doc}=await appHarness();
    const prefix=kind.startsWith("sim")?"sim":"ims";
    const checked=doc.getElementById("enabled").checked;
    const task=context.beginTask(kind);
    assert.match(doc.getElementById(prefix+"-task-status").textContent,/正在/);
    context.finishTask(task,{ok:true,ims_configuration_verified:true,sim_profiles_verified:true,
      subscriptions:[{slot:0,phase:"restored",sim_profiles_verified:true}]});
    assert.match(doc.getElementById(prefix+"-task-status").textContent,/已应用|已恢复/);
    assert.equal(doc.getElementById(prefix+"-task-progress").hidden,true);
    const failed=context.beginTask(kind);
    context.finishTask(failed,{ok:false,phase:"verification_failed",subscriptions:[{slot:0,error:"denied"}]},new Error("denied"));
    assert.match(doc.getElementById(prefix+"-task-status").textContent,/未完成/);
    assert.equal(doc.getElementById("enabled").checked,checked);
  }
});
test("no SIM and initialization restrictions do not create task feedback",async()=>{
  const {context,doc}=await appHarness({initialStatus:{ok:true,phase:"waiting",subscriptions:[]}});
  assert.equal(doc.getElementById("apply").disabled,true);
  assert.equal(doc.getElementById("ims-task").hidden,true);
  assert.equal(doc.getElementById("sim-task").hidden,true);
  assert.match(doc.getElementById("ims-unavailable").textContent,/配置|SIM/);
  assert.equal(context.taskLocked(),false);
});
test("unknown execution blocks another submit and rejects stale/native watcher results",async()=>{
  const {context,doc}=await appHarness();
  const task=context.beginTask("ims-apply");
  require("node:vm").runInContext('pageTask.command="apply"; pageTask.commandOffset=10;',context);
  context.markTaskUnknown(task);
  assert.equal(context.taskLocked(),true);
  assert.equal(doc.getElementById("ims-task-progress").hidden,true);
  let calls=0;await context.operation(async()=>{calls++;},"test",null,"sim-apply");
  assert.equal(calls,0);
  for(const state of [
    {session:"test-boot",action:"apply",time_ms:999,ims_configuration_verified:true},
    {session:"test-boot",action:"watch",time_ms:2000,ims_configuration_verified:true},
    {session:"old-boot",action:"apply",time_ms:2000,ims_configuration_verified:true}
  ]) context.reconcileTask({status:state});
  assert.equal(context.taskLocked(),true);
  context.reconcileTask({session:"test-boot",status:{session:"test-boot",action:"apply",time_ms:2000,
    ok:true,ims_configuration_verified:true}});
  assert.equal(context.taskLocked(),false);
  assert.equal(doc.getElementById("ims-task").attributes["aria-busy"],"false");
});
test("late real completion remains observable after bridge deadline, no root cancellation",async()=>{
  let receiver;const h=streamHarness((root,cmd,args,opts,callback)=>{receiver=root[callback];});
  let late;
  const work=h.bridge.call("apply",undefined,{onLateResult:(error,result)=>{late={error,result};}});
  const rejection=assert.rejects(work,e=>e.executionUnknown===true);
  [...h.timers.values()][0].fn();await rejection;
  receiver.stdout.emit("data",'{"ok":true,"phase":"verified"}');
  receiver.emit("exit",0);
  assert.equal(late.result.phase,"verified");
});

test("startup has one full-width shared disjoint indicator, a single stable toolbar and no visual deadline",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
 const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
 const css=fs.readFileSync(path.join(__dirname,"../module/webroot/style.css"),"utf8");
 assert.equal((html.match(/<header class="toolbar">/g)||[]).length,1);
 assert.doesNotMatch(html,/startup-line/);
 assert.match(html,/id="startup-progress" class="operation-progress startup-progress"/);
 assert.doesNotMatch(app,/initialViewDeadline|revealInitialUI|turboStartupTimer/);
 assert.match(css,/startup-content-enter 150ms/);
 assert.match(css,/\.operation-progress\.startup-progress.*position:absolute/);
});
test("startup read-only retry is serialized and success immediately leaves the loading state",async()=>{
 const pending=new Promise(()=>{});
 const {context,doc,calls}=await appHarness({initialStatus:pending});
 const vm=require("node:vm");
 assert.equal(doc.documentElement.dataset.loading,"true");
 await context.initializeWebUI();
 assert.equal(calls.length,1);
 // The failure/retry path uses an independent harness with a rejected status.
 let reject;const fail=new Promise((_,r)=>{reject=r;});
 const h=await appHarness({initialStatus:fail});
 reject(new Error("read denied"));await new Promise(r=>setImmediate(r));
 assert.equal(h.doc.documentElement.dataset.loading,"error");
 assert.equal(h.doc.getElementById("startup-progress").hidden,true);
 assert.equal(h.doc.getElementById("startup-retry").hidden,false);
 assert.equal(vm.runInContext("startupInFlight",h.context),false);
 h.context.TurboBridge.call=async action=>{assert.equal(action,"status");return {ok:true,phase:"not_started"};};
 await h.doc.getElementById("startup-retry").onclick();
 await new Promise(r=>setImmediate(r));
 assert.equal(h.doc.documentElement.dataset.loading,"false");
 assert.equal(h.doc.getElementById("startup-progress").hidden,true);
 assert.equal(h.doc.getElementById("startup-retry").hidden,true);
});
test("startup timeout reports unknown without treating an elapsed deadline as initialization success",async()=>{
 let reject;const pending=new Promise((_,r)=>{reject=r;});
 const {doc}=await appHarness({initialStatus:pending});
 const error=new Error("deadline");error.executionUnknown=true;reject(error);
 await new Promise(r=>setImmediate(r));
 assert.equal(doc.documentElement.dataset.loading,"error");
 assert.match(doc.getElementById("startup-message").textContent,/无法确认/);
 assert.equal(doc.getElementById("startup-progress").hidden,true);
});
