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
      window[callback](0,JSON.stringify(result),"");
    }};
  });
  const visible=async id=>page.locator("#"+id).waitFor({state:"visible"});
  const close=async()=>{ await page.locator("#sheet-close").click(); await page.locator("#sheet").waitFor({state:"hidden"}); };
  const back=async id=>{ await page.locator("#back").click(); await visible(id); };
  const systemBack=async id=>{ await page.evaluate(()=>history.back()); await visible(id); };
  const capture=async name=>page.screenshot({path:"preview/"+name+".png",fullPage:await page.locator("#sheet").isHidden()});
  await page.goto("http://127.0.0.1:8765/",{waitUntil:"networkidle"});
  const rootLength=await page.evaluate(()=>history.length);
  await capture("home-light");
  assert.equal(await page.locator("#home .chevron").count(),2);
  assert.equal(await page.locator("#selection-choice").evaluate(el=>getComputedStyle(el,"::after").content),"none");
  assert.equal(await page.locator("#apply").evaluate(el=>getComputedStyle(el).userSelect),"none");

  // The entire dialog preference row is clickable.
  await page.locator(".feature .row-copy").first().click();
  await visible("sheet");
  await capture("volte-dialog");
  await close();
  await page.locator("#selection-choice").click();
  await capture("sim-dialog");
  await close();
  await page.locator("#interval-choice").click();
  await capture("interval-dialog");
  await close();

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
  await back("home");

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

  await page.locator("#open-appearance").click();
  await visible("appearance-page");
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
  await systemBack("home");
  await capture("home-dark");
  assert.equal(await page.evaluate(()=>history.state.page),"home");
  assert.equal(await page.evaluate(()=>history.state.dialog),undefined);
  assert.equal(await page.evaluate(()=>history.length >= 1),true);
  // On a fresh instance only two nested pages are pushed; repeated back reaches root.
  const fresh=await browser.newPage();
  await fresh.goto("http://127.0.0.1:8765/",{waitUntil:"networkidle"});
  const initial=await fresh.evaluate(()=>history.length);
  await fresh.locator("#open-appearance").click();
  await fresh.locator("#accent-choice").click();
  assert.equal(await fresh.evaluate(()=>history.length),initial+2);
  await fresh.evaluate(()=>history.back());
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.evaluate(()=>history.back());
  await fresh.locator("#home").waitFor({state:"visible"});
  assert.equal(await fresh.evaluate(()=>location.hash),"#/");
  // Restore a real page on reload and support externally changed hashes.
  await fresh.locator("#open-appearance").click();
  await fresh.reload({waitUntil:"networkidle"});
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.locator("#theme-choice").click();
  await fresh.locator("#sheet").waitFor({state:"visible"});
  await fresh.reload({waitUntil:"networkidle"});
  await fresh.locator("#appearance-page").waitFor({state:"visible"});
  await fresh.waitForFunction(()=>!history.state.dialog);
  await fresh.locator("#back").click();
  await fresh.locator("#home").waitFor({state:"visible"});
  await fresh.evaluate(()=>{location.hash="#/diagnostics";});
  await fresh.locator("#diagnostics-page").waitFor({state:"visible"});
  await fresh.close();
  await page.setViewportSize({width:320,height:720});
  await capture("home-narrow");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  fs.writeFileSync("preview/verification.json",JSON.stringify({passed:true,rootLength,
    checked:["nested history","dialog cancellation","stale confirmation forward","reload","hashchange","full-row choice",
      "diagnostic summary","unbroken horizontal JSON","text selection","dark theme","320px viewport"],
    limitation:"Native Android 16 gesture dispatch and predictive animation require device verification."},null,2));
  if(errors.length) throw new Error(errors.join("\n"));
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
