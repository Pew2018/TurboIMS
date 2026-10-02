const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
let browser;
(async () => {
  fs.mkdirSync("preview", { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  await page.addInitScript(() => {
    window.bridgeCalls = [];
    window.nextReadDelay = 1200;
    let config={schema:1,enabled:false,periodic_check_enabled:false,selection:"all",interval_seconds:1800,features:{
      volte:"on",vowifi:"on",vt:"on",vonr:"on",cross_sim:"on",ut:"on","5g_nr":"on"
    }};
    window.ksu={exec(command,options,callback){
      const action=command.split(" ")[2];
      window.bridgeCalls.push(action);
      if (action === "save") {
        config = JSON.parse(atob(command.split(" ").at(-1).slice(1,-1)));
        window[callback](0,JSON.stringify({ok:true,saved:true,config}),"");
        return;
      }
      const result={ok:true,sdk:36,device:"husky",uid:0,selinux_context:"u:r:ksu:s0",config,
        session:"f9cdf384-ce76-4872-8cdc-62d580ad3971",
        status:{phase:"paused",binder:{carrier_config:true,override_method:
          "public abstract void com.android.internal.telephony.ICarrierConfigLoader.overrideConfig(int,android.os.PersistableBundle,boolean)"},
          subscriptions:[
            {slot:0,sub_id:1,phase:"paused",unsupported:[]},
            {slot:1,sub_id:2,phase:"paused",unsupported:[]}
          ]},watcher:{alive:false,mode:"completed"}};
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
  const capture=async name=>{
    await page.waitForFunction(()=>document.getElementById("sheet").getAnimations().every(animation=>animation.playState !== "running"));
    await page.waitForTimeout(220);
    // Content now scrolls internally; capture the phone viewport, not offscreen DOM bounds.
    return page.screenshot({path:"preview/"+name+".png",fullPage:false});
  };
  await page.goto("http://127.0.0.1:8765/",{waitUntil:"domcontentloaded"});
  await visible("startup-view");
  assert.equal(await page.locator("#page-content").isHidden(),true);
  await capture("startup");
  await page.waitForFunction(()=>document.documentElement.dataset.loading === "false");
  assert.equal(await page.locator("#startup-view").isHidden(),true);
  const rootLength=await page.evaluate(()=>history.length);
  await capture("home-light");
  assert.equal(await page.locator("#home .chevron").count(),0);
  assert.equal(await page.locator("#selection-choice").evaluate(el=>getComputedStyle(el,"::after").content),"none");
  assert.equal(await page.locator("#apply").evaluate(el=>getComputedStyle(el).userSelect),"none");



  // Verify the same action component across themes and every preset, without
  // invoking apply/restore. Arbitrary dark/light HEX uses the same contrast rule.
  const palette=await page.evaluate(()=>[...onePlusColors,...materialColors].map(x=>x[1]).concat(["#FFF176","#37474F","#777777","#000000","#FFFFFF"]));
  for(const theme of ["light","dark"])for(const color of palette){
    await page.evaluate(({theme,color})=>{themeMode=theme;accent=color;showAppearance();},{theme,color});
    const primary=await page.locator("#apply").evaluate(el=>{
      const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color,height:s.height,width:s.width};
    });
    const ratio=await page.evaluate(({bg,fg})=>{
      const lum=value=>{const rgb=value.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const a=lum(bg),b=lum(fg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    },{bg:primary.bg,fg:primary.fg});
    assert.ok(ratio>=4.5,theme+" "+color+" action contrast");
    assert.equal(primary.height,"48px");
    assert.equal(primary.width,"112px");
    assert.equal(await page.locator("#restore").evaluate(el=>getComputedStyle(el).boxShadow),"none");
    await page.evaluate(()=>{document.getElementById("apply").disabled=true;});
    assert.notEqual(await page.locator("#apply").evaluate(el=>getComputedStyle(el).backgroundColor),primary.bg);
    await page.dispatchEvent("#apply","pointerdown",{button:0,isPrimary:true,pointerId:997,clientX:10,clientY:10});
    await page.dispatchEvent("#apply","pointerup",{button:0,isPrimary:true,pointerId:997,clientX:10,clientY:10});
    assert.equal(await page.locator("#apply .tap-ripple").count(),0);
    await page.evaluate(()=>{document.getElementById("apply").disabled=false;});
  }
  await page.evaluate(()=>{themeMode="system";accent="#42A5F5";showAppearance();});
  for(const tab of ["tab-home","tab-sim-page"]){
    await page.locator("#"+tab).click();
    const actions=page.locator(tab==="tab-home"?"#home .action-button":"#sim-page .action-button");
    const a=await actions.nth(0).boundingBox(),b=await actions.nth(1).boundingBox();
    assert.equal(a.y,b.y);assert.equal(a.width,b.width);assert.equal(a.height,b.height);
    assert.equal(b.x-a.x-a.width,12);
  }
  assert.equal(await page.locator("#sim-page #device-heading").count(),0);
  assert.equal(await page.locator("#home #device-heading").count(),0);
  assert.equal(await page.locator("#settings-page #device-heading").innerText(),"设备状态（IMS）");
  await page.locator("#tab-home").click();

  for(const cards of [false,true])for(const width of [280,320,393]){
    await page.setViewportSize({width,height:852});
    await page.evaluate(cards=>{cardGroups=cards;showAppearance();},cards);
    const a=await page.locator("#apply").boundingBox(),b=await page.locator("#restore").boundingBox();
    assert.equal(a.width,b.width);assert.equal(a.height,b.height);
    if(width===280)assert.ok(b.y>a.y);else assert.equal(a.y,b.y);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:393,height:852});
  await page.evaluate(()=>{cardGroups=false;showAppearance();});
  const switchHit=page.locator("#enabled").locator("..");
  assert.equal(await page.locator("#enabled").evaluate(el=>getComputedStyle(el).opacity),"1");
  assert.equal(await page.locator("#enabled").evaluate(el=>getComputedStyle(el,"::after").backgroundColor),"rgb(238, 238, 238)");
  await page.evaluate(()=>{document.getElementById("enabled").disabled=true;});
  assert.equal(await page.locator("#enabled").evaluate(el=>getComputedStyle(el).opacity),"0.38");
  await switchHit.dispatchEvent("pointerdown",{button:0,isPrimary:true,pointerId:996,clientX:10,clientY:10});
  await switchHit.dispatchEvent("pointerup",{button:0,isPrimary:true,pointerId:996,clientX:10,clientY:10});
  assert.equal(await switchHit.locator(".tap-ripple").count(),0);
  await page.evaluate(()=>{document.getElementById("enabled").disabled=false;});
  // Root tabs replace, rather than push, and preserve untouched IMS controls.
  await page.locator("#enabled").check();
  await page.evaluate(()=>{document.getElementById("page-content").scrollTop=400;});
  const imsScroll=await page.locator("#page-content").evaluate(el=>el.scrollTop);
  const callsBeforeTabs=await page.evaluate(()=>window.bridgeCalls.length);
  await page.locator("#tab-sim-page").click();
  await visible("sim-page");
  assert.equal(await page.locator("#sim-page .sim-edit-row").count(),2);
  assert.equal(await page.locator("#sim-page input").count(),0);
  assert.equal(await page.locator("#sim-page .sim-info-card").count(),0);
  assert.equal(await page.locator("#page-title").innerText(),"TurboIMS Next");
  assert.equal(await page.locator("#back").isHidden(),true);
  await capture("sim-preferences");
  const bridgeCountBeforeEdit=await page.evaluate(()=>window.bridgeCalls.length);
  await page.locator("#sim-edit-country").click();
  await page.locator("#sheet-content input").fill("1");
  assert.equal(await page.locator("#sheet-actions button").last().isDisabled(),true);
  assert.match(await page.locator("#sheet-content .dialog-input-error").innerText(),/两位英文字母/);
  await page.locator("#sheet-content input").fill("jp");
  assert.equal(await page.locator("#sheet-content input").inputValue(),"JP");
  assert.equal(await page.locator("#sheet").getAttribute("data-ime"),"true");
  const imeLayout=await page.locator("#sheet").evaluate(el=>({
    align:getComputedStyle(el).alignItems,
    footer:getComputedStyle(el.querySelector(".dialog-footer")).position
  }));
  assert.equal(imeLayout.align,"flex-start");
  assert.equal(imeLayout.footer,"sticky");
  await systemBack("sim-page");
  await page.locator("#sheet").waitFor({state:"hidden"});
  assert.equal(await page.locator("#sim-custom-country-value").innerText(),"未设置");
  await page.locator("#sim-edit-country").click();
  await page.locator("#sheet-content input").fill("jp");
  await page.locator("#sheet-actions button").last().click();
  await page.locator("#sheet").waitFor({state:"hidden"});
  assert.equal(await page.locator("#sim-custom-country-value").innerText(),"JP");
  assert.equal(await page.evaluate(()=>window.bridgeCalls.length),bridgeCountBeforeEdit);
  await page.locator("#sim-edit-country").click();
  await page.locator("#sheet-actions button").first().click();
  await page.locator("#sheet").waitFor({state:"hidden"});
  assert.equal(await page.locator("#sim-custom-country-value").innerText(),"未设置");
  await page.locator("#sim-edit-carrier").click();
  await page.locator("#sheet-content input").fill("FarEasTone");
  await page.locator("#sheet-actions button").last().click();
  await page.locator("#sheet").waitFor({state:"hidden"});
  assert.equal(await page.locator("#sim-custom-carrier-value").innerText(),"FarEasTone");
  await page.locator("#sim-edit-carrier").click();
  await page.locator("#sheet-actions button").first().click();
  await page.locator("#sheet").waitFor({state:"hidden"});
  await page.locator("#tab-settings-page").click();
  await visible("settings-page");
  await capture("settings-light");
  assert.equal(await page.locator("#open-appearance").isVisible(),true);
  assert.ok(await page.evaluate(()=>history.length) <= rootLength+1);
  assert.equal(await page.evaluate(()=>history.state.dialog),undefined);
  await page.locator("#tab-home").click();
  assert.equal(await page.locator("#page-content").evaluate(el=>el.scrollTop),imsScroll);
  assert.equal(await page.locator("#enabled").isChecked(),true);
  assert.equal(await page.evaluate(()=>window.bridgeCalls.length),callsBeforeTabs);
  // The last IMS row stays above the navigation at the bottom of the scroll viewport.
  await page.evaluate(()=>{const el=document.getElementById("page-content");el.scrollTop=el.scrollHeight;});
  assert.ok((await page.locator("#restore").boundingBox()).y+
    (await page.locator("#restore").boundingBox()).height <= (await page.locator("#bottom-nav").boundingBox()).y);
  await capture("ims-bottom");
  await page.locator("#tab-sim-page").click();
  await page.locator("#sim-save").scrollIntoViewIfNeeded();
  await capture("sim-actions-light");
  await page.locator("#tab-home").click();
  await page.locator("#enabled").uncheck();
  const touch = await page.context().newCDPSession(page);
  const touchEvent = (type,x,y) => touch.send("Input.dispatchTouchEvent",{
    type,touchPoints:type === "touchEnd" ? [] : [{x,y}]
  });

  const tabBounds=await page.locator("#tab-sim-page").boundingBox();
  const tabX=Math.round(tabBounds.x+20),tabY=Math.round(tabBounds.y+20);
  await touchEvent("touchStart",tabX,tabY);
  await page.waitForTimeout(40);
  assert.equal(await page.locator("#tab-sim-page .tap-ripple").count(),0);
  await touchEvent("touchEnd");
  assert.equal(await page.locator("#tab-sim-page .tap-ripple").count(),1);
  await capture("bottom-nav-pressed");
  await visible("sim-page");
  await page.locator("#tab-home").click();
  const row = page.locator(".feature").first();
  const toggle = row.locator('input[role="switch"]');
  await row.scrollIntoViewIfNeeded();
  let bounds = await row.boundingBox();
  const tx = Math.round(bounds.x+18), ty = Math.round(bounds.y+24);
  await touchEvent("touchStart",tx,ty);
  // The broad row stays quiet, even before a tap can become a scroll.
  await page.waitForTimeout(40);
  assert.equal(await row.locator(".tap-ripple").count(),0);
  await page.screenshot({path:"preview/preference-pressed.png"});
  await touchEvent("touchEnd");
  await page.waitForTimeout(220);
  await page.screenshot({path:"preview/preference-after-tap.png"});
  await page.waitForTimeout(220);
  // The row updates a two-state switch; restoring DEFAULT is a separate action.
  assert.equal(await page.locator("#sheet").isVisible(),false);
  assert.equal(await toggle.getAttribute("aria-checked"),"false");
  assert.equal(await page.locator("#volte").inputValue(),"off");
  await row.click();
  assert.equal(await toggle.getAttribute("aria-checked"),"true");
  assert.equal(await page.locator("#volte").inputValue(),"on");
  const switchBounds=await row.locator(".switch-hit").boundingBox();
  const cx=Math.round(switchBounds.x+switchBounds.width/2),cy=Math.round(switchBounds.y+switchBounds.height/2);
  await touchEvent("touchStart",cx,cy);
  await touchEvent("touchEnd");
  assert.equal(await page.locator("#volte").inputValue(),"off");
  assert.equal(await row.locator(".switch-hit .tap-ripple").count(),1);
  await page.locator("#tab-settings-page").click();
  await page.locator("#reset-features").click();
  await visible("sheet");
  await page.locator("#sheet-content .option").first().click();
  await page.locator("#sheet").waitFor({state:"hidden"});
  await page.locator("#tab-home").click();
  await row.scrollIntoViewIfNeeded();
  bounds = await row.boundingBox();
  assert.equal(await page.locator("#volte").inputValue(),"default");
  assert.equal(await toggle.getAttribute("aria-checked"),"false");
  await page.waitForFunction(()=>!document.querySelector(".tap-ripple"));
  const sx = Math.round(bounds.x+30), sy = Math.round(bounds.y+32);
  await touchEvent("touchStart",sx,sy);
  await touchEvent("touchMove",sx,sy-45);
  await touchEvent("touchEnd");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#sheet").isVisible(),false);
  assert.equal(await page.locator(".tap-ripple").count(),0);
  await page.locator("#selection-choice").click();
  await capture("sim-dialog");
  await close();
  await page.locator("#tab-settings-page").click();
  await page.evaluate(()=>{window.nextReadDelay=300;});
  await page.locator("#probe").click();
  assert.equal(await page.locator("#probe").isDisabled(),true);
  assert.equal(await page.locator("#probe").innerText(),"正在检测…");
  await page.dispatchEvent("#refresh","pointerdown",{button:0,isPrimary:true,pointerId:999,clientX:10,clientY:10});
  assert.equal(await page.locator("#refresh .tap-ripple").count(),0);
  await page.waitForFunction(()=>!document.getElementById("probe").disabled);
  assert.equal(await page.locator("#message").innerText(),"检测完成");
  assert.match(await page.locator("#device").innerText(),/只读检测.*尚未验证/);
  assert.match(await page.locator("#sim-summary").innerText(),/SIM 卡 1、2/);
  await capture("detected-status");
  await page.locator("#refresh").click();
  await page.waitForFunction(()=>!document.getElementById("refresh").disabled);
  assert.equal(await page.locator("#probe").innerText(),"检测设备");
  assert.equal(await page.locator("#refresh").innerText(),"刷新");
  assert.equal(await page.locator("#interval-choice").isDisabled(),true);
  await page.locator("#tab-home").click();
  await page.locator("#periodic-check").check();
  await page.waitForFunction(()=>!document.getElementById("interval-choice").disabled);
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
  assert.match(await page.locator("#diagnostic-summary").innerText(),/读取正常/);
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
  const callsBeforeApply = await page.evaluate(()=>window.bridgeCalls.length);
  await page.locator("#apply").click();
  await visible("sheet");
  await capture("confirmation");
  // Mimics host webView.goBack(): no save/apply, no config loss.
  await page.evaluate(()=>history.back());
  await page.locator("#sheet").waitFor({state:"hidden"});
  await page.waitForFunction(()=>document.getElementById("message").textContent.includes("取消"));
  assert.equal(await page.locator("#enabled").isChecked(),true);
  assert.equal(await page.evaluate(before=>window.bridgeCalls.slice(before).some(x=>x==="apply" || x==="save"),callsBeforeApply),false);
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
  assert.equal(await page.locator("#card-groups").isChecked(),false);
  await page.locator("#card-groups").check();
  assert.equal(await page.locator("html").getAttribute("data-card-groups"),"true");
  assert.notEqual(await page.locator("#appearance-page .pref-group").first().evaluate(el=>getComputedStyle(el).boxShadow),"none");
  await page.locator("#card-groups").uncheck();
  await page.locator("#accent-scope-choice").click();
  await visible("accent-scope-page");
  assert.equal(await page.locator("#accent-toolbar").isChecked(),false);
  await page.locator("#accent-toolbar").check();
  assert.equal(await page.locator(".toolbar").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(75, 114, 146)");
  assert.equal(await page.locator("#status-bar-color").getAttribute("content"),"#41627E");
  assert.equal(await page.locator("#navigation-bar-color").getAttribute("content"),"#121212");
  assert.equal(await page.locator("#page-title").evaluate(el=>getComputedStyle(el).color),"rgb(255, 255, 255)");
  await page.locator("#back").click();
  await visible("appearance-page");
  await page.locator("#accent-choice").click();
  await visible("accent-page");
  await page.getByRole("button",{name:/Lemon Yellow/}).click();
  assert.equal(await page.locator(".toolbar").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(147, 121, 83)");
  assert.equal(await page.locator("#page-title").evaluate(el=>getComputedStyle(el).color),"rgb(16, 16, 16)");
  await page.locator("#back").click();
  await visible("appearance-page");
  await page.locator("#accent-scope-choice").click();
  await visible("accent-scope-page");
  await page.locator("#accent-toolbar").uncheck();
  await page.locator("#accent-section-labels").check();
  await page.locator("#accent-navigation-icons").check();
  assert.equal(await page.locator(".toolbar").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(18, 18, 18)");
  assert.equal(await page.locator("#back").evaluate(el=>getComputedStyle(el).color),"rgb(235, 183, 106)");
  await page.locator("#back").click();
  await visible("appearance-page");
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
  await fresh.waitForFunction(()=>document.documentElement.dataset.theme === "dark");
  assert.equal(await fresh.locator("#theme-color").getAttribute("content"),"#121212");
  assert.equal(await fresh.locator("#navigation-bar-color").getAttribute("content"),"#121212");
  await fresh.emulateMedia({colorScheme:"light"});
  await fresh.waitForFunction(()=>document.documentElement.dataset.theme === "light");
  await fresh.locator("#tab-settings-page").click();
  await fresh.locator("#open-appearance").click();
  await fresh.locator("#accent-choice").click();
  await fresh.locator("#custom-hex").fill("#12");
  assert.match(await fresh.locator("#hex-error").innerText(),/6 位/);
  assert.equal(await fresh.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),"#42A5F5");
  await fresh.locator("#custom-hex").fill("123456");
  await fresh.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()==="#123456");
  assert.equal(await fresh.locator("#apply-hex").count(),0);
  assert.match(await fresh.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--press-rgb")),/7,21,34/);
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
  await fresh.waitForFunction(()=>!document.querySelector(".tap-ripple"));
  await fresh.locator("#back").click();
  await fresh.locator("#settings-page").waitFor({state:"visible"});
  assert.equal(await fresh.locator("#tab-settings-page").evaluate(el=>getComputedStyle(el).color),"rgb(18, 52, 86)");
  assert.equal(await fresh.locator("#tab-settings-page").getAttribute("aria-current"),"page");
  await fresh.close();
  await page.setViewportSize({width:320,height:720});
  await capture("home-narrow");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  // Touch feedback is intentionally native press-only; scrolling never creates transient nodes.
  fs.writeFileSync("preview/verification.json",JSON.stringify({passed:true,rootLength,
    checked:["root tabs without history growth","empty SIM root","IMS scroll and form retention","bottom row clearance","accent navigation","nested history","dialog cancellation","stale confirmation forward","reload","hashchange","full-row choice",
      "diagnostic summary","unbroken horizontal JSON","text selection","dark theme","320px viewport","scoped compact ripples","quiet scroll rows","two-state IMS with independent restore",
      "real probe semantics","system theme changes","custom accent","reduced motion"],
    limitation:"Native Android 16 gesture dispatch and predictive animation require device verification."},null,2));
  if(errors.length) throw new Error(errors.join("\n"));
  await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
