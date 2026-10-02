"use strict";
const features = [
  ["volte", "VoLTE", "开放 LTE 语音通话相关配置"],
  ["vowifi", "VoWiFi", "开放 Wi-Fi 通话和模式设置"],
  ["vt", "视频通话", "开放运营商 IMS 视频通话"],
  ["vonr", "VoNR", "开放 5G 语音和设置入口"],
  ["cross_sim", "跨 SIM 通话", "开放借用另一张 SIM 数据进行 IMS 通话"],
  ["ut", "UT 补充服务", "开放基于 IMS 的补充服务"],
  ["5g_nr", "5G NR", "开放 NSA / SA，并使用原项目的信号阈值"]
];
const $ = id => document.getElementById(id);
let busy = false;
const optionLabels = { default:"恢复原值", on:"开启覆盖", off:"关闭覆盖" };
const presets = ["#2196F3","#009688","#4CAF50","#F44336","#FF9800","#9C27B0","#00BCD4","#3F51B5","#E91E63","#607D8B","#FF5722","#8BC34A"];
const storage = {
  read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
};
let themeMode = storage.read("turboims-theme", "system");
if (!["system","light","dark"].includes(themeMode)) themeMode = "system";
let accent = storage.read("turboims-accent", "#009688").toUpperCase();
if (!/^#[0-9A-F]{6}$/.test(accent)) accent = "#009688";
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
function showAppearance() {
  const dark = themeMode === "dark" || (themeMode === "system" && !!media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.setProperty("--accent", accent);
  const rgb = [1,3,5].map(i => parseInt(accent.slice(i,i+2),16));
  const luminance = rgb.map(c => { c /= 255; return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4; });
  document.documentElement.style.setProperty("--accent-text",
    luminance[0]*.2126 + luminance[1]*.7152 + luminance[2]*.0722 > .39 ? "#172124" : "#ffffff");
  $("theme-choice").textContent = {system:"跟随系统",light:"浅色模式",dark:"深色模式"}[themeMode];
  $("accent-label").textContent = accent;
}
if (media) {
  if (media.addEventListener) media.addEventListener("change", showAppearance);
  else if (media.addListener) media.addListener(showAppearance);
}
function dismissSheet(value = false) {
  if ($("sheet").hidden) return;
  $("sheet").hidden = true;
  document.body.style.overflow = "";
  const resolve = sheetResolve;
  sheetResolve = null;
  if (sheetFocus && sheetFocus.isConnected) sheetFocus.focus();
  sheetFocus = null;
  if (resolve) resolve(value);
}
let sheetResolve = null;
let sheetFocus = null;
function openSheet(title, description) {
  if (!$("sheet").hidden) dismissSheet(false);
  sheetFocus = document.activeElement;
  $("sheet-title").textContent = title;
  $("sheet-description").textContent = description || "";
  $("sheet-content").replaceChildren();
  $("sheet-actions").replaceChildren();
  $("sheet").hidden = false;
  document.body.style.overflow = "hidden";
  $("sheet-close").focus();
  return new Promise(resolve => { sheetResolve = resolve; });
}
$("sheet-close").onclick = () => dismissSheet(false);
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
  button.onclick = onClick; return button;
}
function choose(title, description, values, current, onSelect) {
  openSheet(title, description);
  for (const [value, label] of values) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "option";
    button.textContent = label;
    button.setAttribute("aria-selected", String(value === current));
    button.onclick = () => { onSelect(value); dismissSheet(true); };
    $("sheet-content").append(button);
  }
}
function choiceFor(select, button) {
  const option = [...select.options].find(x => x.value === select.value);
  button.textContent = option?.textContent || select.value;
  button.onclick = () => choose(button.dataset.title || "选择设置", "", [...select.options].map(x => [x.value,x.textContent]), select.value, value => {
    select.value = value; choiceFor(select,button);
  });
}
async function ask(title, description) {
  const answer = openSheet(title, description);
  $("sheet-actions").append(
    actionButton("取消", () => dismissSheet(false), true),
    actionButton("继续", () => dismissSheet(true))
  );
  return answer;
}
$("theme-choice").onclick = () => choose("显示模式", "WebUI 外观设置不会修改 IMS 配置。", [
  ["system","跟随系统"],["light","浅色模式"],["dark","深色模式"]
], themeMode, value => { themeMode = value; storage.write("turboims-theme",value); showAppearance(); });
$("accent-choice").onclick = () => {
  openSheet("主题强调色", "选择预设颜色，或输入六位 HEX 颜色。");
  const grid = document.createElement("div"); grid.className = "swatches";
  for (const color of presets) {
    const swatch = document.createElement("button");
    swatch.type = "button"; swatch.className = "swatch";
    swatch.style.setProperty("--swatch",color);
    swatch.setAttribute("aria-label",color);
    swatch.setAttribute("aria-pressed",String(color === accent));
    swatch.onclick = () => { accent=color; storage.write("turboims-accent",accent); showAppearance(); dismissSheet(true); };
    grid.append(swatch);
  }
  const label = document.createElement("label"); label.className = "hex-label";
  label.textContent = "自定义颜色";
  const input = document.createElement("input"); input.className = "hex-field";
  input.type = "text"; input.inputMode = "text"; input.maxLength = 7;
  input.autocomplete = "off"; input.spellcheck = false; input.value = accent;
  input.setAttribute("aria-label","自定义 HEX 颜色");
  label.append(input);
  const error = document.createElement("p"); error.className = "field-error";
  error.setAttribute("role","alert");
  $("sheet-content").append(grid,label,error);
  const save = () => {
    let value = input.value.trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(value)) value = "#" + value;
    if (!/^#[0-9A-F]{6}$/.test(value)) { error.textContent = "请输入六位 HEX 颜色，例如 #2196F3。"; return; }
    accent=value; storage.write("turboims-accent",accent); showAppearance(); dismissSheet(true);
  };
  input.onkeydown = e => { if (e.key === "Enter") save(); };
  $("sheet-actions").append(actionButton("取消", () => dismissSheet(false), true),actionButton("应用颜色",save));
};
showAppearance();
for (const [id,title] of [["selection","应用范围"],["interval","检查间隔"]]) {
  const button = $(id+"-choice"); button.dataset.title = title;
  choiceFor($(id),button);
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
  const button = document.createElement("button"); button.type = "button";
  button.id = key+"-choice"; button.className = "choice";
  button.dataset.title = title; button.setAttribute("aria-haspopup","dialog");
  row.append(text,button,select); $("features").append(row);
  choiceFor(select,button);
}

function message(text, error = false) {
  $("message").textContent = text; $("message").className = error ? "error" : "";
}
function form(config) {
  $("enabled").checked = config.enabled;
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
  for (const [key] of features) { $(key).value = config.features[key]; choiceFor($(key),$(key+"-choice")); }
}
function configFromForm() {
  return { schema:1, enabled:$("enabled").checked, selection:$("selection").value,
    interval_seconds:Number($("interval").value),
    features:Object.fromEntries(features.map(([key]) => [key, $(key).value])) };
}
function render(result, replaceForm = false) {
  $("details").textContent = JSON.stringify(result, null, 2);
  if (replaceForm && result.config) form(result.config);
  $("device").textContent = result.sdk ?
    "设备 " + result.device + " · SDK " + result.sdk + " · UID " + result.uid : "";
  const state = result.status || result;
  const phase = state.phase || "not_started";
  const texts = { probe:"只读检测完成；尚未验证写入权限。",
    active:state.write_readback_verified ? "写入并读回验证成功。" : "已启用，当前配置无需写入；请查看详情。",
    paused:"已暂停自动覆盖。", partial:"部分配置键不受支持；请查看逐卡结果，未报告全部生效。",
    ownership_lost:"覆盖标记丢失且配置尚未恢复；已停止自动写入，请导出诊断。",
    waiting:"等待活跃 SIM 和运营商配置加载。", conflict:"检测到第三方配置冲突，冲突键未覆盖。",
    not_started:"执行器尚未启动；安装后请重启，再进行只读检测。",
    error:"执行失败：" + (state.error || "请查看下方各 SIM 的错误") };
  message(texts[phase] || phase, !!result.blocked || ["error","conflict","partial","ownership_lost"].includes(phase));
  if (result.blocked) message("自动写入已停止：" + (result.blocked.error || result.blocked.phase || "请查看逐卡诊断"), true);
  if (result.watcher && !result.watcher.alive)
    message("后台适配进程未运行。请重启并导出诊断。", true);
  $("sims").replaceChildren();
  for (const sub of state.subscriptions || []) {
    const line = document.createElement("div"); line.className = "sim";
    line.textContent = "SIM 卡槽 " + (sub.slot + 1) + " · subId " + sub.sub_id +
      " · " + sub.phase
      + (sub.unsupported.length ? " · 跳过不支持的键 " + sub.unsupported.length + " 个" : "")
      + (sub.error ? " · " + sub.error : "")
      + (sub.write_state_unknown ? " · 此卡写入结果未确认" : "");
    $("sims").append(line);
  }
}
async function operation(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button,input,select").forEach(x => x.disabled = true);
  message("正在执行，请稍候…");
  try { await work(); }
  catch (error) {
    if (error.result) render(error.result);
    message(error.message, true);
  } finally {
    busy = false;
    document.querySelectorAll("button,input,select").forEach(x => x.disabled = false);
  }
}
$("probe").onclick = () => operation(async () => render(await TurboBridge.call("probe")));
$("refresh").onclick = () => operation(async () => render(await TurboBridge.call("status")));
$("apply").onclick = async () => {
  const config = configFromForm();
  if (config.enabled && !await ask("确认应用 IMS 配置", "将覆盖所选活跃 SIM 的 IMS 配置。运营商支持不由模块保证。")) {
    message("已取消；设置未保存。"); return;
  }
  operation(async () => {
    await TurboBridge.call("save", btoa(JSON.stringify(config)));
    render(await TurboBridge.call("apply"), true);
  });
};
$("restore").onclick = async () => {
  if (!await ask("暂停并恢复原值", "暂停自动覆盖，并恢复本模块修改前记录的值。其他工具造成的冲突将保留。")) {
    message("已取消。"); return;
  }
  operation(async () => render(await TurboBridge.call("restore"), true));
};
$("export").onclick = () => operation(async () => {
  const result = await TurboBridge.call("export");
  $("diagnostics").value = JSON.stringify(result, null, 2);
  message("诊断已生成，可在下方全选复制。");
});
operation(async () => render(await TurboBridge.call("status"), true));
