"use strict";
/*
 * TurboIMS Next MDC Web adapter.
 * MDC Web v14 is loaded from the locally generated module assets. Existing
 * form controls remain the state source; MDC controls are the visual/interaction
 * layer so the IMS/SIM bridge and persisted configuration remain unchanged.
 */
(() => {
  const upgraded = new WeakSet();
  const switchInputs = new Set();
  const buttonSelector = "button.action-button,button.text-action,button.dialog-cancel,button.choice,button.pref-action,button.bottom-tab,button.back,button.swatch-item,button.sim-edit-row";
  function mdc() { return window.mdc || null; }
  function enhanceButton(button) {
    if (!button || upgraded.has(button)) return;
    if (!button.classList.contains("mdc-button") && !button.classList.contains("mdc-icon-button")) return;
    upgraded.add(button);
    if (button.classList.contains("mdc-button") && !button.querySelector(".mdc-button__ripple")) {
      const ripple=document.createElement("span"); ripple.className="mdc-button__ripple";
      const label=document.createElement("span"); label.className="mdc-button__label";
      while(button.firstChild) label.append(button.firstChild);
      button.append(ripple,label);
    }
    try {
      if (mdc()?.ripple?.MDCRipple && !button.__mdcRipple) button.__mdcRipple=mdc().ripple.MDCRipple.attachTo(button);
    } catch (_) {}
  }
  function syncSwitch(input) {
    const button=input.__mdcButton;
    if (!button) return;
    const selected=!!input.checked;
    button.classList.toggle("mdc-switch--selected",selected);
    button.classList.toggle("mdc-switch--unselected",!selected);
    button.setAttribute("aria-checked",String(selected));
    button.disabled=!!input.disabled;
    try { if (button.__mdcSwitch) button.__mdcSwitch.selected=selected; } catch (_) {}
  }
  function enhanceSwitch(input) {
    if (!input || input.type!=="checkbox" || input.dataset.mdcBound==="true") return;
    const hit=input.closest(".switch-hit");
    if (!hit) return;
    input.dataset.mdcBound="true"; input.classList.add("mdc-input-proxy");
    const button=document.createElement("button");
    button.type="button"; button.className="mdc-switch mdc-switch--unselected";
    button.setAttribute("role","switch");
    button.setAttribute("aria-label",input.getAttribute("aria-label")||input.id);
    button.innerHTML='<div class="mdc-switch__track"></div><div class="mdc-switch__handle-track"><div class="mdc-switch__handle"><div class="mdc-switch__shadow"><div class="mdc-elevation-overlay"></div></div><div class="mdc-switch__ripple"></div><div class="mdc-switch__icons"></div></div></div>';
    hit.insertBefore(button,input);
    input.__mdcButton=button; switchInputs.add(input);
    const checked=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"checked");
    const disabled=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"disabled");
    if (checked && !Object.prototype.hasOwnProperty.call(input,"checked")) Object.defineProperty(input,"checked",{configurable:true,get(){return checked.get.call(this)},set(v){checked.set.call(this,v);syncSwitch(this)}});
    if (disabled && !Object.prototype.hasOwnProperty.call(input,"disabled")) Object.defineProperty(input,"disabled",{configurable:true,get(){return disabled.get.call(this)},set(v){disabled.set.call(this,v);syncSwitch(this)}});
    button.addEventListener("click",()=>{ if(input.disabled) return; const value=!input.checked; input.checked=value; input.dispatchEvent(new Event("change",{bubbles:true})); syncSwitch(input); });
    input.addEventListener("change",()=>syncSwitch(input));
    try { if (mdc()?.switch?.MDCSwitch) input.__mdcButton.__mdcSwitch=mdc().switch.MDCSwitch.attachTo(button); } catch (_) {}
    syncSwitch(input);
  }
  function enhanceTextFields(root=document) {
    const api=mdc()?.textField?.MDCTextField;
    root.querySelectorAll?.(".mdc-text-field").forEach(el=>{ if(!el.__mdcTextField && api) try{el.__mdcTextField=api.attachTo(el)}catch(_){} });
  }
  function enhanceRadios(root=document) {
    const api=mdc()?.radio?.MDCRadio;
    root.querySelectorAll?.(".radio-mark").forEach(el=>{ el.classList.add("mdc-radio"); if(!el.__mdcRadio && api) try{el.__mdcRadio=api.attachTo(el)}catch(_){} });
  }
  function enhanceDialogs(root=document) {
    const api=mdc()?.dialog?.MDCDialog;
    root.querySelectorAll?.(".mdc-dialog").forEach(el=>{ if(!el.__mdcDialog && api) try{el.__mdcDialog=api.attachTo(el)}catch(_){} });
  }
  function enhanceCards(root=document) {
    root.querySelectorAll?.(".pref-group").forEach(el=>el.classList.add("mdc-card"));
  }
  function enhanceTopAppBar() {
    const toolbar=document.querySelector?.(".toolbar");
    const row=document.querySelector?.(".toolbar-inner");
    const title=document.querySelector?.("#page-title");
    const back=document.querySelector?.("#back");
    toolbar?.classList.add("mdc-top-app-bar");
    row?.classList.add("mdc-top-app-bar__row");
    title?.classList.add("mdc-top-app-bar__title");
    back?.classList.add("mdc-icon-button");
  }
  function scan(root=document) {
    enhanceTopAppBar();
    root.querySelectorAll?.("input[type=checkbox]").forEach(enhanceSwitch);
    root.querySelectorAll?.(buttonSelector).forEach(enhanceButton);
    enhanceTextFields(root); enhanceRadios(root); enhanceDialogs(root); enhanceCards(root);
  }
  document.addEventListener("DOMContentLoaded",()=>scan());
  new MutationObserver(mutations=>mutations.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.documentElement,{subtree:true,childList:true});
  window.MDCRuntime={scan,syncSwitch(input){syncSwitch(input)},syncAll(){switchInputs.forEach(syncSwitch)}};
})();