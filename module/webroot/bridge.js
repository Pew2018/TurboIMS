(function (root) {
  "use strict";
  const allowed = new Set(["probe", "status", "apply", "restore", "export", "get-config", "get-ui", "save", "save-ui"]);
  const saveActions = new Set(["save", "save-ui"]);
  let counter = 0;
  const controller = "/data/adb/modules/turboims_next/control.sh";
  function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
  function command(action, argument) {
    if (!allowed.has(action)) throw new Error("Unsupported operation");
    if (saveActions.has(action)) {
      if (typeof argument !== "string" || !/^[A-Za-z0-9+/=]+$/.test(argument))
        throw new Error("Invalid configuration payload");
    } else if (argument !== undefined) throw new Error("Unexpected argument");
    return "/system/bin/sh " + quote(controller) + " " + action +
      (argument === undefined ? "" : " " + quote(argument));
  }
  function call(action, argument) {
    let cmd;
    try { cmd = command(action, argument); } catch (error) { return Promise.reject(error); }
    if (!root.ksu || typeof root.ksu.exec !== "function")
      return Promise.reject(new Error("请从 KernelSU Next 模块页面打开 WebUI。"));
    return new Promise((resolve, reject) => {
      const name = "__turboims_cb_" + (++counter);
      const timer = setTimeout(() => {
        delete root[name];
        reject(new Error("操作超时；请导出诊断，不要反复点击应用。"));
      }, 50000);
      root[name] = (code, stdout, stderr) => {
        clearTimeout(timer); delete root[name];
        const lines = String(stdout || "").trim().split("\n");
        let result;
        try { result = JSON.parse(lines[lines.length - 1]); }
        catch (_) {
          reject(new Error("执行器未返回 JSON（exit=" + code + "）：" +
            String(stderr || stdout || "无输出").slice(-1500)));
          return;
        }
        if (Number(code) !== 0 || result.ok === false) {
          const error = new Error(result.error ||
            "尚未完成：" + (result.phase || "unknown") + "，请查看设备状态。");
          error.result = result; reject(error);
        } else resolve(result);
      };
      try { root.ksu.exec(cmd, "{}", name); }
      catch (error) {
        clearTimeout(timer); delete root[name]; reject(error);
      }
    });
  }
  const api = { call, command };
  root.TurboBridge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
