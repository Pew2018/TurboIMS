const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
(async()=>{
  fs.mkdirSync("preview",{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
    const errors=[];
    page.on("pageerror",e=>errors.push(String(e)));
    await page.addInitScript(()=>{
      window.bridgeCalls=[];
      let config={schema:1,enabled:true,implementation_mode:"turboims",selection:"all",
        periodic_check_enabled:false,interval_seconds:7200,
        features:Object.fromEntries(["volte","vowifi","vt","vonr","cross_sim","ut","5g_nr"].map(k=>[k,"on"])),
        sim_profiles:{}};
      window.ksu={spawn(command,args,options,callback){
        const argv=JSON.parse(args),action=argv[1];
        window.bridgeCalls.push(action);
        if(action==="save") config=JSON.parse(atob(argv[2].slice(1,-1)));
        if(action==="restore") config={...config,enabled:false};
        const result={ok:true,uid:0,device:"husky",sdk:36,selinux_context:"u:r:ksu:s0",config,
          phase:"active",write_readback_verified:true,ims_configuration_verified:true,
          sim_profiles_verified:true,nr_configuration_verified:true,
          subscriptions:[{slot:0,sub_id:1,phase:"verified",ims:{registered:true,phase:"ims_registered"}}],
          watcher:{alive:false,mode:"completed"}};
        setTimeout(()=>{window[callback].stdout.emit("data",JSON.stringify(result));window[callback].emit("exit",0);},30);
      }};
    });
    await page.goto("http://127.0.0.1:8765/",{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.documentElement.dataset.loading==="false");
    const ready=()=>page.waitForFunction(()=>!busy && document.getElementById("sheet").hidden);
    const click=async id=>{await page.locator("#"+id).click();};
    const capture=async name=>{await page.waitForTimeout(180);await page.screenshot({path:"preview/"+name+".png"});};
    const cancel=async()=>{await click("sheet-close");await page.locator("#sheet").waitFor({state:"hidden"});};
    const choose=async(id,text)=>{await click(id);await page.locator("#sheet .option").filter({hasText:text}).first().click();await page.locator("#sheet").waitFor({state:"hidden"});};
    const openAppearance=async()=>{await click("tab-settings-page");await click("open-appearance");};
    const lum=hex=>{
      const rgb=hex.match(/\d+(?:\.\d+)?/g).slice(0,3).map(Number).map(v=>v/255)
        .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    };
    const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
    await capture("ims-light");
    // Exercise the existing IMS/SIM handlers with an asynchronous native bridge mock.
    await choose("selection-choice","SIM 卡 1");
    await page.locator("#periodic-check").check();
    await ready();
    await choose("interval-choice","每 2 小时");
    await ready();
    await page.locator("#volte-switch").uncheck();
    await click("apply");
    await page.locator("#sheet-actions button").click();
    await ready();
    assert.ok(await page.evaluate(()=>window.bridgeCalls.includes("apply")));
    await click("restore");
    await page.locator("#sheet-actions button").click();
    await ready();
    assert.ok(await page.evaluate(()=>window.bridgeCalls.includes("restore")));
    await click("tab-sim-page");
    await choose("sim-slot-choice","SIM");
    await choose("sim-country-choice","台湾");
    await choose("sim-carrier-choice","Chunghwa");
    for(const [id,value] of [["sim-edit-country","TW"],["sim-edit-carrier","Chunghwa Telecom"]]){
      await click(id);await page.locator("#text-editor-input").fill(value);
      assert.equal(await page.locator("#text-editor-input").evaluate(el=>getComputedStyle(el).borderBottomWidth),"1px");
      await click("text-editor-save");await page.locator("#text-editor-page").waitFor({state:"hidden"});
    }
    await capture("sim-light");
    for(const id of ["sim-save","sim-restore"]){
      const label=await page.locator("#"+id).innerText();
      await click(id);
      if(id==="sim-restore") await page.locator("#sheet-actions button").click();
      await ready();assert.equal(await page.locator("#"+id).innerText(),label);
    }
    await openAppearance();
    await choose("theme-choice","深色模式");
    await capture("appearance-dark");
    await choose("theme-choice","浅色模式");
    await choose("theme-choice","跟随系统");
    await page.emulateMedia({colorScheme:"dark"});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
    await page.emulateMedia({colorScheme:"light"});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==="light");
    await click("accent-choice");
    await page.locator("#oneplus-colors button").nth(2).click();
    await page.locator("#custom-hex").fill("#004D40");
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),"#004D40");
    await click("back");
    await click("accent-scope-choice");
    await page.locator("#accent-toolbar").check();
    await page.locator("#accent-navigation-icons").check();
    const colors=await page.evaluate(()=>[...onePlusColors,...materialColors].map(x=>x[1]).concat(["#FFF176","#004D40","#FFFFFF","#111111","#777777","#123456"]));
    const report=[];
    for(const theme of ["light","dark"])for(const color of colors){
      await page.evaluate(({theme,color})=>{themeMode=theme;accent=color;accentToolbar=true;showAppearance();},{theme,color});
      const styles=await page.evaluate(()=>{
        const style=id=>{const s=getComputedStyle(document.getElementById(id));return {bg:s.backgroundColor,fg:s.color};};
        const toolbar=getComputedStyle(document.querySelector(".toolbar"));
        return {toolbar:{bg:toolbar.backgroundColor,fg:toolbar.color},
          title:style("page-title"),back:style("back"),primary:style("apply"),secondary:style("restore"),
          meta:document.getElementById("status-bar-color").content,
          desiredIcons:document.documentElement.dataset.statusBarIcons,
          systemBg:getComputedStyle(document.documentElement).getPropertyValue("--system-status-bg").trim()};
      });
      assert.equal(styles.title.fg,styles.back.fg);
      const best=Math.max(ratio(styles.toolbar.bg,"rgb(255,255,255)"),ratio(styles.toolbar.bg,"rgb(17,17,17)"));
      assert.ok(Math.abs(ratio(styles.toolbar.bg,styles.title.fg)-best)<.001);
      assert.ok(ratio(styles.secondary.bg,styles.secondary.fg)>=4.5);
      assert.equal(styles.meta,styles.systemBg);
      assert.equal(styles.desiredIcons,styles.title.fg==="rgb(17, 17, 17)"?"dark":"light");
      report.push({theme,color,toolbarContrast:best,buttonContrast:ratio(styles.primary.bg,styles.primary.fg)});
    }
    for(const [name,theme,color] of [["toolbar-yellow","light","#E6A545"],["toolbar-purple","light","#9C27B0"],["toolbar-dark","dark","#004D40"]]){
      await page.evaluate(({theme,color})=>{themeMode=theme;accent=color;showAppearance();},{theme,color});
      await capture(name);
    }
    await page.locator("#accent-toolbar").uncheck();
    const plain=await page.locator("#page-title").evaluate(el=>getComputedStyle(el).color);
    await page.evaluate(()=>setAccent("#FFFFFF"));
    assert.equal(await page.locator("#page-title").evaluate(el=>getComputedStyle(el).color),plain);
    await click("back");await click("back");
    await click("open-diagnostics");
    await capture("diagnostics-dark");
    await click("back");assert.equal(await page.locator("#settings-page").isVisible(),true);
    // Disabled ON/OFF remain distinguishable; touch scroll must not add a ripple.
    await click("tab-home");
    await page.evaluate(()=>{themeMode="dark";accent="#42A5F5";cardGroups=true;showAppearance();});
    await capture("ims-dark-cards");
    await page.locator("#enabled").scrollIntoViewIfNeeded();
    await page.evaluate(()=>{document.getElementById("enabled").disabled=true;});
    assert.equal(await page.locator("#enabled").evaluate(el=>getComputedStyle(el).opacity),"0.42");
    await page.evaluate(()=>{document.getElementById("enabled").disabled=false;});
    const hit=page.locator("#enabled").locator(".."),box=await hit.boundingBox();
    const pointer={button:0,isPrimary:true,pointerId:701,clientX:box.x+24,clientY:box.y+24};
    await hit.dispatchEvent("pointerdown",pointer);
    await hit.dispatchEvent("pointermove",{...pointer,clientY:pointer.clientY+50});
    await hit.dispatchEvent("pointerup",{...pointer,clientY:pointer.clientY+50});
    assert.equal(await hit.locator(".tap-ripple").count(),0);
    await hit.dispatchEvent("pointerdown",pointer);await hit.dispatchEvent("pointerup",pointer);
    assert.equal(await hit.locator(".tap-ripple").count(),1);
    for(const width of [280,320,393]){
      await page.setViewportSize({width,height:852});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync("preview/contrast-report.json",JSON.stringify(report,null,2));
    console.log("UI polish browser regression passed: "+report.length+" color/theme combinations; IMS/SIM mock actions, navigation, dialogs, responsive layout and ripple.");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
