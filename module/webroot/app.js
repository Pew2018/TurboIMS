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
const uiDefault = { theme_mode: "system", accent: "#009866" };
const $ = id => document.getElementById(id);
let busy = false;
let ui = { ...uiDefault };
let lastResult = null;
let toastTimer = null;

for (const [key, title, description] of features) {
  const row = document.createElement("div");
  row.className = "feature-row";
  const copy = document.createElement("span");
  copy.className = "feature-copy";
  const name = document.createElement("strong");
  name.textContent = title;
  const desc = document.createElement("small");
  desc.textContent = description;
  copy.append(name, desc);
  const select = document.createElement("select");
  select.id = key;
  select.setAttribute("aria-label", title);
  for (const pair of [["default", "恢复原值"], ["on", "开启覆盖"], ["off", "关闭覆盖"]]) {
    const option = document.createElement("option");
    option.value = pair[0];
    option.textContent = pair[1];
    select.append(option);
  }
  row.append(copy, select);
  $("features").append(row);
}

function validAccent(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}
function normalizeUi(value) {
  const next = value || uiDefault;
  return {
    theme_mode: ["system", "light", "dark"].includes(next.theme_mode) ? next.theme_mode : "system",
    accent: validAccent(next.accent) ? next.accent.toUpperCase() : uiDefault.accent
  };
}
function applyTheme() {
  ui = normalizeUi(ui);
  const root = document.documentElement;
  if (root) {
    root.setAttribute("data-theme", ui.theme_mode);
    if (root.style && root.style.setProperty) root.style.setProperty("--accent", ui.accent);
  }
  const mode = $("themeMode");
  if (mode) mode.value = ui.theme_mode;
  const text = $("accentText");
  if (text) text.value = ui.accent;
  const picker = $("accentPicker");
  if (picker) picker.value = ui.accent;
  const chips = document.querySelectorAll ? document.querySelectorAll(".accent-chip") : [];
  if (chips && chips.forEach) chips.forEach(chip => {
    const value = chip.getAttribute("data-accent");
    if (chip.style && chip.style.setProperty) chip.style.setProperty("--chip-color", value);
    chip.className = "accent-chip" + (value === ui.accent ? " selected" : "");
  });
}
function showToast(text, error) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.className = "toast show" + (error ? " error" : "");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 2800);
}
async function persistUi() {
  try {
    const encoded = btoa(JSON.stringify(ui));
    await TurboBridge.call("save-ui", encoded);
    showToast("外观设置已保存", false);
  } catch (error) {
    showToast("外观设置保存失败：" + error.message, true);
  }
}
function setUi(next, persist) {
  ui = normalizeUi(next);
  applyTheme();
  if (persist) persistUi();
}
function message(text, error) {
  const target = $("message");
  if (!target) return;
  target.textContent = text;
  target.className = error ? "inline-message error" : "inline-message";
}
function phaseLabel(phase) {
  return {
    active: "运行中", paused: "已暂停", waiting: "等待系统",
    probe: "检测完成", partial: "部分支持", conflict: "有冲突",
    ownership_lost: "需人工处理", error: "执行错误",
    not_started: "尚未检测", verified: "已验证", restored: "已恢复",
    unchanged: "无变化"
  }[phase] || phase || "未知";
}
function setStatusMark(phase) {
  const badge = $("statusBadge");
  const text = $("statusText");
  if (!badge || !text) return;
  badge.className = "status-mark status-" + String(phase).replace(/[^a-z_]/g, "");
  text.textContent = phaseLabel(phase);
}
function formatTime(ms) {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleTimeString(); } catch (_) { return "—"; }
}
function currentState(result) {
  return result && result.status && typeof result.status === "object" ? result.status : (result || {});
}
function render(result, replaceForm) {
  lastResult = result || {};
  const state = currentState(lastResult);
  const phase = state.phase || lastResult.phase || "not_started";
  const watcher = lastResult.watcher || state.watcher || {};
  const config = state.config || lastResult.config;
  const uid = state.uid !== undefined ? state.uid : lastResult.uid;
  setStatusMark(phase);
  $("rootValue").textContent = uid === 0 ? "已授权 · uid 0" : (uid === undefined ? "未知" : "未授权");
  $("serviceValue").textContent = watcher.alive ? "运行中" : (watcher.alive === false ? "未运行" : "未知");
  $("lastCheckValue").textContent = formatTime(state.time_ms || lastResult.time_ms);
  $("deviceValue").textContent = state.device || lastResult.device || "—";
  $("deviceModel").textContent = state.device || lastResult.device || "—";
  $("androidValue").textContent = state.sdk ? "SDK " + state.sdk : "—";
  $("selinuxValue").textContent = state.selinux_context || lastResult.selinux_context || "—";
  $("uidValue").textContent = uid === undefined ? "—" : String(uid);
  $("bootValue").textContent = watcher.alive ? "已完成" : "—";
  const binder = state.binder || lastResult.binder || {};
  const interfaces = [];
  if (binder.carrier_config) interfaces.push("carrier_config");
  if (binder.isub) interfaces.push("isub");
  $("interfacesValue").textContent = interfaces.length ? interfaces.join(" · ") : "—";
  const texts = {
    probe: "只读检测完成；尚未执行写入。",
    active: state.write_readback_verified ? "写入并读回验证成功。" : "已启用，当前配置无需写入；请查看逐卡结果。",
    paused: "自动适配已暂停，当前没有执行覆盖。",
    partial: "部分配置键不受支持；请查看逐卡结果。",
    ownership_lost: "覆盖标记丢失且配置尚未恢复；自动写入已停止。",
    waiting: "等待活跃 SIM 和运营商配置加载。",
    conflict: "检测到第三方配置冲突，冲突键未覆盖。",
    not_started: "尚未执行检测；请点击重新检测。",
    error: "执行失败，请查看逐卡错误和日志。"
  };
  message(texts[phase] || phaseLabel(phase), !!lastResult.blocked || ["error", "conflict", "partial", "ownership_lost"].includes(phase));
  if (lastResult.blocked) {
    message("自动写入已停止：" + (lastResult.blocked.error || lastResult.blocked.phase || "请导出诊断"), true);
  }
  if (watcher.alive === false) message("后台 watcher 未运行，请重启后重新检测。", true);
  if (config && replaceForm) form(config);
  $("sims").replaceChildren();
  for (const sub of state.subscriptions || lastResult.subscriptions || []) {
    const line = document.createElement("div");
    line.className = "sim";
    line.textContent = "SIM 卡槽 " + (Number(sub.slot) + 1) + " · subId " + sub.sub_id +
      " · " + phaseLabel(sub.phase) +
      (sub.unsupported && sub.unsupported.length ? " · 跳过 " + sub.unsupported.length + " 个键" : "") +
      (sub.error ? " · " + sub.error : "") +
      (sub.write_state_unknown ? " · 写入结果未确认" : "");
    $("sims").append(line);
  }
  $("details").textContent = JSON.stringify(lastResult, null, 2);
}
function form(config) {
  $("enabled").checked = !!config.enabled;
  $("selection").value = config.selection || "all";
  $("interval").value = String(config.interval_seconds || 30);
  for (const pair of features) {
    const key = pair[0];
    $(key).value = config.features && config.features[key] ? config.features[key] : "default";
  }
}
function configFromForm() {
  const modes = {};
  for (const pair of features) modes[pair[0]] = $(pair[0]).value;
  return {
    schema: 1,
    enabled: !!$("enabled").checked,
    selection: $("selection").value,
    interval_seconds: Number($("interval").value),
    features: modes
  };
}
async function operation(work) {
  if (busy) return;
  busy = true;
  const controls = document.querySelectorAll ? document.querySelectorAll("button,input,select") : [];
  if (controls && controls.forEach) controls.forEach(x => { x.disabled = true; });
  message("正在执行，请稍候…", false);
  try { await work(); }
  catch (error) {
    if (error.result) render(error.result, false);
    message(error.message || "命令执行失败", true);
    showToast(error.message || "命令执行失败", true);
  } finally {
    busy = false;
    if (controls && controls.forEach) controls.forEach(x => { x.disabled = false; });
  }
}
async function loadUi() {
  try {
    const result = await TurboBridge.call("get-ui");
    setUi(result.ui || uiDefault, false);
  } catch (_) {
    setUi(uiDefault, false);
  }
}
$("themeMode").onchange = () => setUi({ ...ui, theme_mode: $("themeMode").value }, true);
$("enabled").onchange = () => {
  const text = $("enabled").checked ? "已选择启用自动适配，请点击保存并应用。" : "已选择停用自动适配，请点击保存并应用。";
  message(text, false);
  showToast(text, false);
};
$("selection").onchange = () => showToast("应用范围已修改，请点击保存并应用。", false);
$("interval").onchange = () => showToast("检查间隔已修改，请点击保存并应用。", false);
$("accentText").onchange = () => {
  const value = $("accentText").value.trim().toUpperCase();
  if (!validAccent(value)) { message("强调色必须是 #RRGGBB 格式。", true); return; }
  setUi({ ...ui, accent: value }, true);
};
$("accentPicker").onchange = () => setUi({ ...ui, accent: $("accentPicker").value }, true);
const chips = document.querySelectorAll ? document.querySelectorAll(".accent-chip") : [];
if (chips && chips.forEach) chips.forEach(chip => {
  chip.onclick = () => setUi({ ...ui, accent: chip.getAttribute("data-accent") }, true);
});
$("resetAppearance").onclick = () => setUi(uiDefault, true);
$("appearanceFocus").onclick = () => {
  const target = $("appearance");
  if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
};
$("probe").onclick = () => operation(async () => {
  const result = await TurboBridge.call("probe");
  render(result, false);
  showToast("检测完成", false);
});
$("refresh").onclick = () => operation(async () => {
  const result = await TurboBridge.call("status");
  render(result, true);
  showToast("状态已刷新", false);
});
$("apply").onclick = () => operation(async () => {
  const config = configFromForm();
  await TurboBridge.call("save", btoa(JSON.stringify(config)));
  const result = await TurboBridge.call("apply");
  render(result, true);
  showToast(result.write_readback_verified ? "配置已应用并验证" : "配置已保存", false);
});
$("restore").onclick = () => operation(async () => {
  if (!confirm("将暂停自动适配，并恢复本模块记录的原值。继续吗？")) return;
  const result = await TurboBridge.call("restore");
  render(result, true);
  showToast("已暂停并执行恢复", false);
});
$("export").onclick = () => operation(async () => {
  const result = await TurboBridge.call("export");
  $("diagnostics").value = JSON.stringify(result, null, 2);
  $("logView").textContent = result.log || "暂无日志";
  $("logMeta").textContent = result.log ? "最近记录已加载" : "暂无记录";
  $("details").textContent = JSON.stringify(result, null, 2);
  showToast("诊断已生成", false);
});
$("copyLog").onclick = async () => {
  const text = $("logView").textContent || "";
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else { $("diagnostics").value = text; $("diagnostics").select(); document.execCommand("copy"); }
    showToast("日志已复制", false);
  } catch (error) { showToast("复制失败：" + error.message, true); }
};
(async () => {
  applyTheme();
  await loadUi();
  try { render(await TurboBridge.call("status"), true); }
  catch (error) { message(error.message || "无法读取模块状态", true); }
})();
