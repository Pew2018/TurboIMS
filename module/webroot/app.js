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
for (const [key, title, description] of features) {
  const row = document.createElement("label"); row.className = "feature";
  const text = document.createElement("span");
  const name = document.createElement("strong"); name.textContent = title;
  const desc = document.createElement("small"); desc.textContent = description;
  text.append(name, desc);
  const select = document.createElement("select"); select.id = key;
  select.setAttribute("aria-label", title);
  for (const [value, label] of [["default", "恢复原值"], ["on", "开启覆盖"], ["off", "关闭覆盖"]]) {
    const option = document.createElement("option"); option.value = value;
    option.textContent = label; select.append(option);
  }
  row.append(text, select); $("features").append(row);
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
  if (![...$("interval").options].some(x => Number(x.value) === config.interval_seconds)) {
    const option = document.createElement("option");
    option.value = config.interval_seconds; option.textContent = config.interval_seconds + " 秒";
    $("interval").append(option);
  }
  $("interval").value = String(config.interval_seconds);
  for (const [key] of features) $(key).value = config.features[key];
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
$("apply").onclick = () => operation(async () => {
  const config = configFromForm();
  if (config.enabled && !confirm("将覆盖所选活跃 SIM 的 IMS 配置。运营商支持不由模块保证。继续？")) {
    message("已取消；设置未保存。"); return;
  }
  await TurboBridge.call("save", btoa(JSON.stringify(config)));
  render(await TurboBridge.call("apply"), true);
});
$("restore").onclick = () => operation(async () => {
  if (!confirm("暂停自动覆盖，并恢复本模块修改前记录的值。其他工具造成的冲突将保留。继续？")) {
    message("已取消。"); return;
  }
  render(await TurboBridge.call("restore"), true);
});
$("export").onclick = () => operation(async () => {
  const result = await TurboBridge.call("export");
  $("diagnostics").value = JSON.stringify(result, null, 2);
  message("诊断已生成，可在下方全选复制。");
});
operation(async () => render(await TurboBridge.call("status"), true));
