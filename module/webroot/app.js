"use strict";
const features = [
  ["volte", "VoLTE", "LTE 通话"],
  ["vowifi", "VoWiFi", "Wi-Fi 通话"],
  ["vt", "视频通话", "运营商视频通话"],
  ["vonr", "VoNR", "5G 通话"],
  ["cross_sim", "跨 SIM 通话", "使用另一张 SIM 卡的数据通话"],
  ["ut", "UT 补充服务", "通话补充服务"],
  ["5g_nr", "5G NR", "5G 网络模式与信号阈值"]
];
const $ = id => document.getElementById(id);
const simCountries = [
  ["CN","中国"],["HK","香港"],["MO","澳门"],["TW","台湾"],["JP","日本"],["KR","韩国"],
  ["US","美国"],["GB","英国"],["DE","德国"],["FR","法国"],["IT","意大利"],["ES","西班牙"],
  ["PT","葡萄牙"],["RU","俄罗斯"],["IN","印度"],["AU","澳大利亚"],["NZ","新西兰"],["SG","新加坡"],
  ["MY","马来西亚"],["TH","泰国"],["VN","越南"],["ID","印度尼西亚"],["PH","菲律宾"],["CA","加拿大"],
  ["MX","墨西哥"],["BR","巴西"],["AR","阿根廷"],["ZA","南非"]
];
const simCarriers = [["中国移动","China Mobile","CN"],["中国联通","China Unicom","CN"],["中国电信","China Telecom","CN"],["中国移动香港","CMHK","HK"],["香港电讯","HKT","HK"],["3香港","3HK","HK"],["SmarTone","SmarTone","HK"],["澳门电讯","CTM","MO"],["3澳门","3 Macau","MO"],["中华电信","Chunghwa Telecom","TW"],["台湾大哥大","Taiwan Mobile","TW"],["远传电信","FarEasTone","TW"],["NTT docomo","NTT docomo","JP"],["au","au by KDDI","JP"],["Softbank","Softbank","JP"],["Rakuten","Rakuten Mobile","JP"],["SK Telecom","SK Telecom","KR"],["KT","KT Corporation","KR"],["LG U+","LG U+","KR"],["AT&T","AT&T","US"],["T-Mobile","T-Mobile USA","US"],["Verizon","Verizon","US"],["Sprint","Sprint","US"],["EE","EE","GB"],["O2","O2 UK","GB"],["Three","Three UK","GB"],["Vodafone","Vodafone UK","GB"],["Singtel","Singtel","SG"],["StarHub","StarHub","SG"],["M1","M1","SG"],["Maxis","Maxis","MY"],["Celcom","Celcom","MY"],["Digi","Digi","MY"],["U Mobile","U Mobile","MY"],["AIS","AIS","TH"],["DTAC","DTAC","TH"],["True Move H","True Move H","TH"],["Viettel","Viettel Mobile","VN"],["Vinaphone","Vinaphone","VN"],["Mobifone","Mobifone","VN"],["Telkomsel","Telkomsel","ID"],["Indosat","Indosat Ooredoo","ID"],["XL Axiata","XL Axiata","ID"],["Globe","Globe Telecom","PH"],["Smart","Smart Communications","PH"],["DITO","DITO Telecommunity","PH"],["Jio","Reliance Jio","IN"],["Airtel","Bharti Airtel","IN"],["Vi","Vodafone Idea","IN"],["Telstra","Telstra","AU"],["Optus","Optus","AU"],["Vodafone","Vodafone AU","AU"],["Bell","Bell Mobility","CA"],["Rogers","Rogers Wireless","CA"],["Telus","Telus Mobility","CA"],["Telekom","T-Mobile DE","DE"],["Vodafone","Vodafone DE","DE"],["O2","O2 DE","DE"],["Orange","Orange FR","FR"],["SFR","SFR","FR"],["Free","Free Mobile","FR"],["Bouygues","Bouygues Telecom","FR"],["TIM","Telecom Italia","IT"],["Vodafone","Vodafone IT","IT"],["Wind Tre","Wind Tre","IT"],["Movistar","Movistar","ES"],["Vodafone","Vodafone ES","ES"],["Orange","Orange ES","ES"],["MTS","MTS","RU"],["MegaFon","MegaFon","RU"],["Beeline","Beeline","RU"],["Vivo","Vivo","BR"],["Claro","Claro","BR"],["TIM","TIM Brasil","BR"]];
function encodeBase64Utf8(value) {
  const encoded = encodeURIComponent(String(value));
  let binary = "";
  for (let i = 0; i < encoded.length;) {
    if (encoded[i] === "%") {
      binary += String.fromCharCode(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      binary += encoded[i++];
    }
  }
  return btoa(binary);
}
let simProfiles = {};
let simEditorProfiles = {};
let simBackendSignature = null;
let simSlots = [];
let selectedSimSlot = 0;
function simProfile(slot) { return simProfiles[String(slot)] || {country_iso:"",carrier_name:"",carrier_test_mccmnc:""}; }
function simEditorProfile(slot) {
  const key = String(slot);
  if (!simEditorProfiles[key]) {
    const saved = simProfile(slot);
    const country = String(saved.country_iso || "").toUpperCase();
    const carrier = String(saved.carrier_name || "");
    const countryPreset = simCountries.some(([code]) => code === country);
    const carrierPreset = simCarriers.some(([,display]) => display === carrier);
    simEditorProfiles[key] = {
      country_preset:countryPreset ? country : "",
      country_custom:country && !countryPreset ? country : "",
      carrier_preset:carrierPreset ? carrier : "",
      carrier_custom:carrier && !carrierPreset ? carrier : "",
      carrier_test_mccmnc:String(saved.carrier_test_mccmnc || "")
    };
  }
  return simEditorProfiles[key];
}
function simEffectiveProfile(slot) {
  const draft = simEditorProfile(slot);
  const profile = {country_iso:(draft.country_custom || draft.country_preset || "").toUpperCase(),
    carrier_name:draft.carrier_custom || draft.carrier_preset || ""};
  const mccmnc = String(draft.carrier_test_mccmnc || "").trim();
  if (mccmnc) profile.carrier_test_mccmnc = mccmnc;
  return profile;
}
function simPersistEditors() {
  storage.write("turboims-sim-editors",JSON.stringify(simEditorProfiles));
}
function simReconcileEditors(profiles) {
  const signature = JSON.stringify(profiles || {});
  if (signature === simBackendSignature) return;
  for (const [slot,saved] of Object.entries(profiles || {})) {
    const draft = simEditorProfiles[slot];
    const effective = draft ? simEffectiveProfile(Number(slot)) : null;
    const actual = {country_iso:String(saved.country_iso || "").toUpperCase(),
      carrier_name:String(saved.carrier_name || "")};
    const savedMccMnc = String(saved.carrier_test_mccmnc || "");
    if (savedMccMnc) actual.carrier_test_mccmnc = savedMccMnc;
    if (!draft || effective.country_iso !== actual.country_iso || effective.carrier_name !== actual.carrier_name
        || effective.carrier_test_mccmnc !== actual.carrier_test_mccmnc) {
      const countryPreset = simCountries.some(([code]) => code === actual.country_iso);
      const carrierPreset = simCarriers.some(([,display]) => display === actual.carrier_name);
      simEditorProfiles[slot] = {
        country_preset:countryPreset ? actual.country_iso : "",
        country_custom:actual.country_iso && !countryPreset ? actual.country_iso : "",
        carrier_preset:carrierPreset ? actual.carrier_name : "",
        carrier_custom:actual.carrier_name && !carrierPreset ? actual.carrier_name : "",
        carrier_test_mccmnc:actual.carrier_test_mccmnc
      };
    }
  }
  simBackendSignature = signature;
  simPersistEditors();
}
function simCountryLabel(code) {
  const item = simCountries.find(x => x[0] === String(code || "").toUpperCase());
  return item ? item[1] + " (" + item[0] + ")" : (code || "未设置");
}
function simSyncForm() {
  const draft = simEditorProfile(selectedSimSlot);
  $("sim-slot-choice").textContent = simSlots.length
    ? "SIM 卡 " + (selectedSimSlot + 1) : "未检测到 SIM";
  $("sim-country-choice").textContent = draft.country_preset
    ? simCountryLabel(draft.country_preset) : "未设置";
  $("sim-carrier-choice").textContent = draft.carrier_preset
    ? (simCarriers.find(x => x[1] === draft.carrier_preset)?.[0] || draft.carrier_preset)
    : "未设置";
  $("sim-custom-country-value").textContent = draft.country_custom || "未设置";
  $("sim-custom-carrier-value").textContent = draft.carrier_custom || "未设置";
  $("sim-carrier-test-mccmnc-value").textContent = draft.carrier_test_mccmnc || "未设置";
  $("sim-country-summary").textContent = "当前系统识别地区";
  $("sim-carrier-summary").textContent = "当前系统识别名称";
  const row = simSlots.find(x => x.slot === selectedSimSlot);
  $("sim-current").replaceChildren();
  if (!row) {
    $("sim-current").textContent = "请先检测设备。";
    return;
  }
  const title = document.createElement("strong");
  title.textContent = "SIM 卡 " + (selectedSimSlot + 1) + " · subId " + row.sub_id;
  const country = document.createElement("div");
  const countryLabel = document.createElement("span"); countryLabel.textContent = "国家或地区";
  const countryValue = document.createElement("span");
  const appliedCountry = row.effective?.sim_country_iso_override_string || "";
  countryValue.textContent = appliedCountry ? simCountryLabel(String(appliedCountry).toUpperCase()) : "未覆盖";
  country.append(countryLabel,countryValue);
  const carrier = document.createElement("div");
  const carrierLabel = document.createElement("span"); carrierLabel.textContent = "运营商";
  const carrierValue = document.createElement("span"); carrierValue.textContent = row.effective?.carrier_name_string || "未覆盖";
  carrier.append(carrierLabel,carrierValue);
  $("sim-current").append(title,country,carrier);
}
function renderSimPage(result) {
  const state = result.status || result;
  if (state.config?.sim_profiles) { simProfiles = state.config.sim_profiles || {}; simReconcileEditors(simProfiles); }
  const subscriptions = Array.isArray(state.subscriptions) ? state.subscriptions : [];
  simSlots = subscriptions.filter(x => Number.isInteger(x.slot) && x.slot >= 0)
    .map(x => ({...x, slot:x.slot}));
  if (simSlots.length && !simSlots.some(x => x.slot === selectedSimSlot)) selectedSimSlot = simSlots[0].slot;
  simSyncForm();
}
function simSetPreset(field,value) {
  simEditorProfiles[String(selectedSimSlot)] = {...simEditorProfile(selectedSimSlot),[field]:value};
  simPersistEditors(); simSyncForm();
}
function simSetCustom(field,value) {
  simEditorProfiles[String(selectedSimSlot)] = {...simEditorProfile(selectedSimSlot),[field]:value};
  simPersistEditors(); simSyncForm();
}
function simChoiceCountry() {
  const values = [["","不覆盖国家或地区"]];
  for (const [code,name] of simCountries) values.push([code,name + " (" + code + ")"]);
  choose("国家或地区", "选择要写入 SIM 国家或地区的预设。", values,
    simEditorProfile(selectedSimSlot).country_preset,
    value => simSetPreset("country_preset",value));
}
function simChoiceCarrier() {
  const values = [["","不覆盖运营商名称"]];
  for (const [name,display] of simCarriers) values.push([display,name + " · " + display]);
  choose("运营商名称", "选择系统读取的运营商名称预设。", values,
    simEditorProfile(selectedSimSlot).carrier_preset,
    value => simSetPreset("carrier_preset",value));
}
function simEditCountry() {
  const draft = simEditorProfile(selectedSimSlot);
  editTextPreference({
    title:"自定义国家码", label:"自定义国家码", inputLabel:"国家码",
    description:"使用两个字母的 ISO 国家或地区代码。",
    value:draft.country_custom, maxLength:2, inputMode:"text",
    transform:value => value.toUpperCase().replace(/[^A-Z]/g,"").slice(0,2),
    normalize:value => value.toUpperCase(),
    validate:value => value === "" || /^[A-Z]{2}$/.test(value),
    onSave:value => simSetCustom("country_custom",value),
    showClear:draft.country_custom !== "",
    errorMessage:"请输入两个英文字母"
  });
}
function simEditCarrier() {
  const draft = simEditorProfile(selectedSimSlot);
  editTextPreference({
    title:"自定义运营商名称", label:"自定义运营商名称", inputLabel:"运营商名称",
    description:"留空使用当前名称。",
    value:draft.carrier_custom, maxLength:128,
    validate:value => value.length <= 128,
    onSave:value => simSetCustom("carrier_custom",value.trim()),
    showClear:draft.carrier_custom !== "",
    errorMessage:"名称不能超过 128 个字符"
  });
}
function simEditCarrierTestMccMnc() {
  const draft = simEditorProfile(selectedSimSlot);
  editTextPreference({
    title:"Carrier test MCC/MNC", label:"Carrier test MCC/MNC", inputLabel:"MCC/MNC",
    description:"留空使用实际运营商身份。特定运营商可自动推导测试 MCC/MNC。",
    value:draft.carrier_test_mccmnc, maxLength:6, inputMode:"numeric",
    transform:value => value.replace(/[^0-9]/g,"").slice(0,6),
    validate:value => value === "" || /^[0-9]{5,6}$/.test(value),
    onSave:value => simSetCustom("carrier_test_mccmnc",value.trim()),
    showClear:draft.carrier_test_mccmnc !== "",
    errorMessage:"请输入 5 或 6 位数字"
  });
}
function simEffectiveProfiles() {
  const profiles = {};
  for (const slot of new Set([...Object.keys(simProfiles),...Object.keys(simEditorProfiles)])) {
    const profile = simEffectiveProfile(Number(slot));
    if (profile.country_iso || profile.carrier_name || profile.carrier_test_mccmnc) profiles[slot] = profile;
  }
  return profiles;
}
function simApplyConfig() {
  if (!savedConfig || !simSlots.length || busy) return;
  const config = {...savedConfig, sim_profiles:simEffectiveProfiles()};
  config.enabled = !!config.enabled;
  return operation(async () => {
    const saved = await TurboBridge.call("save", encodeBase64Utf8(JSON.stringify(config)));
    savedConfig = saved.config; simProfiles = saved.config.sim_profiles || {};
    simBackendSignature = JSON.stringify(simProfiles); simPersistEditors();
    render(await TurboBridge.call("apply"), true);
    navigate("sim-page");
  }, "正在保存 SIM 信息…", $("sim-save"));
}
function simRestore() {
  if (!savedConfig || !simSlots.length || busy) return;
  const next = {...simProfiles}; delete next[String(selectedSimSlot)];
  const nextEditors = {...simEditorProfiles}; delete nextEditors[String(selectedSimSlot)];
  const config = {...savedConfig, sim_profiles:next};
  return operation(async () => {
    const saved = await TurboBridge.call("save", encodeBase64Utf8(JSON.stringify(config)));
    savedConfig = saved.config; simProfiles = saved.config.sim_profiles || {};
    simEditorProfiles = nextEditors; simBackendSignature = JSON.stringify(simProfiles); simPersistEditors();
    render(await TurboBridge.call("apply"), true);
    navigate("sim-page");
  }, "正在恢复 SIM 信息…", $("sim-restore"));
}

// KernelSU Next can draw this page behind the system bars; its injected CSS supplies
// actual insets. The manager, not WebUI meta tags, still owns system icon colors.
if (location.hostname === "mui.kernelsu.org" && window.ksu?.enableInsets) {
  const insets = document.createElement("link");
  insets.rel = "stylesheet";
  insets.href = "/internal/insets.css";
  document.documentElement.dataset.edgeToEdge = "true";
  document.head.append(insets);
}
let busy = false;
const optionLabels = { default:"恢复原值", on:"开启", off:"关闭" };
const onePlusColors = [
  ["OnePlus Blue","#42A5F5"],["Golden","#CC6F4E"],
  ["Lemon Yellow","#E6A545"],["Grass Green","#7DC22F"],
  ["Charm Purple","#9575CD"],["Sky Blue","#26C6DA"],
  ["Vigour Red","#F06292"],["Fashion Pink","#BA68C8"]
];
const swatchButtons = [];
const materialColors = [
  ["Blue","#2196F3"],["Teal","#009688"],["Green","#4CAF50"],
  ["Red","#F44336"],["Orange","#FF9800"],["Purple","#9C27B0"],
  ["Cyan","#00BCD4"],["Indigo","#3F51B5"],["Pink","#E91E63"],
  ["Blue Grey","#607D8B"],["Deep Orange","#FF5722"],["Light Green","#8BC34A"]
];
const storage = {
  read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
};
let themeMode = storage.read("turboims-theme", "system");
if (!["system","light","dark"].includes(themeMode)) themeMode = "system";
let accent = storage.read("turboims-accent", "#42A5F5").toUpperCase();
if (!/^#[0-9A-F]{6}$/.test(accent)) accent = "#42A5F5";
let accentToolbar = storage.read("turboims-accent-toolbar","false") === "true";
let accentSectionLabels = storage.read("turboims-accent-section-labels","false") === "true";
let accentNavigationIcons = storage.read("turboims-accent-navigation-icons","false") === "true";
let cardGroups = storage.read("turboims-card-groups","false") === "true";
try {
  const editors = JSON.parse(storage.read("turboims-sim-editors","{}"));
  if (editors && typeof editors === "object") simEditorProfiles = editors;
} catch (_) { simEditorProfiles = {}; }
let accentInputInitialized = false;
let accentInputTimer = null;
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
function colorHex(rgb) { return "#" + rgb.map(value => Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,"0")).join("").toUpperCase(); }
function relativeLuminance(rgb) {
  const linear = rgb.map(c => {
    c /= 255;
    return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4;
  });
  return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
}
function contrastRatio(a,b) {
  const lighter = Math.max(a,b), darker = Math.min(a,b);
  return (lighter + .05) / (darker + .05);
}
const LIGHT_FOREGROUND = "#FFFFFF";
const DARK_FOREGROUND = "#000000";
const MIN_TEXT_CONTRAST = 4.5;
function foregroundForRgb(rgb) {
  const background = relativeLuminance(rgb);
  const lightContrast = contrastRatio(background,1);
  const darkContrast = contrastRatio(background,0);
  // Material pairs a colored container with a dedicated "on" color. Using
  // the higher-contrast black/white role guarantees AA contrast for normal
  // toolbar and button text, including arbitrary user-supplied HEX colors.
  const foreground = darkContrast >= lightContrast ? DARK_FOREGROUND : LIGHT_FOREGROUND;
  const contrast = Math.max(lightContrast,darkContrast);
  return {color:foreground,contrast};
}
function showAppearance() {
  const dark = themeMode === "dark" || (themeMode === "system" && !!media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const chromeColor = dark ? "#121212" : "#FFFFFF";
  document.documentElement.style.setProperty("--accent", accent);
  const root = document.documentElement;
  root.dataset.accentToolbar = String(accentToolbar);
  root.dataset.accentSectionLabels = String(accentSectionLabels);
  root.dataset.accentNavigationIcons = String(accentNavigationIcons && !accentToolbar);
  root.dataset.cardGroups = String(cardGroups);
  $("card-groups").checked = cardGroups;
  $("accent-toolbar").checked = accentToolbar;
  $("accent-section-labels").checked = accentSectionLabels;
  $("accent-navigation-icons").checked = accentNavigationIcons;

  const rgb = [1,3,5].map(i => parseInt(accent.slice(i,i+2),16));
  const surfaceRgb = dark ? [18,18,18] : [255,255,255];

  // A colored toolbar is a primary surface: preserve the selected hue instead
  // of muting it toward grey. In dark mode, blend it slightly toward the dark
  // surface to avoid an excessively bright large area while keeping its hue.
  const toolbarRgb = accentToolbar
    ? (dark ? rgb.map(value => Math.round(value*.78 + 18*.22)) : rgb)
    : surfaceRgb;
  const toolbarColor = accentToolbar ? colorHex(toolbarRgb) : chromeColor;
  const statusColor = toolbarColor;
  const toolbarOnColor = foregroundForRgb(toolbarRgb);
  const toolbarForeground = toolbarOnColor.color;

  root.style.setProperty("--toolbar-tint",toolbarColor);
  root.style.setProperty("--toolbar-foreground",toolbarForeground);
  root.style.setProperty("--toolbar-contrast",toolbarOnColor.contrast.toFixed(3));
  root.style.setProperty("--system-status-bg",statusColor);
  root.style.setProperty("--system-navigation-bg",dark ? "#121212" : "#FFFFFF");

  // Chromium/WebView uses theme-color as its available system-bar hint. KernelSU
  // still owns the actual icon mode, so keep the color and color-scheme hints in sync.
  const metaColors = {
    "theme-color":toolbarColor,
    "status-bar-color":statusColor,
    "navigation-bar-color":dark ? "#121212" : "#FFFFFF"
  };
  for (const [id,color] of Object.entries(metaColors)) {
    const meta = document.getElementById(id);
    if (meta) meta.setAttribute("content",color);
  }

  root.style.setProperty("--press-rgb", rgb.map(x => Math.round(x * .4 + (dark ? 255 : 0) * .6)).join(","));
  root.style.setProperty("--accent-track", "rgba(" + rgb.join(",") + ",.35)");

  const accentOnColor = foregroundForRgb(rgb);
  const onAccent = accentOnColor.color;
  root.style.setProperty("--accent-text",onAccent);
  root.style.setProperty("--on-accent",onAccent);
  root.style.setProperty("--on-accent-contrast",accentOnColor.contrast.toFixed(3));
  root.style.setProperty("--action-fill",accent);
  root.style.setProperty("--action-ripple",onAccent);

  const tonalStrength = dark ? .18 : .12;
  const tonalSurfaceRgb = dark ? [32,32,32] : [255,255,255];
  const tonalRgb = rgb.map((value,index) => Math.round(value * tonalStrength + tonalSurfaceRgb[index] * (1 - tonalStrength)));
  const pressedRgb = rgb.map((value,index) => Math.round(value * (tonalStrength + .06) + tonalSurfaceRgb[index] * (1 - tonalStrength - .06)));
  root.style.setProperty("--action-border","transparent");
  root.style.setProperty("--action-tonal",colorHex(tonalRgb));
  root.style.setProperty("--action-tonal-pressed",colorHex(pressedRgb));
  root.style.setProperty("--switch-on-track","rgba(" + rgb.join(",") + ",.35)");

  $("theme-choice").textContent = {system:"跟随系统",light:"浅色模式",dark:"深色模式"}[themeMode];
  const chosen = [...onePlusColors,...materialColors].find(([,hex]) => hex === accent);
  $("accent-label").textContent = chosen ? chosen[0] : accent;
  for (const [button,color] of swatchButtons) button.setAttribute("aria-pressed",String(color === accent));
  const blend = (x,y,t) => Math.round(x*(1-t)+y*t);
  const ink = rgb.map(x => blend(x,dark ? 255 : 0,dark ? .22 : .36));
  root.style.setProperty("--accent-ink", "rgb(" + ink.join(",") + ")");
  $("accent-swatch").style.setProperty("--accent",accent);
}
if (media) {
  if (media.addEventListener) media.addEventListener("change", showAppearance);
  else if (media.addListener) media.addListener(showAppearance);
}
let sheetFinishing = false;
function finishSheet(value = false) {
  if ($("sheet").hidden || sheetFinishing) return;
  $("sheet").removeAttribute("data-ime");
  document.documentElement.style.removeProperty("--visual-viewport-top");
  document.documentElement.style.removeProperty("--visual-viewport-height");
  sheetFinishing = true;
  const resolve = sheetResolve;
  sheetResolve = null;
  const focus = sheetFocus;
  sheetFocus = null;
  const complete = () => {
    $("sheet").hidden = true;
    sheetFinishing = false;
    document.body.style.overflow = "";
    $("page-content").style.overflow = "";
    if (focus && focus.isConnected) focus.focus({preventScroll:true});
    if (resolve) resolve(value);
  };
  if (window.TouchFeedback) window.TouchFeedback.closeDialog($("sheet"), complete);
  else complete();
}
// Dismiss through the same history entry consumed by Android/WebView back.
function dismissSheet(value = false) {
  if ($("sheet").hidden || sheetClosing) return;
  sheetClosing = true;
  sheetAnswer = value;
  history.back();
}
let sheetClosing = false;
let sheetAnswer = false;
let sheetHistoryToken = null;
let sheetSequence = 0;
let sheetResolve = null;
let sheetFocus = null;
function openSheet(title, description) {
  if (!$("sheet").hidden) return Promise.resolve(false);
  delete $("sheet").dataset.editor;
  rememberScroll();
  sheetClosing = false;
  sheetAnswer = false;
  sheetHistoryToken = ++sheetSequence;
  history.pushState({turboims:true,page:currentPage,dialog:sheetHistoryToken,scroll:$("page-content").scrollTop || 0}, "", routeURL(currentPage, sheetHistoryToken));
  sheetFocus = document.activeElement;
  $("sheet-title").textContent = title;
  $("sheet-description").textContent = description || "";
  $("sheet-content").replaceChildren();
  $("sheet-content").removeAttribute("role");
  $("sheet-actions").replaceChildren();
  $("sheet").hidden = false;
  window.TouchFeedback?.openDialog($("sheet"));
  document.body.style.overflow = "hidden";
  $("page-content").style.overflow = "hidden";
  $("sheet-close").focus();
  return new Promise(resolve => { sheetResolve = resolve; });
}
$("sheet-close").onclick = () => setTimeout(() => dismissSheet(false), 150);
$("sheet").onclick = e => { if (e.target === $("sheet")) dismissSheet(false); };
document.addEventListener("keydown", e => {
  if ($("sheet").hidden) return;
  if (e.key === "Escape") { e.preventDefault(); dismissSheet(false); }
  if (e.key === "Tab") {
    const focusables = [...$("sheet").querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length-1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
function actionButton(title, onClick, secondary = false) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = title;
  if (secondary) button.className = "secondary";
  button.onclick = onClick; button.dataset.ripple = "control";
  window.TouchFeedback?.bind(button); return button;
}
let textEditor = null;
function editTextPreference(options) {
  textEditor = options;
  $("text-editor-heading").textContent = options.label || options.title;
  $("text-editor-input-label").textContent = options.inputLabel || options.label || options.title;
  $("text-editor-hint").textContent = options.description || "";
  const field = $("text-editor-input");
  field.value = options.value || "";
  field.maxLength = options.maxLength || 128;
  field.inputMode = options.inputMode || "text";
  field.autocomplete = "off"; field.spellcheck = false;
  field.setAttribute("aria-label",options.inputLabel || options.label || options.title);
  $("text-editor-error").textContent = "";
  $("text-editor-actions").replaceChildren();
  const save = document.createElement("button");
  save.id = "text-editor-save"; save.type = "button";
  save.className = "action-button action-button--primary";
  save.textContent = "保存";
  save.onclick = () => {
    const value = options.normalize ? options.normalize(field.value.trim()) : field.value.trim();
    if (!options.validate(value)) { updateTextEditorValidation(); return; }
    options.onSave(value);
    textEditor = null;
    history.back();
  };
  if (options.showClear && options.value) {
    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "action-button action-button--secondary";
    clear.textContent = "清除";
    clear.onclick = () => { options.onSave(""); textEditor = null; history.back(); };
    $("text-editor-actions").append(clear);
  }
  $("text-editor-actions").append(save);
  field.oninput = () => {
    const transformed = options.transform ? options.transform(field.value) : field.value;
    if (field.value !== transformed) {
      const cursor = field.selectionStart;
      field.value = transformed;
      field.setSelectionRange(Math.min(cursor ?? transformed.length,transformed.length),
        Math.min(cursor ?? transformed.length,transformed.length));
    }
    updateTextEditorValidation();
  };
  field.onfocus = updateTextEditorViewport;
  field.oninput();
  navigate("text-editor-page");
  setTimeout(() => {
    field.focus();
    field.setSelectionRange(field.value.length,field.value.length);
    updateTextEditorViewport();
  },80);
}
function updateTextEditorValidation() {
  if (!textEditor) return;
  const field = $("text-editor-input");
  const value = textEditor.normalize ? textEditor.normalize(field.value.trim()) : field.value.trim();
  const valid = textEditor.validate(value);
  $("text-editor-save").disabled = !valid;
  $("text-editor-error").textContent = valid ? "" : textEditor.errorMessage || "输入格式不正确";
  field.setAttribute("aria-invalid",String(!valid));
}
function updateTextEditorViewport() {
  if (currentPage !== "text-editor-page") return;
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : (window.innerHeight || 600);
  document.documentElement.style.setProperty("--app-viewport-height",Math.max(180,height)+"px");
  setTimeout(() => $("text-editor-input").scrollIntoView({block:"center"}),0);
}
function updateWebViewViewport() {
  if (currentPage === "text-editor-page") updateTextEditorViewport();
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize",updateWebViewViewport);
  window.visualViewport.addEventListener("scroll",updateWebViewViewport);
}
window.addEventListener("resize",updateWebViewViewport);
function choose(title, description, values, current, onSelect) {
  if (!$("sheet").hidden) return;
  openSheet(title, description);
  $("sheet-content").setAttribute("role","radiogroup");
  $("sheet-content").setAttribute("aria-labelledby","sheet-title");
  for (const [value, label] of values) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "option";
    button.textContent = label;
    button.setAttribute("aria-selected", String(value === current));
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(value === current));
    const mark = document.createElement("span"); mark.className = "radio-mark";
    mark.setAttribute("aria-hidden","true"); button.append(mark);
    button.onclick = () => {
      if (sheetClosing || sheetFinishing) return;
      for (const item of $("sheet-content").children) {
        const selected = item === button;
        item.setAttribute("aria-selected", String(selected));
        item.setAttribute("aria-checked", String(selected));
      }
      onSelect(value); setTimeout(() => dismissSheet(true), 150);
    };
    $("sheet-content").append(button);
    window.TouchFeedback?.bind(button);
  }
}
function choiceFor(select, button) {
  const option = [...select.options].find(x => x.value === select.value);
  button.textContent = option?.textContent || select.value;
  if (select.id === "interval") $("interval-summary").textContent = option?.textContent || select.value;
  button.setAttribute("aria-label", (button.dataset.title || "选择设置") + "，" + button.textContent);
  button.onclick = () => choose(button.dataset.title || "选择设置", "", [...select.options].map(x => [x.value,x.textContent]), select.value, value => {
    select.value = value; choiceFor(select,button);
    if (select.id === "implementation_mode") updateImplementationModeDescription();
    if (select.id === "interval") saveSchedule();
  });
}
async function ask(title, description) {
  const answer = openSheet(title, description);
  $("sheet-actions").append(actionButton("确认", () => setTimeout(() => dismissSheet(true), 150)));
  return answer;
}
$("theme-choice").onclick = () => choose("显示模式", "", [
  ["system","跟随系统"],["light","浅色模式"],["dark","深色模式"]
], themeMode, value => { themeMode = value; storage.write("turboims-theme",value); showAppearance(); });
function setAccent(value) {
  clearTimeout(accentInputTimer);
  accent = value;
  storage.write("turboims-accent",accent);
  $("custom-hex").value = accent;
  $("hex-error").textContent = "";
  showAppearance();
}
function buildColors(target, colors) {
  for (const [name,color] of colors) {
    const item = document.createElement("button"); item.type = "button";
    item.className = "swatch-item";
    item.setAttribute("aria-label",name + " " + color);
    const square = document.createElement("span"); square.className = "swatch";
    square.style.setProperty("--swatch",color);
    const label = document.createElement("span"); label.textContent = name;
    item.append(square,label);
    item.onclick = () => setAccent(color);
    target.append(item);
    window.TouchFeedback?.bind(item);
    swatchButtons.push([item,color]);
  }
}
buildColors($("oneplus-colors"),onePlusColors);
buildColors($("material-colors"),materialColors);
$("accent-choice").onclick = () => navigate("accent-page");
$("accent-scope-choice").onclick = () => navigate("accent-scope-page");
$("custom-hex").oninput = () => {
  const field = $("custom-hex");
  const start = field.selectionStart;
  const raw = field.value.toUpperCase().replace(/[^#0-9A-F]/g,"");
  const hex = raw.replace(/^#/,"").replace(/#/g,"").slice(0,6);
  const normalized = "#" + hex;
  if (field.value !== normalized) {
    field.value = normalized;
    const pos = Math.max(1,Math.min(normalized.length,start ?? normalized.length));
    field.setSelectionRange(pos,pos);
  }
  const valid = /^[0-9A-F]{6}$/.test(hex);
  $("hex-error").textContent = valid ? "" : "请输入 6 位 HEX 颜色值";
  clearTimeout(accentInputTimer);
  if (valid) setAccent(normalized);
};
function persistAccentScope() {
  accentToolbar = $("accent-toolbar").checked;
  accentSectionLabels = $("accent-section-labels").checked;
  accentNavigationIcons = $("accent-navigation-icons").checked;
  storage.write("turboims-accent-toolbar",String(accentToolbar));
  storage.write("turboims-accent-section-labels",String(accentSectionLabels));
  storage.write("turboims-accent-navigation-icons",String(accentNavigationIcons));
  showAppearance();
}
for (const id of ["accent-toolbar","accent-section-labels","accent-navigation-icons"])
  $(id).onchange = persistAccentScope;
$("card-groups").onchange = () => {
  cardGroups = $("card-groups").checked;
  storage.write("turboims-card-groups",String(cardGroups));
  showAppearance();
};
showAppearance();
const pageTitles = {home:"IMS","sim-page":"SIM 卡信息","settings-page":"设置",
  "appearance-page":"外观","accent-page":"强调色","accent-scope-page":"强调色应用范围","diagnostics-page":"诊断与验证",
  "diagnostic-data-page":"完整诊断数据","operation-data-page":"操作结果","text-editor-page":"编辑"};
const pageRoutes = {home:"","sim-page":"sim","settings-page":"settings",
  "appearance-page":"appearance","accent-page":"accent","accent-scope-page":"accent-scope","diagnostics-page":"diagnostics",
  "diagnostic-data-page":"diagnostic-data","operation-data-page":"operation-data","text-editor-page":"edit"};
const primaryPages = ["home","sim-page","settings-page"];
const primaryScroll = {home:0,"sim-page":0,"settings-page":0};
let currentPage = null;
let skippingStaleDialog = false;
function routeURL(page, dialog = null) {
  return "#/" + pageRoutes[page] + (dialog ? "?dialog=" + dialog : "");
}
function pageFromHash() {
  const route = location.hash.replace(/^#\/?/, "").split("?")[0];
  return Object.keys(pageRoutes).find(page => pageRoutes[page] === route) || "home";
}
function rememberScroll() {
  const scroll = $("page-content").scrollTop || 0;
  if (primaryPages.includes(currentPage)) primaryScroll[currentPage] = scroll;
  if (history.state?.turboims) history.replaceState({...history.state,scroll}, "", location.hash);
}
function showPage(page, scroll = 0) {
  const changed = currentPage !== page;
  if (currentPage === "text-editor-page" && page !== "text-editor-page") {
    $("text-editor-input").blur();
    textEditor = null;
    document.documentElement.style.removeProperty("--app-viewport-height");
  }
  currentPage = page;
  const primary = primaryPages.includes(page);
  for (const id of Object.keys(pageTitles)) $(id).hidden = id !== page;
  $("back").hidden = primary;
  $("bottom-nav").hidden = !primary;
  $("page-content").dataset.primary = String(primary);
  $("page-title").textContent = page === "text-editor-page" ? (textEditor?.title || "编辑") : "TurboIMS Next";
  for (const id of primaryPages) {
    const tab = $("tab-"+id);
    if (id === page) tab.setAttribute("aria-current","page");
    else tab.removeAttribute("aria-current");
  }
  if (page === "accent-page" && !accentInputInitialized) { $("custom-hex").value = accent; accentInputInitialized = true; }
  if (changed) $("page-content").scrollTop = scroll;
}
function synchronizeHistory() {
  const page = pageFromHash();
  let state = history.state;
  if (!state?.turboims || state.page !== page) {
    state = {turboims:true,page,scroll:primaryScroll[page] || 0};
    history.replaceState(state, "", routeURL(page));
  }
  // Forward navigation must never resurrect an already answered confirmation.
  if (state.dialog && (state.dialog !== sheetHistoryToken || $("sheet").hidden)) {
    if (!skippingStaleDialog) {
      skippingStaleDialog = true;
      history.back();
    }
    return;
  }
  skippingStaleDialog = false;
  if (!state.dialog && !$("sheet").hidden) {
    const answer = sheetClosing ? sheetAnswer : false;
    sheetHistoryToken = null;
    sheetClosing = false;
    finishSheet(answer);
  }
  showPage(page, state.scroll || 0);
}
function navigate(page) {
  if (!Object.hasOwn(pageTitles,page) || page === currentPage || !$("sheet").hidden) return;
  rememberScroll();
  const primary = primaryPages.includes(page);
  const state = {turboims:true,page,scroll:primary ? primaryScroll[page] : 0};
  // Tabs replace the current root; only child pages create a back destination.
  if (primary) history.replaceState(state, "", routeURL(page));
  else history.pushState(state, "", routeURL(page));
  synchronizeHistory();
}
window.addEventListener("popstate", synchronizeHistory);
window.addEventListener("hashchange", synchronizeHistory);
history.scrollRestoration = "manual";
// Deep links begin at their owning root, without adding an artificial exit step.
const initialPage = pageFromHash();
if (!history.state?.turboims) {
  const root = primaryPages.includes(initialPage) ? initialPage : "settings-page";
  history.replaceState({turboims:true,page:root,scroll:0}, "", routeURL(root));
  synchronizeHistory();
  if (initialPage === "accent-page") navigate("appearance-page");
  if (["diagnostic-data-page","operation-data-page"].includes(initialPage)) navigate("diagnostics-page");
  if (initialPage !== root) navigate(initialPage);
} else {
  synchronizeHistory();
}
for (const id of primaryPages) $("tab-"+id).onclick = () => navigate(id);

// SIM 卡信息 page
$("sim-slot-choice").onclick = () => choose("目标 SIM 卡", "选择要修改的活跃 SIM 卡。",
  simSlots.map(x => [String(x.slot), "SIM 卡 " + (x.slot + 1) + " · subId " + x.sub_id]),
  String(selectedSimSlot), value => { selectedSimSlot = Number(value); simSyncForm(); });
$("sim-country-choice").onclick = simChoiceCountry;
$("sim-carrier-choice").onclick = simChoiceCarrier;
$("sim-edit-country").onclick = simEditCountry;
$("sim-edit-carrier").onclick = simEditCarrier;
$("sim-edit-carrier-test-mccmnc").onclick = simEditCarrierTestMccMnc;
$("sim-save").onclick = simApplyConfig;
$("sim-restore").onclick = async () => {
  if (!await ask("恢复 SIM 信息？", "移除当前 SIM 的国家或地区及运营商覆盖，不清除 IMS 配置。")) return;
  simRestore();
};

$("open-appearance").onclick = () => navigate("appearance-page");
$("open-diagnostics").onclick = () => navigate("diagnostics-page");
$("open-diagnostic-data").onclick = () => navigate("diagnostic-data-page");
$("open-operation-data").onclick = () => navigate("operation-data-page");
$("back").onclick = () => history.back();
function clickablePreference(button) {
  const row = button.closest(".setting-row,.feature");
  if (!row) return;
  row.dataset.feedback = "row";
  row.setAttribute("aria-disabled", String(button.disabled || false));
  row.onclick = event => {
    if (!busy && !event.target.closest("button,input,select")) button.click();
  };
}
for (const id of ["selection-choice","interval-choice","implementation-mode-choice","theme-choice","accent-choice","accent-scope-choice"]) clickablePreference($(id));
for (const [id,title,buttonId] of [
  ["selection","应用到","selection-choice"],
  ["interval","检查间隔","interval-choice"],
  ["implementation_mode","执行方式","implementation-mode-choice"]
]) {
  const button = $(buttonId);
  if (!button) throw new Error("Missing WebUI preference button: " + buttonId);
  button.dataset.title = title;
  choiceFor($(id),button);
}
const featureControls = new Map();
// Persisted IMS modes are DEFAULT / ON / OFF. The visual switch has only
// ON / OFF positions; the individual DEFAULT action lives in Settings.
function syncFeatureSwitch(select, toggle) {
  const state = select.value;
  toggle.checked = state === "on";
  toggle.dataset.state = state;
  toggle.setAttribute("aria-checked", String(toggle.checked));
  toggle.setAttribute("aria-label", toggle.dataset.title + "，" +
    (state === "default" ? "使用原值，点击强制开启" : state === "on" ? "强制开启" : "强制关闭"));
}
function setFeatureMode(select, toggle, mode) {
  if (busy) return;
  select.value = mode;
  syncFeatureSwitch(select,toggle);
}
for (const [key, title, description] of features) {
  const row = document.createElement("div"); row.className = "feature";
  const text = document.createElement("span"); text.className = "row-copy";
  const name = document.createElement("strong"); name.textContent = title;
  const desc = document.createElement("small"); desc.textContent = description;
  text.append(name, desc);
  const select = document.createElement("select"); select.id = key;
  select.className = "visually-hidden"; select.tabIndex = -1;
  select.setAttribute("aria-hidden","true");
  for (const [value, label] of Object.entries(optionLabels)) {
    const option = document.createElement("option"); option.value = value;
    option.textContent = label; select.append(option);
  }
  select.value = "default";
  const controls = document.createElement("span"); controls.className = "feature-controls";
  const switchHit = document.createElement("span"); switchHit.className = "switch-hit";
  switchHit.dataset.ripple = "control";
  const toggle = document.createElement("input");
  toggle.type = "checkbox"; toggle.id = key + "-switch";
  toggle.className = "feature-switch"; toggle.setAttribute("role","switch");
  toggle.dataset.title = title;
  toggle.onchange = () => setFeatureMode(select,toggle,toggle.checked ? "on" : "off");
  switchHit.append(toggle);
  controls.append(switchHit);
  row.dataset.feedback = "row";
  row.setAttribute("aria-disabled","false");
  row.onclick = event => {
    if (!busy && !event.target.closest("button,input,select"))
      setFeatureMode(select,toggle,select.value === "on" ? "off" : "on");
  };
  row.append(text,controls,select);
  $("features").append(row);
  featureControls.set(key,{toggle});
  window.TouchFeedback?.bind(switchHit);
  syncFeatureSwitch(select,toggle);
}
$("reset-features").onclick = () => {
  const available = features.filter(([key]) => $(key).value !== "default");
  if (!available.length) {
    message("所有 IMS 功能均使用原值", false, "neutral", "无需调整。"); return;
  }
  choose("恢复单项原值", "选择功能，返回 IMS 应用配置后生效。",
    available.map(([key,title]) => [key,title]), "",
    key => {
      setFeatureMode($(key),featureControls.get(key).toggle,"default");
      message("已选择恢复原值", false, "neutral", "返回 IMS 点击应用配置后生效。");
    });
};

function message(text, error = false, tone = error ? "danger" : "neutral", detail = "") {
  $("message").textContent = text;
  $("message").className = error && tone === "danger" ? "error" : "";
  $("device").textContent = detail;
  $("status-indicator").dataset.tone = tone;
  if (currentPage === "diagnostics-page") $("diagnostic-notice").textContent = [text,detail].filter(Boolean).join("，");
}
let savedConfig = null;
function updatePeriodicControl() {
  const disabled = !$("periodic-check").checked;
  $("interval-row").setAttribute("aria-disabled",String(disabled));
  $("interval-choice").disabled = disabled;
}
async function saveSchedule() {
  if (!savedConfig || busy) return;
  const periodic = $("periodic-check").checked;
  const interval = Number($("interval").value);
  try {
    await operation(async () => {
      const config = {...savedConfig, periodic_check_enabled:periodic, interval_seconds:interval};
      const result = await TurboBridge.call("save", encodeBase64Utf8(JSON.stringify(config)));
      savedConfig = result.config;
      render(await TurboBridge.call("status"));
    }, "正在更新定时任务…");
  } finally {
    // Save errors keep the previous schedule rather than a misleading switch.
    if (savedConfig) {
      $("periodic-check").checked = !!savedConfig.periodic_check_enabled;
      $("interval").value = String(savedConfig.interval_seconds);
      choiceFor($("interval"),$("interval-choice"));
      updatePeriodicControl();
    }
  }
}
$("periodic-check").onchange = () => { updatePeriodicControl(); saveSchedule(); };
function updateImplementationModeDescription() {
  $("implementation-mode-description").textContent = $("implementation_mode").value === "carrier_ims"
    ? "使用 Carrier IMS 兼容路径，可配合 Carrier test MCC/MNC。"
    : "使用 TurboIMS 原有 IMS 配置路径。";
}
function form(config) {
  savedConfig = config;
  simProfiles = config.sim_profiles || {};
  $("enabled").checked = config.enabled;
  $("implementation_mode").value = config.implementation_mode || "turboims";
  choiceFor($("implementation_mode"),$("implementation-mode-choice"));
  updateImplementationModeDescription();
  $("periodic-check").checked = !!config.periodic_check_enabled;
  updatePeriodicControl();
  if (![...$("selection").options].some(x => x.value === config.selection)) {
    const option = document.createElement("option");
    option.value = config.selection; option.textContent = config.selection; $("selection").append(option);
  }
  $("selection").value = config.selection;
  choiceFor($("selection"),$("selection-choice"));
  if (![...$("interval").options].some(x => Number(x.value) === config.interval_seconds)) {
    const option = document.createElement("option");
    option.value = config.interval_seconds; option.textContent = config.interval_seconds + " 秒";
    $("interval").append(option);
  }
  $("interval").value = String(config.interval_seconds);
  choiceFor($("interval"),$("interval-choice"));
  for (const [key] of features) {
    $(key).value = config.features[key] || "default";
    const {toggle} = featureControls.get(key);
    syncFeatureSwitch($(key),toggle);
  }
}
function configFromForm() {
  return { schema:1, enabled:$("enabled").checked, implementation_mode:$("implementation_mode").value,
    periodic_check_enabled:$("periodic-check").checked, selection:$("selection").value,
    interval_seconds:Number($("interval").value),
    features:Object.fromEntries(features.map(([key]) => [key, $(key).value])),
    sim_profiles: simProfiles };
}
function render(result, replaceForm = false) {
  $("details").textContent = JSON.stringify(result, null, 2);
  if (replaceForm && result.config) form(result.config);

  const state = result.status || result;
  const phase = state.phase || "not_started";
  const texts = {
    probe:["检测完成","仅完成只读检测，尚未验证配置写入。"],
    active:state.write_readback_verified
      ? ["IMS 配置已应用","已验证，通话仍需运营商支持。"]
      : ["无需重新写入","当前配置未发生变化，尚未确认写入结果。"],
    verified:["IMS 配置已验证","已验证，通话仍需运营商支持。"],
    ims_not_registered:["IMS 尚未注册","CarrierConfig 已验证，但 IMS 在限定时间内仍未注册。"],
    ims_status_unavailable:["无法读取 IMS 状态","查看逐卡诊断中的 Binder 权限或 API 错误。"],
    carrier_test_override_failed:["运营商识别覆盖失败","CarrierConfig 已验证，但 Carrier test MCC/MNC 未应用；查看逐卡结果。"],
    ims_reset_failed:["IMS reset 失败","查看逐卡诊断中的系统返回原因。"],

    paused:["自动应用已停止","当前不会自动更新 IMS 配置。"],
    partial:["部分配置未应用","部分配置项不受支持，请查看逐卡结果。"],
    ownership_lost:["自动应用已停止","配置状态发生变化，请查看诊断后重试。"],
    waiting:["等待 SIM 卡","请等待 SIM 卡和运营商配置加载。"],
    retry_timeout:["等待超时","SIM 卡或运营商配置尚未就绪，已停止本次尝试。"],
    verification_failed:["验证失败","写入后读取的值不一致，自动写入已停止。"],
    conflict:["存在配置冲突","冲突项已保留，请查看诊断与验证。"],
    not_started:["尚未开始工作","安装后请重启设备，再运行检测。"],
    error:["操作失败","请查看诊断与验证中的详细原因。"]
  };
  const warning = ["waiting","retry_timeout","conflict","partial","ims_not_registered"].includes(phase);
  const danger = ["error","verification_failed","ownership_lost","carrier_test_override_failed","ims_status_unavailable","ims_reset_failed"].includes(phase) || !!result.blocked;
  const tone = danger ? "danger" : warning || (phase === "active" && !state.write_readback_verified)
    ? "warning" : ["active","verified","probe"].includes(phase) ? "success" : "neutral";
  const [title,detail] = texts[phase] || ["状态待确认","请查看诊断与验证。"];
  message(title, danger, tone, detail);
  if (result.blocked) message(phase === "verification_failed" ? "验证失败" : "自动应用已停止",
    true, "danger", "已停止自动写入，请查看诊断与验证。");
  // The one-shot worker exiting after a verified apply is normal.
  const subscriptions = state.subscriptions;
  const slots = Array.isArray(subscriptions)
    ? [...new Set(subscriptions.filter(sub => Number.isInteger(sub.slot) && sub.slot >= 0).map(sub => sub.slot + 1))]
    : [];
  $("sim-summary").textContent = slots.length ? "已检测到 SIM 卡 " + slots.join("、")
    : Array.isArray(subscriptions) && subscriptions.length === 0 ? "暂未检测到活跃 SIM 卡" : "";
  $("sim-summary").hidden = !$("sim-summary").textContent;
  renderImsRegistrationStatus(result);
  renderDiagnosticSummary(result);
  renderSimStatus(result);
  renderSimResults(result);
  renderSimPage(result);
}
function renderSimStatus(result) {
  const state = result.status || result;
  const cards = Array.isArray(result.sim_cards) ? result.sim_cards
    : Array.isArray(state.sim_cards) ? state.sim_cards
    : Array.isArray(state.subscriptions) ? state.subscriptions.map(sub => ({
      slot:sub.slot, sub_id:sub.sub_id,
      country_iso:sub.country_iso || sub.effective?.sim_country_iso_override_string || "",
      carrier_name:sub.carrier_name || sub.effective?.carrier_name_string || "",
      phase:sub.phase
    })) : [];
  const selected = cards.find(card => Number(card.slot) === selectedSimSlot) || cards[0];
  if (!selected) {
    $("sim-status-title").textContent = "未检测到 SIM 卡";
    $("sim-status-subtitle").textContent = "";
    $("sim-status-country").textContent = "未读取";
    $("sim-status-carrier").textContent = "未读取";
    return;
  }
  const count = cards.length > 1 ? " · 共 " + cards.length + " 张" : "";
  $("sim-status-title").textContent = "SIM 卡 " + (Number(selected.slot) + 1);
  $("sim-status-subtitle").textContent =
    (selected.sub_id ? "subId " + selected.sub_id : "已检测") + count;
  const country = String(selected.country_iso || "").toUpperCase();
  $("sim-status-country").textContent = country ? simCountryLabel(country) : "未读取";
  $("sim-status-carrier").textContent = selected.carrier_name || "未读取";
}
function renderImsRegistrationStatus(result) {
  const state = result.status || result;
  const subscriptions = Array.isArray(state.subscriptions) ? state.subscriptions : [];
  const mode = state.implementation_mode || result.implementation_mode || state.config?.implementation_mode
    || result.config?.implementation_mode || savedConfig?.implementation_mode
    || $("implementation_mode").value || "turboims";
  const results = mode === "carrier_ims"
    ? (Array.isArray(state.carrier_ims_results) ? state.carrier_ims_results
      : Array.isArray(result.carrier_ims_results) ? result.carrier_ims_results : [])
    : [];
  const rows = subscriptions.map(sub => {
    const registration = mode === "carrier_ims" ? sub.ims || results.find(item =>
      Number(item.sub_id) === Number(sub.sub_id) || Number(item.slot) === Number(sub.slot)) : null;
    return {slot:sub.slot,registration};
  });
  for (const item of results) {
    if (!rows.some(row => Number(row.slot) === Number(item.slot)))
      rows.push({slot:item.slot,registration:item});
  }
  const list = $("ims-registration");
  list.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("div");
    const name = document.createElement("dt"); name.textContent = "注册状态";
    const value = document.createElement("dd"); value.textContent = "未检测到 SIM 卡";
    row.append(name,value); list.append(row); return;
  }
  rows.sort((a,b) => Number(a.slot) - Number(b.slot));
  for (const item of rows) {
    const registration = item.registration || {};
    const row = document.createElement("div");
    const name = document.createElement("dt");
    name.textContent = Number.isInteger(item.slot) ? "SIM 卡 " + (item.slot + 1) : "IMS";
    const value = document.createElement("dd");
    if (registration.registered === true || registration.phase === "ims_registered")
      value.textContent = "已注册";
    else if (registration.phase === "ims_not_registered")
      value.textContent = "未注册";
    else if (registration.phase === "ims_status_unavailable")
      value.textContent = "无法读取";
    else if (registration.phase === "ims_reset_failed")
      value.textContent = "重置失败";
    else
      value.textContent = "未查询";
    row.append(name,value); list.append(row);
  }
}
function renderSimResults(result) {
  const state = result.status || result;
  $("sims").replaceChildren();
  for (const sub of state.subscriptions || []) {
    const line = document.createElement("div"); line.className = "sim";
    line.textContent = "SIM 卡槽 " + (sub.slot + 1) + " · subId " + sub.sub_id +
      " · " + ({verified:"已验证",unchanged:"未变化",waiting:"等待中",error:"失败",verification_failed:"验证失败",conflict:"存在冲突",ownership_lost:"状态冲突",restored:"已恢复"}[sub.phase] || sub.phase)
      + (sub.unsupported?.length ? " · 跳过不支持的键 " + sub.unsupported.length + " 个" : "")
      + (sub.error ? " · " + sub.error : "")
      + (sub.write_state_unknown ? " · 此卡写入结果未确认" : "");
    $("sims").append(line);
  }
}
function renderDiagnosticSummary(result) {
  const state = result.status || result;
  const binder = result.binder || state.binder;
  const phases = {active:state.write_readback_verified ? "覆盖验证通过" : "当前配置无需写入",
    verified:"覆盖验证通过",probe:"只读检测完成",paused:"已暂停",partial:"部分支持",
    waiting:"等待 SIM 配置",retry_timeout:"等待超时",conflict:"存在第三方冲突",ownership_lost:"覆盖标记丢失",
    not_started:"尚未启动",verification_failed:"写入验证失败",error:"执行失败"};
  const rows = [
    ["状态", result.blocked ? "自动写入已停止" : phases[state.phase] || state.phase || "未知"],
    ["KernelSU", result.uid === undefined ? "未取得 UID" : "UID " + result.uid],
    ["SELinux", result.selinux_context || state.selinux_context || "未取得"],
    ["设备", result.device || state.device || "未取得"],
    ["SDK", result.sdk ?? state.sdk ?? "未取得"],
    ["后台任务", result.watcher ? (result.watcher.alive ? "运行中" : "已结束") : "尚未启动"],
    ["CarrierConfig", binder?.carrier_config === true ? "读取正常" :
      binder?.carrier_config === false ? "不可用" : "尚未检测"]
  ];
  if (state.error || result.error) rows.push(["错误",state.error || result.error]);
  if (result.blocked) rows.push(["停止原因",result.blocked.error || result.blocked.phase || "查看完整数据"]);
  $("diagnostic-summary").replaceChildren();
  for (const [title,value] of rows) {
    const row = document.createElement("div"); row.className = "diagnostic-item";
    const term = document.createElement("dt"); term.textContent = title;
    const detail = document.createElement("dd"); detail.textContent = String(value);
    row.append(term,detail); $("diagnostic-summary").append(row);
  }
}
async function operation(work, progress = "正在处理…", trigger = null) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button,input,select").forEach(x => { if (x.id !== "back" && !primaryPages.some(id => x.id === "tab-"+id)) x.disabled = true; });
  document.querySelectorAll('[data-feedback="row"]').forEach(row => row.setAttribute("aria-disabled","true"));
  const label = trigger?.querySelector(".action-label") || trigger;
  const originalLabel = label?.textContent;
  if (label) label.textContent = progress;
  message(progress, false, "neutral", "请稍候。");
  try { await work(); }
  catch (error) {
    if (error.result) render(error.result);
    else message("操作失败", true, "danger", "请查看诊断与验证。");
    $("diagnostic-notice").textContent = "操作失败：" + error.message;
    if (!error.result) $("details").textContent = JSON.stringify({ok:false,error:error.message},null,2);
  } finally {
    if (label) label.textContent = originalLabel;
    busy = false;
    document.querySelectorAll("button,input,select").forEach(x => x.disabled = false);
    updatePeriodicControl();
    document.querySelectorAll('[data-feedback="row"]').forEach(row => row.setAttribute("aria-disabled","false"));
  }
}
$("probe").onclick = () => operation(async () => render(await TurboBridge.call("probe")), "正在检测…", $("probe"));
$("refresh").onclick = () => operation(async () => render(await TurboBridge.call("status")), "正在刷新…", $("refresh"));
$("apply").onclick = async () => {
  const config = configFromForm();
  if (!await ask("应用 IMS 配置？", "应用到所选 SIM 卡。通话仍需运营商支持。")) {
    message("已取消", false, "neutral", "当前设置未保存。"); return;
  }
  operation(async () => {
    const saved = await TurboBridge.call("save", encodeBase64Utf8(JSON.stringify(config)));
    savedConfig = saved.config;
    render(await TurboBridge.call("apply"), true);
  });
};
$("restore").onclick = async () => {
  if (!await ask("停止并恢复？", "停止自动应用并恢复原值，保留冲突项。")) {
    message("已取消", false, "neutral", "自动配置和已应用的设置未改变。"); return;
  }
  operation(async () => render(await TurboBridge.call("restore"), true));
};
$("export").onclick = () => operation(async () => {
  const result = await TurboBridge.call("export");
  $("diagnostics").textContent = JSON.stringify(result, null, 2);
  render(result);
  $("diagnostic-notice").textContent = "诊断已生成，可查看完整数据并复制。";
});
function revealInitialUI() {
  clearTimeout(window.turboStartupTimer);
  document.documentElement.dataset.loading = "false";
}
// Bound the loading screen only; a slow bridge keeps controls disabled until
// operation() settles. Never fabricate configuration or trigger an extra call.
const initialViewDeadline = setTimeout(revealInitialUI, 6000);
operation(async () => render(await TurboBridge.call("status"), true))
  .finally(() => { clearTimeout(initialViewDeadline); revealInitialUI(); });
