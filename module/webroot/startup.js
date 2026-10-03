"use strict";
// Runs before first paint. Only presentation preferences; no system operations.
(() => {
  const root = document.documentElement;
  let startupFailure = "";
  try {
    const mode = localStorage.getItem("turboims-theme") || "system";
    root.dataset.theme = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    root.dataset.cardGroups = String(localStorage.getItem("turboims-card-groups") === "true");
  } catch (_) { root.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }

  // Capture early script failures. The app bundle is deferred, so this handler
  // must be installed by the small parser-blocking startup script.
  window.addEventListener("error", event => {
    const target = event.target;
    startupFailure = target && target.tagName === "SCRIPT"
      ? "资源加载失败：" + (target.getAttribute("src") || "脚本")
      : (event.message || "页面脚本发生异常");
  }, true);
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    startupFailure = "初始化异步错误：" + String(reason && reason.message || reason || "未知错误");
  });

  // Keep startup failure visible and actionable instead of asking the user to
  // reopen without explaining why. This runs only if app.js did not dismiss it.
  window.turboStartupTimer = setTimeout(() => {
    const message = document.getElementById("startup-message");
    const view = document.getElementById("startup-view");
    if (root.dataset.loading !== "true" || !message || !view) return;
    message.textContent = "WebUI 初始化未完成";
    const line = view.querySelector(".startup-line");
    if (line) line.hidden = true;
    const detail = document.createElement("small");
    detail.id = "startup-error-detail";
    detail.textContent = startupFailure || "主界面脚本未能启动。请检查模块文件是否完整，并把此提示发给维护者。";
    view.append(detail);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "action-button action-button--primary";
    retry.textContent = "重新加载 WebUI";
    retry.addEventListener("click", () => location.reload());
    view.append(retry);
  }, 10000);
})();
