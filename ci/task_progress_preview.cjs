const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
(async()=>{
 fs.mkdirSync("preview",{recursive:true});
 const browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,recordVideo:{dir:"preview/video",size:{width:393,height:852}}});
 const page=await context.newPage();
 const errors=[];page.on("pageerror",e=>errors.push(String(e)));
 await page.addInitScript(()=>{
  window.mockCalls=[];window.mockPending=[];
  const nativeTimer=window.setTimeout.bind(window);
  window.previewShortDeadline=false;
  window.setTimeout=(fn,ms,...args)=>nativeTimer(fn,ms===190000 && window.previewShortDeadline ? 600:ms,...args);
  window.mockConfig={schema:1,enabled:true,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
    implementation_mode:"turboims",sim_profiles:{},features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(k=>[k,"on"]))};
  window.mockResult=(extra={})=>({ok:true,phase:"verified",session:"preview-boot",time_ms:Date.now(),action:"apply",sdk:36,uid:0,
    config:window.mockConfig,write_readback_verified:true,ims_configuration_verified:true,sim_profiles_verified:true,
    subscriptions:[{slot:0,sub_id:1,phase:"verified",sim_profiles_verified:true,ims_configuration_verified:true,ims:{registered:true}}],
    ...extra});
  window.finishNative=(extra={})=>{
    const pending=window.mockPending.shift();if(!pending)throw Error("No pending native command");
    const result=window.mockResult({...extra,action:pending.action});
    sessionStorage.setItem("preview-status",JSON.stringify(result));
    window[pending.callback].stdout.emit("data",JSON.stringify(result));
    window[pending.callback].emit("exit",result.ok===false?2:0);
  };
  window.ksu={spawn(cmd,args,options,callback){
   const argv=JSON.parse(args),action=argv[1];window.mockCalls.push(action);
   if(action==="apply"||action==="restore"){window.mockPending.push({action,callback});return;}
   if(action==="save")window.mockConfig=JSON.parse(atob(argv[2].slice(1,-1)));
   const previous=JSON.parse(sessionStorage.getItem("preview-status")||"null");
   const result=action==="status"&&previous?{...window.mockResult(),status:previous}:window.mockResult({action});
   nativeTimer(()=>{window[callback].stdout.emit("data",JSON.stringify(result));window[callback].emit("exit",0);},20);
  }};
 });
 await page.goto("http://127.0.0.1:8765/");
 await page.waitForFunction(()=>!busy);
 const click=async id=>page.locator("#"+id).click();
 const start=async kind=>{
  const sim=kind.startsWith("sim");
  await page.evaluate(sim=>navigate(sim?"sim-page":"home"),sim);
  const id={"ims-apply":"apply","ims-restore":"restore","sim-apply":"sim-save","sim-restore":"sim-restore"}[kind];
  await click(id);
  if(kind!=="sim-apply")await page.locator("#sheet-actions button").click();
  await page.waitForFunction(()=>mockPending.length===1);
  const prefix=sim?"sim":"ims";
  assert.equal(await page.locator("#"+prefix+"-task-progress").isVisible(),true);
  assert.equal(await page.locator("#"+id).isDisabled(),true);
  const count=await page.evaluate(()=>mockCalls.length);
  await page.evaluate(id=>document.getElementById(id).click(),id);
  assert.equal(await page.evaluate(()=>mockCalls.length),count);
  return prefix;
 };
 const complete=async extra=>{
  await page.evaluate(extra=>finishNative(extra),extra);
  await page.waitForFunction(()=>!busy&&!taskLocked());
 };
 const report=[];
 // Record at least three complete official 2-second cycles, sample both nested transforms.
 await start("ims-apply");
 await page.locator("#ims-task").scrollIntoViewIfNeeded();
 await page.screenshot({path:"preview/ims-running-light.png"});
 const samples=await page.evaluate(async()=>{
  const root=document.querySelector("#ims-task-progress"),bars=[...root.querySelectorAll(".operation-progress__bar")];
  const out=[];
  for(let i=0;i<=75;i++){
   const width=root.getBoundingClientRect().width;
   out.push({t:i*100,width,bars:bars.map(bar=>{
    const a=bar.getBoundingClientRect(),b=bar.firstElementChild.getBoundingClientRect();
    return {x:b.x-root.getBoundingClientRect().x,w:b.width,outer:getComputedStyle(bar).transform,
      inner:getComputedStyle(bar.firstElementChild).transform,duration:getComputedStyle(bar).animationDuration};
   })});
   await new Promise(r=>setTimeout(r,100));
  }
  return out;
 });
 assert.ok(samples.every(s=>s.bars.every(b=>b.duration==="2s")&&s.width===samples[0].width));
 assert.ok(new Set(samples.map(s=>Math.round(s.bars[0].w))).size>10);
 assert.ok(new Set(samples.map(s=>Math.round(s.bars[1].w))).size>10);
 fs.writeFileSync("preview/animation-samples.json",JSON.stringify(samples,null,2));
 const before=await page.evaluate(()=>document.getElementById("page-content").scrollTop);
 await click("tab-settings-page");
 assert.equal(await page.locator("#ims-task").getAttribute("data-visible"),"false");
 assert.equal(await page.locator("#ims-task .operation-progress__bar").first().evaluate(e=>getComputedStyle(e).animationPlayState),"paused");
 await click("open-appearance");assert.equal(await page.locator("#appearance-page").isVisible(),true);
 await page.evaluate(()=>navigate("home"));
 await complete({});
 assert.equal(await page.locator("#ims-task-progress").isVisible(),false);
 // Start/success/failure each of four actual handlers via the mocked native bridge.
 for(const kind of ["ims-apply","ims-restore","sim-apply","sim-restore"]){
  const prefix=await start(kind);
  await complete(kind==="ims-restore"?{subscriptions:[{slot:0,sub_id:1,phase:"restored"}]}:{});
  assert.match(await page.locator("#"+prefix+"-task-status").innerText(),/已应用|已恢复/);
  await start(kind);await complete({ok:false,phase:"verification_failed",write_readback_verified:false,
    ims_configuration_verified:false,sim_profiles_verified:false,subscriptions:[{slot:0,sub_id:1,phase:"error",error:"mock denied"}]});
  assert.match(await page.locator("#"+prefix+"-task-status").innerText(),/未完成/);
  report.push({kind,start:true,success:true,failure:true});
 }
 await page.evaluate(()=>{render(mockResult({subscriptions:[]}),true);pageTask=null;renderTaskFeedback();updateTaskControls();});
 assert.equal(await page.locator("#apply").isDisabled(),true);
 assert.equal(await page.locator("#ims-task-progress").isVisible(),false);
 await page.evaluate(()=>render(mockResult(),true));
 // Request deadline gives unknown state; conflicts stay locked, late real exit releases.
 await page.evaluate(()=>window.previewShortDeadline=true);
 await start("ims-apply");
 await page.waitForFunction(()=>pageTask?.state==="unknown");
 assert.equal(await page.locator("#apply").isDisabled(),true);
 assert.equal(await page.locator("#ims-task-progress").isVisible(),false);
 await complete({});
 await page.evaluate(()=>window.previewShortDeadline=false);
 // Reload pending marker: no repeated apply. Only a newer matching native result ends it.
 await start("ims-apply");
 await page.evaluate(()=>sessionStorage.removeItem("preview-status"));
 await page.reload();await page.waitForFunction(()=>!busy);
 assert.equal(await page.evaluate(()=>pageTask.state),"unknown");
 assert.equal(await page.evaluate(()=>mockCalls.filter(x=>x==="apply").length),0);
 assert.equal(await page.locator("#apply").isDisabled(),true);
 await page.evaluate(()=>{const s=mockResult({time_ms:Date.now()+500,action:"apply"});render({session:s.session,status:s,config:s.config},true);});
 assert.equal(await page.evaluate(()=>taskLocked()),false);
 // Themes, all presets and extreme custom colors, narrow screens, larger fonts and reduced motion.
 await start("sim-apply");
 for(const theme of ["light","dark"])for(const color of await page.evaluate(()=>[...onePlusColors,...materialColors].map(x=>x[1]).concat(["#FFFFFF","#000000","#123456"]))){
  await page.evaluate(({theme,color})=>{themeMode=theme;accent=color;showAppearance();},{theme,color});
  const data=await page.locator("#sim-task-progress").evaluate(el=>{
   const root=getComputedStyle(document.documentElement),inner=getComputedStyle(el.querySelector(".operation-progress__inner"));
   return {height:getComputedStyle(el).height,color:inner.backgroundColor,accent:root.getPropertyValue("--control-accent").trim(),track:getComputedStyle(el,"::before").opacity};
  });
  assert.equal(data.height,"4px");assert.ok(data.color!=="rgba(0, 0, 0, 0)");
  report.push({theme,color,...data});
 }
 for(const width of [280,320,393]){
  await page.setViewportSize({width,height:852});
  await page.evaluate(()=>document.documentElement.style.fontSize="125%");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.evaluate(()=>{themeMode="dark";showAppearance();});
 await page.locator("#sim-task").scrollIntoViewIfNeeded();await page.screenshot({path:"preview/sim-running-dark-narrow.png"});
 await page.emulateMedia({reducedMotion:"reduce"});
 assert.equal(await page.locator("#sim-task .operation-progress__bar").first().evaluate(el=>getComputedStyle(el).animationName),"none");
 assert.match(await page.locator("#sim-task-status").innerText(),/正在/);
 await complete({});
 assert.equal(await page.locator("#sim-task").getAttribute("aria-busy"),"false");
 assert.deepEqual(errors,[]);
 fs.writeFileSync("preview/task-progress-report.json",JSON.stringify({scenarios:report,scrollBefore:before,errors},null,2));
 await context.close();await browser.close();
 console.log("Task lifecycle and classic disjoint progress browser checks passed; video covers >3 full cycles.");
})().catch(e=>{console.error(e);process.exitCode=1;});
