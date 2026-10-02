"use strict";
const features = [
  ["volte", "VoLTE", "LTE 语音通话"],
  ["vowifi", "VoWiFi", "Wi-Fi 通话与模式设置"],
  ["vt", "视频通话", "运营商 IMS 视频通话"],
  ["vonr", "VoNR", "5G 语音通话"],
  ["cross_sim", "跨 SIM 通话", "使用另一张 SIM 卡的数据进行通话"],
  ["ut", "UT 补充服务", "基于 IMS 的补充服务"],
  ["5g_nr", "5G NR", "NSA / SA 网络与信号阈值"]
];
const $ = id => document.getElementById(id);
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
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
function showAppearance() {
  const dark = themeMode === "dark" || (themeMode === "system" && !!media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const chromeColor = dark ? "#121212" : "#ffffff";
  // Android system icons follow the host Activity, not this WebUI preference.
  // Keep their background legible if a manual WebUI theme differs from the host.
  document.documentElement.style.setProperty("--system-bar-bg", media?.matches ? "#121212" : "#ffffff");
  for (const id of ["theme-color","status-bar-color","navigation-bar-color"]) {
    const meta = document.getElementById(id);
    if (meta) meta.setAttribute("content",chromeColor);
  }
  document.documentElement.style.setProperty("--accent", accent);
  const rgb = [1,3,5].map(i => parseInt(accent.slice(i,i+2),16));
  document.documentElement.style.setProperty("--press-rgb", rgb.map(x => Math.round(x * .4 + (dark ? 255 : 0) * .6)).join(","));
  document.documentElement.style.setProperty("--accent-track", "rgba(" + rgb.join(",") + ",.45)");
  const luminance = rgb.map(c => { c /= 255; return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4; });
  document.documentElement.style.setProperty("--accent-text",
    luminance[0]*.2126 + luminance[1]*.7152 + luminance[2]*.0722 > .18 ? "#101010" : "#ffffff");
  $("theme-choice").textContent = {system:"跟随系统",light:"浅色模式",dark:"深色模式"}[themeMode];
  const chosen = [...onePlusColors,...materialColors].find(([,hex]) => hex === accent);
  $("accent-label").textContent = chosen ? chosen[0] : accent;
  for (const [button,color] of swatchButtons) button.setAttribute("aria-pressed",String(color === accent));
  const blend = (x,y,t) => Math.round(x*(1-t)+y*t);
  const ink = rgb.map(x => blend(x,dark ? 255 : 0,dark ? .20 : .36));
  document.documentElement.style.setProperty("--accent-ink", "rgb(" + ink.join(",") + ")");
}
if (media) {
  if (media.addEventListener) media.addEventListener("change", showAppearance);
  else if (media.addListener) media.addListener(showAppearance);
}
let sheetFinishing = false;
function finishSheet(value = false) {
  if ($("sheet").hidden || sheetFinishing) return;
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
  button.setAttribute("aria-label", (button.dataset.title || "选择设置") + "，" + button.textContent);
  button.onclick = () => choose(button.dataset.title || "选择设置", "", [...select.options].map(x => [x.value,x.textContent]), select.value, value => {
    select.value = value; choiceFor(select,button);
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
function applyCustomColor() {
  let value = $("custom-hex").value.trim().toUpperCase();
  if (/^[0-9A-F]{6}$/.test(value)) value = "#" + value;
  if (!/^#[0-9A-F]{6}$/.test(value)) {
    $("hex-error").textContent = "请输入六位 HEX 颜色，例如 #42A5F5。";
    return;
  }
  setAccent(value);
}
$("apply-hex").onclick = applyCustomColor;
$("custom-hex").onkeydown = event => { if (event.key === "Enter") applyCustomColor(); };
showAppearance();
const pageTitles = {home:"IMS","sim-page":"SIM 卡信息","settings-page":"设置",
  "appearance-page":"外观","accent-page":"强调色","diagnostics-page":"诊断与验证",
  "diagnostic-data-page":"完整诊断数据","operation-data-page":"操作结果"};
const pageRoutes = {home:"","sim-page":"sim","settings-page":"settings",
  "appearance-page":"appearance","accent-page":"accent","diagnostics-page":"diagnostics",
  "diagnostic-data-page":"diagnostic-data","operation-data-page":"operation-data"};
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
  currentPage = page;
  const primary = primaryPages.includes(page);
  for (const id of Object.keys(pageTitles)) $(id).hidden = id !== page;
  $("back").hidden = primary;
  $("bottom-nav").hidden = !primary;
  $("page-content").dataset.primary = String(primary);
  $("page-title").textContent = "TurboIMS Next";
  for (const id of primaryPages) {
    const tab = $("tab-"+id);
    if (id === page) tab.setAttribute("aria-current","page");
    else tab.removeAttribute("aria-current");
  }
  if (page === "accent-page") $("custom-hex").value = accent;
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
for (const id of ["selection-choice","interval-choice","theme-choice","accent-choice"]) clickablePreference($(id));
for (const [id,title] of [["selection","应用到"],["interval","检查间隔"]]) {
  const button = $(id+"-choice"); button.dataset.title = title;
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
      const result = await TurboBridge.call("save", btoa(JSON.stringify(config)));
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
function form(config) {
  savedConfig = config;
  $("enabled").checked = config.enabled;
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
  return { schema:1, enabled:$("enabled").checked,
    periodic_check_enabled:$("periodic-check").checked, selection:$("selection").value,
    interval_seconds:Number($("interval").value),
    features:Object.fromEntries(features.map(([key]) => [key, $(key).value])) };
}
function render(result, replaceForm = false) {
  $("details").textContent = JSON.stringify(result, null, 2);
  if (replaceForm && result.config) form(result.config);

  const state = result.status || result;
  const phase = state.phase || "not_started";
  const texts = {
    probe:["检测完成","仅完成只读检测，尚未验证配置写入。"],
    active:state.write_readback_verified
      ? ["配置已应用","已完成写入验证，通话功能仍需运营商支持。"]
      : ["无需重新写入","当前配置未发生变化，尚未确认写入结果。"],
    verified:["配置已验证","已完成写入验证，通话功能仍需运营商支持。"],
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
  const warning = ["waiting","retry_timeout","conflict","partial"].includes(phase);
  const danger = ["error","verification_failed","ownership_lost"].includes(phase) || !!result.blocked;
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
  renderDiagnosticSummary(result);
  renderSimResults(result);
}
function renderSimResults(result) {
  const state = result.status || result;
  $("sims").replaceChildren();
  for (const sub of state.subscriptions || []) {
    const line = document.createElement("div"); line.className = "sim";
    line.textContent = "SIM 卡槽 " + (sub.slot + 1) + " · subId " + sub.sub_id +
      " · " + sub.phase
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
    ["CarrierConfig", binder?.carrier_config === true ? "读通路可用" :
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
  if (!await ask("应用 IMS 配置？", "将更新所选 SIM 卡的 IMS 配置。能否使用通话功能仍取决于运营商支持。")) {
    message("已取消", false, "neutral", "当前设置未保存。"); return;
  }
  operation(async () => {
    const saved = await TurboBridge.call("save", btoa(JSON.stringify(config)));
    savedConfig = saved.config;
    render(await TurboBridge.call("apply"), true);
  });
};
$("restore").onclick = async () => {
  if (!await ask("停止并恢复？", "停止自动应用，恢复本模块记录的原值。与其他工具冲突的项目会保留。")) {
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
operation(async () => render(await TurboBridge.call("status"), true));
