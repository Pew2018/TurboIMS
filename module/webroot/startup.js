"use strict";
// Runs before first paint. Only presentation preferences; no system operations.
(() => {
  const root = document.documentElement;
  try {
    const mode = localStorage.getItem("turboims-theme") || "system";
    root.dataset.theme = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    root.dataset.cardGroups = String(localStorage.getItem("turboims-card-groups") === "true");
  } catch (_) { root.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  // If a script fails, retain a clean error view instead of exposing partial controls.
  window.turboStartupTimer = setTimeout(() => {
    const message = document.getElementById("startup-message");
    if (root.dataset.loading === "true" && message) message.textContent = "加载未完成，请重新打开";
  }, 10000);
})();
