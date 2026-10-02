const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync("preview", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  await page.addInitScript(() => {
    window.bridgeCalls = [];
    const config={schema:1,enabled:false,selection:"all",interval_seconds:30,features:{
      volte:"on",vowifi:"on",vt:"on",vonr:"on",cross_sim:"on",ut:"on","5g_nr":"on"
    }};
    window.ksu={exec(command,options,callback){
      const action=command.split(" ").at(-1);
      window.bridgeCalls.push(action);
      const result={ok:true,sdk:36,device:"husky",uid:0,selinux_context:"u:r:ksu:s0",config,
        session:"f9cdf384-ce76-4872-8cdc-62d580ad3971",
        status:{phase:"paused",binder:{carrier_config:true,override_method:
          "public abstract void com.android.internal.telephony.ICarrierConfigLoader.overrideConfig(int,android.os.PersistableBundle,boolean)"},
          subscriptions:[
            {slot:0,sub_id:1,phase:"paused",unsupported:[]},
            {slot:1,sub_id:2,phase:"paused",unsupported:[]}
          ]},watcher:{alive:true}};
      if (action === "probe") {
        result.phase = "probe"; result.binder = result.status.binder;
        result.subscriptions = result.status.subscriptions.map(sub => ({...sub,phase:"probe"}));
        delete result.status;
      }
      const reply = () => window[callback](0,JSON.stringify(result),"");
      const delay = window.nextReadDelay || 0; window.nextReadDelay = 0;
      if (delay) setTimeout(reply,delay); else reply();
    }};
  });
  const visible=async id=>page.locator("#"+id).waitFor({state:"visible"});
  const close=async()=>{ await page.locator("#sheet-close").click(); await page.locator("#sheet").waitFor({state:"hidden"}); };
  const back=async id=>{ await page.locator("#back").click(); await visible(id); };
  const systemBack=async id=>{ await page.evaluate(()=>history.back()); await visible(id); };
  const capture=async (name, feedback=false)=>{
    await page.waitForFunction(()=>document.getElementById("sheet").getAnimations().every(animation=>animation.playState !== "running"));
    if (!feedback) await page.waitForTimeout(220);
    // Content now scrolls internally; capture the phone viewport, not offscreen DOM bounds.
    return page.screenshot({path:"preview/"+name+".png",fullPage:false});
  };
  await page.goto("http://127.0.0.1:8765/",{waitUntil:"networkidle"});
  const rootLength=await page.evaluate(()=>history.length);
  await capture("home-light");
  assert.equal(await page.locator("#home .chevron").count(),0);
  assert.equal(await page.locator("#selection-choice").evaluate(el=>getComputedStyle(el,"::after").content),"none");
  assert.equal(await page.locator("#apply").evaluate(el=>getComputedStyle(el).userSelect),"none");


  // Root tabs replace, rather than push, and preserve untouched IMS controls.
  await page.locator("#enabled").check();
  await page.evaluate(()=>{document.getElementById("page-content").scrollTop=400;});
  const imsScroll=await page.locator("#page-content").evaluate(el=>el.scrollTop);
  const callsBeforeTabs=await page.evaluate(()=>window.bridgeCalls.length);
  await page.locator("#tab-sim-page").click();
  await visible("sim-page");
  assert.equal(await page.locator("#sim-page").innerHTML(),"");
  assert.equal(await page.locator("#page-title").innerText(),"SIM 卡信息");
  assert.equal(await page.locator("#back").isHidden(),true);
  await capture("sim-empty");
  await page.locator("#tab-settings-page").click();
  await visible("settings-page");
  await capture("settings-light");
  assert.equal(await page.locator("#open-appearance").isVisible(),true);
  assert.equal(await page.evaluate(()=>history.length),rootLength);
  await page.locator("#tab-home").click();
  assert.equal(await page.locator("#page-content").evaluate(el=>el.scrollTop),imsScroll);
  assert.equal(await page.locator("#enabled").isChecked(),true);
  assert.equal(await page.evaluate(()=>window.bridgeCalls.length),callsBeforeTabs);
  // The last IMS row stays above the navigation at the bottom of the scroll viewport.
  await page.evaluate(()=>{const el=document.getElementById("page-content");el.scrollTop=el.scrollHeight;});
  assert.ok((await page.locator("#restore").boundingBox()).y+
    (await page.locator("#restore").boundingBox()).height <= (await page.locator("#bottom-nav").boundingBox()).y);
  await capture("ims-bottom");
  await page.locator("#enabled").uncheck();
  const touch = await page.context().newCDPSession(page);
  const touchEvent = (type,x,y) => touch.send("Input.dispatchTouchEvent",{
    type,touchPoints:type === "touchEnd" ? [] : [{x,y}]
  });

  const tabBounds=await page.locator("#tab-sim-page").boundingBox();
  const tabX=Math.round(tabBounds.x+20),tabY=Math.round(tabBounds.y+20);
  await touchEvent("touchStart",tabX,tabY);
  await page.waitForTimeout(40);
  assert.equal(await page.locator("#tab-sim-page .touch-ripple").count(),0);
  await touchEvent("touchEnd");
  await page.waitForTimeout(120);
  await capture("bottom-nav-ripple",true);
  await visible("sim-page");
  await page.locator("#tab-home").click();
  const row = page.locator(".feature").first();
  const toggle = row.locator('input[role="switch"]');
  await row.scrollIntoViewIfNeeded();
  let bounds = await row.boundingBox();
  const tx = Math.round(bounds.x+18), ty = Math.round(bounds.y+24);
  await touchEvent("touchStart",tx,ty);
  // A touch that may become a scroll must not create a ripple on pointerdown.
  await page.waitForTimeout(40);
  assert.equal(await row.locator(".touch-ripple").count(),0);
  await page.screenshot({path:"preview/preference-pressed.png"});
  await touchEvent("touchEnd");
  await page.waitForTimeout(120);
  await page.screenshot({path:"preview/preference-ripple.png"});
  await page.waitForTimeout(220);
  // IMS feature rows are switches; a tap changes state without opening a dialog.
  assert.equal(await page.locator("#sheet").isVisible(),false);
  await row.click();
  assert.equal(await toggle.getAttribute("aria-checked"),"false");
  assert.equal(await page.locator("#volte").inputValue(),"off");
  const sx = Math.round(bounds.x+30), sy = Math.round(bounds.y+32);
  await touchEvent("touchStart",sx,sy);
  await touchEvent("touchMove",sx,sy-45);
  await touchEvent("touchEnd");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#sheet").isVisible(),false);
  assert.equal(await page.locator(".feedback-pressed").count(),0);
  assert.equal(await page.locator(".touch-ripple").count(),0);
  await page.locator("#selection-choice").click();
  await capture("sim-dialog");
  await close();
  await page.evaluate(()=>{window.nextReadDelay=300;});
  await page.locator("#probe").click();
  assert.equal(await page.locator("#probe").isDisabled(),true);
  assert.equal(await page.locator("#probe").innerText(),"正在检测…");
  await page.dispatchEvent("#refresh","pointerdown",{button:0,isPrimary:true,pointerId:999,clientX:10,clientY:10});
  assert.equal(await page.locator("#refresh .touch-ripple").count(),0);
  await page.waitForFunction(()=>!document.getElementById("probe").disabled);
  assert.equal(await page.locator("#message").innerText(),"检测完成");
  assert.match(await page.locator("#device").innerText(),/只读检测.*尚未验证/);
  assert.match(await page.locator("#sim-summary").innerText(),/SIM 卡 1、2/);
  await capture("detected-status");
  await page.locator("#refresh").click();
  await page.waitForFunction(()=>!document.getElementById("refresh").disabled);
  assert.equal(await page.locator("#probe").innerText(),"检测设备");
  assert.equal(await page.locator("#refresh").innerText(),"刷新");
  await page.locator("#interval-choice").click();
  await capture("interval-dialog");
  await close();

  await page.locator("#tab-settings-page").click();
  await page.locator("#open-diagnostics").click();
  await visible("diagnostics-page");
  await page.locator("#export").click();
  await page.waitForFunction(()=>document.getElementById("diagnostic-notice").textContent.includes("已生成"));
  await capture("diagnostics-light");
  assert.equal(await page.locator("#diagnostics").isVisible(),false);
  assert.match(await page.locator("#diagnostic-summary").innerText(),/读通路可用/);
  await page.locator("#open-diagnostic-data").click();
  await visible("diagnostic-data-page");
  await capture("diagnostic-json");
  const log=await page.locator("#diagnostics").evaluate(el=>({
    whiteSpace:getComputedStyle(el).whiteSpace,wordBreak:getComputedStyle(el).wordBreak,
    select:getComputedStyle(el).userSelect,overflow:el.scrollWidth>el.clientWidth
  }));
  assert.equal(log.whiteSpace,"pre");
  assert.equal(log.wordBreak,"normal");
  assert.equal(log.select,"text");
  assert.equal(log.overflow,true);
  await systemBack("diagnostics-page");
  await page.locator("#open-operation-data").click();
  await visible("operation-data-page");
  await systemBack("diagnostics-page");
  await back("settings-page");
  await page.locator("#tab-home").click();

  await page.locator("#enabled").check();
  await page.locator("#apply").click();
  await visible("sheet");
  await capture("confirmation");
  // Mimics host webView.goBack(): no save/apply, no config loss.
  await page.evaluate(()=>history.back());
  await page.locator("#sheet").waitFor({state:"hidden"});
  await page.waitForFunction(()=>document.getElementById("message").textContent.includes("取消"));
  assert.equal(await page.locator("#enabled").isChecked(),true);
  assert.equal(await page.evaluate(()=>window.bridgeCalls.some(x=>x==="apply" || x.includes("save"))),false);
  await page.evaluate(()=>history.forward());
  await page.waitForFunction(()=>!history.state.dialog);
  assert.equal(await page.locator("#sheet").isVisible(),false);
  await page.locator("#enabled").uncheck();

  await page.locator("#tab-settings-page").click();
  await page.locator("#open-appearance").click();
  await visible("appearance-page");
  assert.equal(await page.locator("#bottom-nav").isHidden(),true);
  await capture("appearance-light");
  await page.locator("#accent-choice").click();
  await visible("accent-page");
  await capture("accent-colors");
  assert.match(await page.evaluate(()=>location.hash),/accent/);
  await systemBack("appearance-page");
  await page.evaluate(()=>history.forward());
  await visible("accent-page");
  await back("appearance-page");
  await page.locator("#theme-choice").click();
  await visible("sheet");
  await capture("theme-dialog");
  await page.locator("#sheet-content .option").nth(2).click();
  await page.locator("#sheet").waitFor({state:"hidden"});
  await capture("appearance-dark");
  await page.locator("#accent-choice").click();
  await visible("accent-page");
  await capture("accent-colors-dark");
  await back("appearance-page");
  await systemBack("settings-page");
  await capture("settings-dark");
  await page.locator("#tab-home").click();
  await capture("home-dark");
  assert.equal(await page.evaluate(()=>history.state.page),"home");
  assert.equal(await page.evaluate(()=>history.state.dialog),undefined);
  assert.equal(await page.evaluate(()=>history.length >= 1),true);
  // On a fresh instance only two nested pages are pushed; repeated back reaches root.
  const fresh=await browser.newPage();
  await fresh.goto("http://127.0.0.1:8765/",{waitUntil:"networkidle"});
  const initial=await fresh.evaluate(()=>history.length);
  for (let i=0;i<3;i++) for (const id of ["tab-sim-page","tab-settings-page","tab-home"]) await fresh.locator("#"+id).click();
  assert.equal(await fresh.evaluate(()=>history.length),initial);
  await fresh.locator("#tab-settings-page").click();
  await fresh.locator("#open-appearance").click();
  await fresh.locator("#accent-choice").click();
  assert.equal(await fresh.evaluate(()=>history.length),initial+2);
  await fresh.evaluate(()=>history.back());
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.evaluate(()=>history.back());
  await fresh.locator("#settings-page").waitFor({state:"visible"});
  assert.equal(await fresh.evaluate(()=>location.hash),"#/settings");
  // Restore a real page on reload and support externally changed hashes.
  await fresh.locator("#tab-settings-page").click();
  await fresh.locator("#open-appearance").click();
  await fresh.reload({waitUntil:"networkidle"});
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.locator("#theme-choice").click();
  await fresh.locator("#sheet").waitFor({state:"visible"});
  await fresh.reload({waitUntil:"networkidle"});
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.waitForFunction(()=>!history.state.dialog);
  await fresh.locator("#back").click();
  await fresh.locator("#settings-page").waitFor({state:"visible"});
  await fresh.evaluate(()=>{location.hash="#/diagnostics";});
  await fresh.locator("#diagnostics-page").waitFor({state:"visible"});
  await fresh.evaluate(()=>history.back());
  await fresh.locator("#settings-page").waitFor({state:"visible"});
  await fresh.emulateMedia({colorScheme:"dark"});
  assert.equal(await fresh.locator("#theme-color").getAttribute("content"),"#121212");
  assert.equal(await fresh.locator("#navigation-bar-color").getAttribute("content"),"#121212");
  await fresh.waitForFunction(()=>document.documentElement.dataset.theme === "dark");
  await fresh.emulateMedia({colorScheme:"light"});
  await fresh.waitForFunction(()=>document.documentElement.dataset.theme === "light");
  await fresh.locator("#tab-settings-page").click();
  await fresh.locator("#open-appearance").click();
  await fresh.locator("#accent-choice").click();
  await fresh.locator("#custom-hex").fill("#123456");
  await fresh.locator("#apply-hex").click();
  assert.equal(await fresh.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),"#123456");
  assert.match(await fresh.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--ripple-rgb")),/7,21,34/);
  await fresh.locator("#back").click();
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.emulateMedia({reducedMotion:"reduce"});
  await fresh.locator("#theme-choice").click();
  await fresh.locator("#sheet").waitFor({state:"visible"});
  assert.equal(await fresh.locator("#sheet").evaluate(el=>el.getAnimations().length),0);
  await fresh.locator("#sheet-content .option").nth(2).click();
  await fresh.locator("#sheet").waitFor({state:"hidden"});
  await fresh.waitForFunction(()=>document.documentElement.dataset.theme === "dark");
  await fresh.emulateMedia({colorScheme:"light"});
  assert.equal(await fresh.evaluate(()=>document.documentElement.dataset.theme),"dark");
  await fresh.locator("#theme-choice").click();
  await fresh.locator("#sheet-content .option").nth(0).click();
  await fresh.locator("#sheet").waitFor({state:"hidden"});
  await fresh.waitForFunction(()=>document.documentElement.dataset.theme === "light");
  await fresh.waitForFunction(()=>!document.querySelector(".touch-ripple"));
  assert.equal(await fresh.locator(".touch-ripple").count(),0);
  await fresh.locator("#back").click();
  await fresh.locator("#settings-page").waitFor({state:"visible"});
  assert.equal(await fresh.locator("#tab-settings-page").evaluate(el=>getComputedStyle(el).color),"rgb(18, 52, 86)");
  assert.equal(await fresh.locator("#tab-settings-page").getAttribute("aria-current"),"page");
  await fresh.close();
  await page.setViewportSize({width:320,height:720});
  await capture("home-narrow");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  fs.writeFileSync("preview/verification.json",JSON.stringify({passed:true,rootLength,
    checked:["root tabs without history growth","empty SIM root","IMS scroll and form retention","bottom row clearance","accent navigation","nested history","dialog cancellation","stale confirmation forward","reload","hashchange","full-row choice",
      "diagnostic summary","unbroken horizontal JSON","text selection","dark theme","320px viewport","touch-origin ripple","scroll cancels press","disabled feedback",
      "real probe semantics","system theme changes","custom accent","reduced motion"],
    limitation:"Native Android 16 gesture dispatch and predictive animation require device verification."},null,2));
  if(errors.length) throw new Error(errors.join("\n"));
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
