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