const { chromium } = require("playwright");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync("preview", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  await page.addInitScript(() => {
    const config={schema:1,enabled:false,selection:"all",interval_seconds:30,features:{
      volte:"on",vowifi:"on",vt:"on",vonr:"on",cross_sim:"on",ut:"on","5g_nr":"on"
    }};
    window.ksu={exec(command,options,callback){
      const result={ok:true,sdk:36,device:"husky",uid:0,config,
        status:{phase:"paused",subscriptions:[
          {slot:0,sub_id:1,phase:"paused",unsupported:[]},
          {slot:1,sub_id:2,phase:"paused",unsupported:[]}
        ]},watcher:{alive:true}};
      window[callback](0,JSON.stringify(result),"");
    }};
  });
  await page.goto("http://127.0.0.1:8765/",{waitUntil:"networkidle"});
  await page.screenshot({path:"preview/home-light.png",fullPage:true});
  await page.locator("#open-diagnostics").click();
  await page.locator("#export").click();
  await page.screenshot({path:"preview/diagnostics-light.png",fullPage:true});
  await page.locator("#back").click();
  await page.locator("#enabled").check();
  await page.locator("#apply").click();
  await page.screenshot({path:"preview/confirmation.png",fullPage:true});
  await page.locator("#sheet-close").click();
  await page.locator("#enabled").uncheck();
  await page.locator("#open-appearance").click();
  await page.screenshot({path:"preview/appearance-light.png",fullPage:true});
  await page.locator("#accent-choice").click();
  await page.screenshot({path:"preview/accent-colors.png",fullPage:true});
  await page.locator("#sheet-close").click();
  await page.locator("#theme-choice").click();
  await page.locator("#sheet-content .option").nth(2).click();
  await page.screenshot({path:"preview/appearance-dark.png",fullPage:true});
  await page.locator("#back").click();
  await page.screenshot({path:"preview/home-dark.png",fullPage:true});
  if(errors.length) throw new Error(errors.join("\n"));
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
