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
