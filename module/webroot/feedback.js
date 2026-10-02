"use strict";
// Presentation only: no config, privileged bridge, history, or activation handlers.
(() => {
  const active = new Map();
  const suppressed = new WeakMap();
  const keyboardGuard = new WeakMap();
  const TOUCH_SLOP = 14;
  const MOUSE_SLOP = 8;
  const suppressionWindow = 650;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = (name, fallback) => {
    if (reduced()) return 0;
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
  };
  function surfaceFor(target) {
    if (!target?.closest) return null;
    const control = target.closest("button,input[role='switch']");
    const row = target.closest("[data-feedback='row'],label.setting-row");
    const surface = row || control;
    if (!surface || surface.closest("[hidden],[data-closing='true']")) return null;
    if (control?.disabled || surface.getAttribute("aria-disabled") === "true") return null;
    if (row && row.querySelector("button:disabled,input:disabled")) return null;
    return surface;
  }
  function suppress(surface) {
    if (surface) suppressed.set(surface, now() + suppressionWindow);
  }
  function clearSuppression(surface) {
    const until = suppressed.get(surface) || 0;
    if (until <= now()) {
      suppressed.delete(surface);
      return false;
    }
    suppressed.delete(surface);
    return true;
  }
  function clearPress(surface) {
    if (![...active.values()].some(item => item.surface === surface)) surface.classList.remove("feedback-pressed");
  }
  function begin(surface, x, y, id, pointerType = "touch") {
    release(id, true);
    surface.classList.add("touch-surface","feedback-pressed");
    if (reduced()) {
      active.set(id,{surface,wave:null,start:now(),x,y,pointerType});
      return;
    }
    const rect = surface.getBoundingClientRect();
    const localX = Math.max(0,Math.min(rect.width,x-rect.left));
    const localY = Math.max(0,Math.min(rect.height,y-rect.top));
    const radius = Math.hypot(Math.max(localX,rect.width-localX),Math.max(localY,rect.height-localY));
    const wave = document.createElement("span");
    wave.className = "touch-ripple";
    wave.setAttribute("aria-hidden","true");
    wave.dataset.x = String(localX);
    wave.dataset.y = String(localY);
    Object.assign(wave.style,{
      width:radius*2+"px",height:radius*2+"px",
      left:localX-radius+"px",top:localY-radius+"px"
    });
    // Keep transient feedback bounded during rapid taps.
    const old = surface.querySelectorAll(".touch-ripple");
    if (old.length >= 3) old[0].remove();
    surface.append(wave);
    if (wave.animate) {
      wave.animate([{transform:"scale(0)"},{transform:"scale(1)"}],{
        duration:duration("--ripple-grow-duration",220),
        easing:"cubic-bezier(.2,0,.2,1)",fill:"forwards"
      });
    } else wave.style.transform = "scale(1)";
    active.set(id,{surface,wave,start:now(),x,y,pointerType});
  }
  function release(id, cancelled = false) {
    const item = active.get(id);
    if (!item) return;
    active.delete(id);
    clearPress(item.surface);
    if (cancelled) suppress(item.surface);
    if (!item.wave) return;
    const delay = cancelled ? 0 : Math.max(0,100-(now()-item.start));
    setTimeout(() => {
      if (!item.wave.isConnected) return;
      if (!item.wave.animate || reduced()) {
        item.wave.remove();
        return;
      }
      const fade = item.wave.animate(
        [{opacity:getComputedStyle(item.wave).opacity},{opacity:0}],
        {duration:cancelled ? 80 : duration("--ripple-fade-duration",140),
         easing:"linear",fill:"forwards"}
      );
      fade.finished.catch(() => {}).then(() => item.wave.remove());
    },delay);
  }
  document.querySelectorAll("label.setting-row").forEach(row => row.dataset.feedback = "row");

  document.addEventListener("pointerdown", event => {
    if (event.isPrimary === false || event.button !== 0) return;
    const surface = surfaceFor(event.target);
    if (surface) begin(surface,event.clientX,event.clientY,event.pointerId,event.pointerType);
  },{passive:true});

  document.addEventListener("pointermove", event => {
    const item = active.get(event.pointerId);
    if (!item) return;
    const slop = item.pointerType === "mouse" ? MOUSE_SLOP : TOUCH_SLOP;
    if (Math.hypot(event.clientX-item.x,event.clientY-item.y) > slop) release(event.pointerId,true);
  },{passive:true});

  document.addEventListener("pointerup", event => release(event.pointerId),{passive:true});
  document.addEventListener("pointercancel", event => release(event.pointerId,true),{passive:true});
  window.addEventListener("blur", () => {
    for (const id of active.keys()) release(id,true);
  });

  document.addEventListener("keydown", event => {
    if (!["Enter"," "].includes(event.key) || event.repeat) return;
    const surface = surfaceFor(event.target);
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    keyboardGuard.delete(surface);
    begin(surface,rect.left+rect.width/2,rect.top+rect.height/2,"keyboard","keyboard");
  });
  document.addEventListener("keyup", event => {
    if (!["Enter"," "].includes(event.key)) return;
    const surface = surfaceFor(event.target);
    if (surface) keyboardGuard.set(surface,now()+250);
    release("keyboard");
  });

  // A cancelled drag can still produce a synthetic click in some WebViews.
  // Capture this before row handlers so scrolling never triggers an action.
  document.addEventListener("click", event => {
    const surface = surfaceFor(event.target);
    if (!surface || !clearSuppression(surface)) return;
    event.preventDefault();
    event.stopPropagation();
  },true);

  document.addEventListener("click", event => {
    // Keyboard/assistive activation has no pointer location; use the row center.
    if (event.detail !== 0) return;
    const surface = surfaceFor(event.target);
    if (!surface) return;
    const guardedUntil = keyboardGuard.get(surface) || 0;
    if (guardedUntil > now()) {
      keyboardGuard.delete(surface);
      return;
    }
    keyboardGuard.delete(surface);
    const rect = surface.getBoundingClientRect();
    begin(surface,rect.left+rect.width/2,rect.top+rect.height/2,"activation","keyboard");
    release("activation");
  });

  const dialogAnimations = new WeakMap();
  function cancelDialogAnimations(backdrop) {
    for (const animation of dialogAnimations.get(backdrop) || []) animation.cancel();
    dialogAnimations.delete(backdrop);
  }
  window.TouchFeedback = {
    openDialog(backdrop) {
      cancelDialogAnimations(backdrop);
      delete backdrop.dataset.closing;
      const dialog = backdrop.querySelector(".dialog");
      if (reduced() || !backdrop.animate) return;
      const time = duration("--dialog-enter-duration",160);
      const animations = [
        backdrop.animate([{opacity:0},{opacity:1}],{duration:time,easing:"ease-out"}),
        dialog.animate([{transform:"translateY(4px)"},{transform:"translateY(0)"}],{duration:time,easing:"ease-out"})
      ];
      dialogAnimations.set(backdrop,animations);
    },
    closeDialog(backdrop, complete) {
      cancelDialogAnimations(backdrop);
      backdrop.dataset.closing = "true";
      if (reduced() || !backdrop.animate) {
        delete backdrop.dataset.closing;
        complete();
        return;
      }
      const time = duration("--dialog-exit-duration",100);
      const animation = backdrop.animate(
        [{opacity:1},{opacity:0}],
        {duration:time,easing:"ease-in",fill:"forwards"}
      );
      dialogAnimations.set(backdrop,[animation]);
      animation.finished.catch(() => {}).then(() => {
        complete();
        cancelDialogAnimations(backdrop);
        delete backdrop.dataset.closing;
      });
    }
  };
})();