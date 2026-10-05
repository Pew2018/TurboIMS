(function (root) {
  "use strict";
  const allowed = new Set(["probe", "status", "apply", "restore", "export", "get-config", "save"]);
  let counter = 0;
  const controller = "/data/adb/modules/turboims_next/control.sh";
  function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
  function command(action, argument) {
    if (!allowed.has(action)) throw new Error("Unsupported operation");
    if (action === "save") {
      if (typeof argument !== "string" || !/^[A-Za-z0-9+/=]+$/.test(argument))
        throw new Error("Invalid configuration payload");
    } else if (argument !== undefined) throw new Error("Unexpected argument");
    return "/system/bin/sh " + quote(controller) + " " + action +
      (argument === undefined ? "" : " " + quote(argument));
  }
  function call(action, argument) {
    try { command(action, argument); } catch (error) { return Promise.reject(error); }
    if (!root.ksu || typeof root.ksu.spawn !== "function")
      return Promise.reject(new Error("请从支持异步执行的 KernelSU Next 模块页面打开 WebUI。"));
    return new Promise((resolve, reject) => {
      const name = "__turboims_cb_" + (++counter);
      const stdout = [], stderr = [];
      let settled = false, size = 0;
      const limit = 1024 * 1024;
      // control.sh limits a foreground runner to 180 seconds. The bridge must
      // outlive that limit; a JS timeout does not cancel a root write.
      const timer = setTimeout(() => finish(new Error(
        "执行器未在期限内结束；请收集诊断并刷新状态，不要重复应用。")), 190000);
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // KernelSU posts exit and then error for a nonzero exit. Keep this inert
        // receiver briefly so both posted events have a valid destination.
        const cleanup = setTimeout(() => { delete root[name]; }, 1000);
        if (cleanup && typeof cleanup.unref === "function") cleanup.unref();
        if (error) reject(error); else resolve(result);
      }
      function append(target, data) {
        if (settled) return;
        const line = String(data);
        size += line.length;
        if (size <= limit) target.push(line);
      }
      root[name] = {
        stdout: {emit(event, data) { if (event === "data") append(stdout, data); }},
        stderr: {emit(event, data) { if (event === "data") append(stderr, data); }},
        emit(event, value) {
          if (settled) return;
          if (event === "error") {
            finish(new Error(value?.message || "异步执行器启动失败。"));
            return;
          }
          if (event !== "exit") return;
          if (size > limit) {
            finish(new Error("诊断输出超过限制；请从终端收集日志。"));
            return;
          }
          const output = stdout.join("\n").trim();
          const lines = output.split("\n");
          let result;
          try { result = JSON.parse(lines[lines.length - 1]); }
          catch (_) {
            finish(new Error("执行器未返回 JSON（exit=" + value + "）："
              + (size > limit ? "诊断输出超过限制" :
                (stderr.join("\n") || output || "无输出").slice(-1500))));
            return;
          }
          if (Number(value) !== 0 || result.ok === false) {
            const error = new Error(result.error ||
              "尚未完成：" + (result.phase || "unknown") + "，请查看设备状态。");
            error.result = result; finish(error);
          } else finish(null, result);
        }
      };
      try {
        // KernelSU joins args as shell text rather than escaping them itself.
        // The controller is constant, actions are whitelisted, save is base64.
        const args = [quote(controller), action];
        if (argument !== undefined) args.push(quote(argument));
        root.ksu.spawn("/system/bin/sh", JSON.stringify(args), "{}", name);
      } catch (error) { finish(error); }
    });
  }
  const api = { call, command };
  root.TurboBridge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
