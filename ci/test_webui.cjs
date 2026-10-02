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
  for(const file of ["bridge.js","app.js","style.css"])
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
      hidden:false, isConnected:true, checked:false,
      append(...items) { this.children.push(...items); this.options.push(...items); },
      replaceChildren(...items) { this.children=[...items]; },
      setAttribute() {}, focus() {}, querySelectorAll:()=>[] };
  }
  const elements=new Map();
  const doc={activeElement:null, body:{style:{}},
    documentElement:{dataset:{},style:{setProperty() {}}},
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
  const context=vm.createContext({
    document:doc,
    TurboBridge:{call:async(action,payload)=>{calls.push([action,payload]);return {phase:"not_started"};}},
    localStorage:{getItem:()=>null,setItem(){}},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    btoa:s=>Buffer.from(s).toString("base64")
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8"),context);
  await Promise.resolve();await Promise.resolve();
  return {context,elements,calls,doc};
}
test("native dialogs and visible browser pickers are absent",()=>{
  const app=fs.readFileSync(path.join(__dirname,"../module/webroot/app.js"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"../module/webroot/index.html"),"utf8");
  assert.doesNotMatch(app,/\\b(?:confirm|alert|prompt)\\s*\\(/);
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
  const {elements,calls}=await appHarness();
  elements.get("enabled").checked=true;
  const click=elements.get("apply").onclick();
  elements.get("sheet-actions").children[0].onclick();
  await click;
  assert.deepEqual(calls.map(([action])=>action),["status"]);
});
test("partial support is a visible warning instead of complete success",async()=>{
  const {context,elements}=await appHarness();
  context.render({ok:false,phase:"partial",subscriptions:[]});
  assert.match(elements.get("message").textContent,/部分配置键/);
  assert.equal(elements.get("message").className,"error");
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
  assert.match(elements.get("message").textContent,/ownership_lost/);
  assert.doesNotMatch(elements.get("message").textContent,/undefined/);
});
