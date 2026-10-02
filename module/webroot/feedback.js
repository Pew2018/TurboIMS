"use strict";
// Presentation only: lightweight dialog transitions. No document-level
// pointer listeners, transient nodes, layout measurement or scroll interception.
(() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = (name, fallback) => {
    if (reduced()) return 0;
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
  };
  const dialogAnimations = new WeakMap();
  function cancelDialogAnimations(backdrop) {
    for (const animation of dialogAnimations.get(backdrop) || []) animation.cancel();
    dialogAnimations.delete(backdrop);
  }
  // Attach only to compact controls; rows and the scrolling viewport do not
  // observe pointer movement or allocate visual nodes.
  const bound = new WeakSet();
  const pending = new WeakMap();
  function bindRipple(surface) {
    if (!surface || bound.has(surface)) return;
    bound.add(surface);
    surface.dataset.ripple = "control";
    surface.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0 || surface.disabled ||
          surface.closest('[aria-disabled="true"]')) return;
      pending.set(surface,{
        id:event.pointerId,x:event.clientX,y:event.clientY,
        scroll:document.getElementById("page-content")?.scrollTop || 0
      });
    },{passive:true});
    surface.addEventListener("pointercancel",()=>pending.delete(surface),{passive:true});
    surface.addEventListener("pointerup",event => {
      const tap = pending.get(surface);
      pending.delete(surface);
      if (!tap || tap.id !== event.pointerId || surface.disabled ||
          surface.closest('[aria-disabled="true"]')) return;
      const slop = event.pointerType === "mouse" ? 8 : 10;
      const scroll = document.getElementById("page-content")?.scrollTop || 0;
      if (Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>slop ||
          Math.abs(scroll-tap.scroll)>2 ||
          matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const rect = surface.getBoundingClientRect();
      const x=event.clientX-rect.left,y=event.clientY-rect.top;
      const radius=Math.hypot(Math.max(x,rect.width-x),Math.max(y,rect.height-y));
      const circle=document.createElement("span");
      circle.className="tap-ripple";
      circle.style.width=circle.style.height=radius*2+"px";
      circle.style.left=x-radius+"px";
      circle.style.top=y-radius+"px";
      circle.setAttribute("aria-hidden","true");
      // WebView may skip animationend if a tab becomes hidden mid-animation.
      const cleanup = setTimeout(()=>circle.remove(),500);
      circle.addEventListener("animationend",()=>{
        clearTimeout(cleanup);
        circle.remove();
      },{once:true});
      surface.append(circle);
    },{passive:true});
  }
  function bind(root=document) {
    const selector=".bottom-tab,.switch-hit,.text-action,.choice,.option,.swatch-item,.feature-reset,.dialog-cancel,.back,[data-ripple='control']";
    if (root.matches?.(selector)) bindRipple(root);
    root.querySelectorAll?.(selector).forEach(bindRipple);
  }
  bind();
  window.TouchFeedback = {
    bind,
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