const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
(async()=>{
 fs.mkdirSync("preview/startup",{recursive:true});
 const browser=await chromium.launch();
 const report=[];
 try {
  async function scenario(name,opts={}){
   const context=await browser.newContext({viewport:{width:opts.width||393,height:852},isMobile:true,hasTouch:true,
    colorScheme:opts.systemDark?"dark":"light",reducedMotion:opts.reduced?"reduce":"no-preference",
    recordVideo:opts.video?{dir:"preview/startup/video",size:{width:393,height:852}}:undefined});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const errors=[];page.on("pageerror",e=>errors.push(String(e)));
   try {
    await page.addInitScript(opts=>{
     localStorage.setItem("turboims-theme",opts.theme||"light");
     localStorage.setItem("turboims-accent",opts.accent||"#2196F3");
     localStorage.setItem("turboims-accent-toolbar",String(!!opts.toolbarAccent));
     const nativeTimer=window.setTimeout.bind(window);
     window.setTimeout=(fn,ms,...args)=>nativeTimer(fn,opts.timeout&&ms===190000?350:ms,...args);
     window.previewStatusCalls=0;window.previewMode=opts.fail?"fail":opts.timeout?"timeout":"success";
     window.previewConfig={schema:1,enabled:true,periodic_check_enabled:false,selection:"all",interval_seconds:1800,
      implementation_mode:"turboims",features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(k=>[k,"on"])),sim_profiles:{}};
     window.ksu={spawn(cmd,args,options,callback){
      const action=JSON.parse(args)[1];
      if(action!=="status")throw Error("Startup attempted a mutating command: "+action);
      window.previewStatusCalls++;
      if(window.previewMode==="timeout")return;
      const fail=window.previewMode==="fail";
      const result=fail?{ok:false,phase:"error",error:"mock Binder unavailable"}:
        {ok:true,phase:"verified",action:"status",config:window.previewConfig,uid:0,sdk:36,session:"preview-startup",
         ims_configuration_verified:true,sim_profiles_verified:true,
         subscriptions:[{slot:0,sub_id:1,phase:"verified",ims:{registered:true}}],sim_cards:[{slot:0,sub_id:1}]};
      nativeTimer(()=>{window[callback].stdout.emit("data",JSON.stringify(result));window[callback].emit("exit",fail?2:0);},opts.delay??3000);
     }};
    },opts);
    let release;
    if(opts.holdApp){
     const gate=new Promise(r=>release=r);
     await page.route("**/app.js",async route=>{await gate;await route.continue();});
    }
    if(opts.missingApp)await page.route("**/app.js",r=>r.abort());
    await page.goto("http://127.0.0.1:8765/",{waitUntil:opts.holdApp?"commit":"domcontentloaded"});
    await page.locator(".toolbar").waitFor();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector(".toolbar")).height!=="0px");
    const metrics=()=>page.evaluate(()=>{
     const toolbar=document.querySelector(".toolbar"),title=document.getElementById("page-title");
     const bar=document.getElementById("startup-progress"),s=getComputedStyle(title),root=getComputedStyle(document.documentElement);
     const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
     window.previewHeader ||= toolbar;
     return {toolbar:box(toolbar),title:box(title),progress:box(bar),font:s.fontSize,weight:s.fontWeight,color:s.color,
       toolbarColor:getComputedStyle(toolbar).backgroundColor,background:getComputedStyle(document.body).backgroundColor,
       control:root.getPropertyValue("--control-accent").trim(),theme:document.documentElement.dataset.theme,
       sameToolbar:window.previewHeader===toolbar,barCount:document.querySelectorAll("#startup-view [role=progressbar]").length};
    });
    const before=await metrics();
    if(opts.holdApp){
     assert.equal(before.theme,opts.theme==="dark"||opts.systemDark?"dark":"light");
     // Preserve pre-app measurements, then release the deferred script before
     // screenshot font readiness (which otherwise waits for DOMContentLoaded).
     release();await page.waitForFunction(()=>window.TurboStartup && typeof initializeWebUI==="function");
     await page.screenshot({path:"preview/startup/"+name+"-saved-theme-loading.png"});
    }
    if(!opts.missingApp && (opts.delay??3000)>500){
     assert.equal(await page.locator("#startup-progress").isVisible(),true);
     assert.equal(before.progress.x,0);assert.equal(before.progress.width,opts.width||393);
     assert.equal(before.progress.height,4);assert.equal(before.progress.y,before.toolbar.bottom);
     assert.equal(before.barCount,1);
     assert.equal(await page.locator("#bottom-nav").isVisible(),false);
     const textX=await page.locator("#startup-message").evaluate(el=>el.getBoundingClientRect().x);
     assert.equal(textX,opts.width&&opts.width<350?18:24);
     if(opts.reduced)assert.equal(await page.locator("#startup-progress .operation-progress__bar").first().evaluate(el=>getComputedStyle(el).animationName),"none");
     await page.screenshot({path:"preview/startup/"+name+"-loading.png"});
    }
    if(opts.long){
     await page.waitForTimeout(6500);
     assert.equal(await page.evaluate(()=>document.documentElement.dataset.loading),"true");
     assert.equal(await page.locator("#page-content").isVisible(),false);
     assert.equal(await page.evaluate(()=>previewStatusCalls),1);
     // Official motion sampled for >3 complete 2-second cycles while its dimensions stay fixed.
    }
    if(opts.hidden){
     await page.evaluate(()=>Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}));
     await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
     assert.equal(await page.locator("#startup-progress .operation-progress__bar").first().evaluate(el=>getComputedStyle(el).animationPlayState),"paused");
     await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));});
     assert.equal(await page.locator("#startup-progress .operation-progress__bar").first().evaluate(el=>getComputedStyle(el).animationPlayState),"running");
    }
    if(opts.fail||opts.timeout||opts.missingApp){
     await page.waitForFunction(()=>document.documentElement.dataset.loading==="error");
     assert.equal(await page.locator("#startup-progress").isVisible(),false);
     await page.screenshot({path:"preview/startup/"+name+"-failure.png"});
     if(!opts.missingApp){
      const msg=await page.locator("#startup-message").innerText();
      assert.match(msg,opts.timeout?/无法确认/:/加载失败/);
      await page.evaluate(()=>{window.previewMode="success";document.getElementById("startup-retry").click();document.getElementById("startup-retry").click();initializeWebUI();});
      await page.waitForFunction(()=>document.documentElement.dataset.loading==="false");
      assert.equal(await page.evaluate(()=>previewStatusCalls),2);
     }else{
      assert.equal(await page.locator("#startup-retry").isVisible(),true);
      report.push({name,resourceFailure:true,before});return;
     }
    } else await page.waitForFunction(()=>document.documentElement.dataset.loading==="false");
    await page.waitForTimeout(opts.reduced?0:180);
    const after=await metrics();
    assert.deepEqual(after.title,before.title);
    assert.equal(after.font,before.font);assert.equal(after.weight,before.weight);
    assert.equal(after.color,before.color);assert.equal(after.toolbarColor,before.toolbarColor);
    assert.equal(after.background,before.background);assert.equal(after.control,before.control);
    assert.equal(after.sameToolbar,true);
    assert.equal(await page.locator("#startup-view").isVisible(),false);
    assert.equal(await page.locator("#home").isVisible(),true);
    assert.equal(await page.locator("#bottom-nav").isVisible(),true);
    assert.equal(await page.locator("#page-content").evaluate(el=>el.getBoundingClientRect().y),after.toolbar.bottom);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // Simulated manager insets, without expanding permissions or touching native bars.
    await page.evaluate(()=>{
      const s=document.documentElement.style;s.setProperty("--safe-area-inset-top","24px");s.setProperty("--safe-area-inset-bottom","20px");
    });
    const safe=await metrics();
    assert.equal(safe.toolbar.height,after.toolbar.height+24);
    const nativeBG=await page.evaluate(()=>document.getElementById("status-bar-color").content);
    assert.ok(nativeBG);
    await page.screenshot({path:"preview/startup/"+name+"-ready.png"});
    assert.deepEqual(errors,[]);
    report.push({name,before,after,safe,readCalls:await page.evaluate(()=>previewStatusCalls),errors});
    console.log("Startup "+name+" passed.");
   } finally {await context.close();}
  }
  await scenario("normal-light",{delay:3000,video:true});
  await scenario("long-dark",{theme:"dark",accent:"#9575CD",toolbarAccent:true,delay:8000,long:true,hidden:true,video:true});
  await scenario("fast",{delay:20});
  await scenario("saved-theme-first-paint",{theme:"dark",accent:"#CC6F4E",toolbarAccent:true,delay:700,holdApp:true});
  await scenario("system-dark",{theme:"system",systemDark:true,accent:"#009688",delay:700});
  await scenario("reduced-narrow",{theme:"light",accent:"#FFFFFF",reduced:true,width:280,delay:700});
  await scenario("failure-retry",{fail:true,delay:50});
  await scenario("unknown-retry",{timeout:true,delay:20});
  await scenario("missing-resource",{missingApp:true});
  fs.writeFileSync("preview/startup/startup-report.json",JSON.stringify(report,null,2));
 } finally {await browser.close();}
 console.log("Startup layout, early theme, real promise lifecycle, retry, transition and motion checks passed.");
})().catch(e=>{console.error(e);process.exitCode=1;});
