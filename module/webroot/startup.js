"use strict";
// Presentation preferences and startup lifecycle only. Never invokes a root command.
(() => {
  const root = document.documentElement;
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  let appClaimed = false, state = "loading", retryAction = null, disposed = false;
  let earlyFailure = "", listenersAttached = false;
  function read(key,fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function earlyTheme() {
    let mode=read("turboims-theme","system");
    if (!["system","light","dark"].includes(mode)) mode="system";
    const dark=mode==="dark" || mode==="system" && !!media?.matches;
    let accent=read("turboims-accent","#42A5F5").toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(accent)) accent="#42A5F5";
    const toolbarAccent=read("turboims-accent-toolbar","false")==="true";
    root.dataset.theme=dark?"dark":"light";
    root.dataset.cardGroups=String(read("turboims-card-groups","false")==="true");
    root.dataset.accentToolbar=String(toolbarAccent);
    root.style.setProperty("--accent",accent);
    root.style.setProperty("--accent-seed",accent);
    if (typeof generateThemePalette === "function") {
      // Exactly the same derived roles as the full UI, including extreme custom colors.
      const palette=generateThemePalette(accent,dark);
      const chrome=dark?"#121212":"#FFFFFF";
      const toolbar=toolbarAccent?palette.primarySurface:chrome;
      const foreground=toolbarAccent?palette.onPrimary:foregroundForRgb(rgbForHex(toolbar)).color;
      for(const [name,value] of Object.entries({
        "--control-accent":palette.controlAccent,"--accent-ink":palette.accentInk,
        "--primary-surface":palette.primarySurface,"--on-primary":palette.onPrimary,
        "--toolbar-tint":toolbar,"--toolbar-foreground":foreground,
        "--system-status-bg":toolbar,"--system-navigation-bg":chrome
      })) root.style.setProperty(name,value);
      root.dataset.statusBarIcons=foreground===DARK_FOREGROUND?"dark":"light";
      for(const [id,color] of Object.entries({"theme-color":toolbar,"status-bar-color":toolbar,"navigation-bar-color":chrome}))
        document.getElementById(id)?.setAttribute("content",color);
    }
  }
  earlyTheme();
  function visibility() { root.dataset.startupVisible=String(!document.hidden && state==="loading"); }
  function paint() {
    root.dataset.loading=state==="ready"?"false":state==="error"?"error":"true";
    const progress=document.getElementById("startup-progress");
    if (progress) progress.hidden=state!=="loading";
    const message=document.getElementById("startup-message");
    if (message) message.textContent=state==="error" ? earlyFailure : "正在加载…";
    const view=document.getElementById("startup-view");
    view?.setAttribute("aria-busy",String(state==="loading"));
    const retry=document.getElementById("startup-retry");
    if (retry) {
      retry.hidden=state!=="error" || !retryAction;
      retry.disabled=state==="loading";
      retry.onclick=() => { if (state==="error" && !disposed) retryAction?.(); };
    }
    visibility();
  }
  function onError(event) {
    if (state==="ready" || disposed) return;
    const target=event.target;
    const script=target?.tagName==="SCRIPT";
    fail(script ? "WebUI 资源加载失败，请重试。" : "WebUI 初始化出现异常，请重试。",
      () => location.reload());
  }
  function onRejection() {
    if (state!=="ready" && !disposed) fail("WebUI 初始化出现异常，请重试。",() => location.reload());
  }
  function attach() {
    if (listenersAttached || disposed) return;
    listenersAttached=true;
    window.addEventListener("error",onError,true);
    window.addEventListener("unhandledrejection",onRejection);
    document.addEventListener("visibilitychange",visibility);
  }
  function cleanup() {
    window.removeEventListener?.("error",onError,true);
    window.removeEventListener?.("unhandledrejection",onRejection);
    document.removeEventListener?.("visibilitychange",visibility);
    listenersAttached=false;
  }
  function fail(text,retry=null) {
    if (disposed) return;
    state="error";earlyFailure=text;retryAction=retry;
    cleanup();paint();
  }
  function begin() {
    if (disposed) return;
    state="loading";earlyFailure="";retryAction=null;
    attach();paint();
  }
  function ready() {
    if (disposed) return;
    state="ready";retryAction=null;
    cleanup();paint();
  }
  function onDOMReady() {
    document.removeEventListener?.("DOMContentLoaded",onDOMReady);
    if (!appClaimed && state==="loading") fail("WebUI 初始化未能启动，请重试。",() => location.reload());
    else paint();
  }
  function onPageHide() {
    disposed=true;cleanup();
    document.removeEventListener?.("DOMContentLoaded",onDOMReady);
    window.removeEventListener?.("pagehide",onPageHide);
    const retry=document.getElementById("startup-retry");
    if (retry) retry.onclick=null;
  }
  window.TurboStartup={claim(){appClaimed=true;},begin,ready,fail};
  attach();visibility();
  document.addEventListener("DOMContentLoaded",onDOMReady);
  window.addEventListener("pagehide",onPageHide);
})();
