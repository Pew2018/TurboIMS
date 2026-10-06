"use strict";
// Shared presentation-only color math, loaded before first paint and reused by app.js.
function colorHex(rgb) { return "#" + rgb.map(value => Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,"0")).join("").toUpperCase(); }
function relativeLuminance(rgb) {
  const linear = rgb.map(c => {
    c /= 255;
    return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4;
  });
  return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
}
function contrastRatio(a,b) {
  const lighter = Math.max(a,b), darker = Math.min(a,b);
  return (lighter + .05) / (darker + .05);
}
const LIGHT_FOREGROUND = "#FFFFFF";
const DARK_FOREGROUND = "#000000";
function rgbForHex(hex) { return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)); }
function foregroundForRgb(rgb) {
  const background = relativeLuminance(rgb);
  const white = contrastRatio(background,1), black = contrastRatio(background,0);
  return {color:white >= black ? LIGHT_FOREGROUND : DARK_FOREGROUND,contrast:Math.max(white,black)};
}
// Local OKLab/OKLCH lightness adjustment. Reduce chroma only when required to
// fit sRGB; no WebView OKLCH support or network dependency is needed.
function rgbToOklab(rgb) {
  const [r,g,b] = rgb.map(v => { v /= 255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4; });
  const l = Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m = Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s = Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,
    1.9779984951*l-2.428592205*m+.4505937099*s,
    .0259040371*l+.7827717662*m-.808675766*s];
}
function oklabToLinear([L,a,b]) {
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,
    -1.2684380046*l+2.6097574011*m-.3413193965*s,
    -.0041960863*l-.7034186147*m+1.707614701*s];
}
function toneRgb(rgb, lightness) {
  const [,a,b]=rgbToOklab(rgb), L=Math.max(0,Math.min(1,lightness));
  let chroma=1, linear=oklabToLinear([L,a,b]);
  if (!linear.every(v=>v>=-1e-7 && v<=1+1e-7)) {
    let lo=0,hi=1;
    for(let i=0;i<22;i++){
      const mid=(lo+hi)/2, values=oklabToLinear([L,a*mid,b*mid]);
      if(values.every(v=>v>=-1e-7 && v<=1+1e-7)) lo=mid; else hi=mid;
    }
    chroma=lo; linear=oklabToLinear([L,a*chroma,b*chroma]);
  }
  return linear.map(v=>{v=Math.max(0,Math.min(1,v));return Math.round(255*(v<=.0031308 ? 12.92*v : 1.055*v**(1/2.4)-.055));});
}
function readableTone(rgb, backgrounds, dark, target=4.65) {
  const start=rgbToOklab(rgb)[0];
  for(let step=0;step<=200;step++){
    const L=start+(dark ? 1-start : -start)*step/200;
    const ink=toneRgb(rgb,L);
    if(backgrounds.every(bg=>contrastRatio(relativeLuminance(ink),relativeLuminance(bg))>=target))
      return ink;
  }
  return dark ? [255,255,255] : [0,0,0];
}
function accentInkForRgb(rgb, backgrounds, dark) {
  return colorHex(readableTone(rgb,backgrounds,dark));
}
function mixRgb(a,b,strength) { return a.map((v,i)=>Math.round(v*strength+b[i]*(1-strength))); }
function pressedSurface(rgb, foreground, dark) {
  const white=foreground===LIGHT_FOREGROUND, L=rgbToOklab(rgb)[0];
  const pressed=toneRgb(rgb,L+(white ? -.035 : .035));
  if(contrastRatio(relativeLuminance(pressed),relativeLuminance(rgbForHex(foreground)))>=4.5) return pressed;
  return rgb; // Preserve the fixed foreground even at a gamut boundary.
}
// Only derived roles are adjusted. The chosen/saved seed and picker swatches
// remain exact. Warm/yellow-green themes retain a bright surface and black ink.
function primarySurfaceForRgb(rgb, dark) {
  const [L,a,b]=rgbToOklab(rgb);
  let surface=dark ? toneRgb(rgb,Math.min(L,.50)) : rgb;
  if(!dark && contrastRatio(relativeLuminance(surface),1)<4.65){
    const hue=(Math.atan2(b,a)*180/Math.PI+360)%360;
    const maxChange=hue>=35 && hue<=150 ? .065 : (hue>=180 && hue<=270 ? .19 : .13);
    const whiteSurface=readableTone(rgb,[[255,255,255]],false);
    if(L-rgbToOklab(whiteSurface)[0]<=maxChange) surface=whiteSurface;
  }
  // Classic blue app bar reference, still subject to final contrast checks.
  if(!dark && colorHex(rgb)==="#2196F3") surface=rgbForHex("#1976D2");
  return surface;
}
function generateThemePalette(seed, dark) {
  const rgb=rgbForHex(seed);
  const surface=dark ? [33,33,33] : [255,255,255];
  const card=dark ? [32,32,32] : [250,250,250];
  const page=dark ? [18,18,18] : [238,238,238];
  const backgrounds=[surface,card,page];
  const primary=primarySurfaceForRgb(rgb,dark);
  const onPrimary=foregroundForRgb(primary).color;
  const primaryPressed=pressedSurface(primary,onPrimary,dark);
  const ink=readableTone(rgb,backgrounds,dark);
  const control=readableTone(rgb,backgrounds,dark,3.1);
  const secondary=mixRgb(rgb,surface,.12);
  const secondaryPressed=mixRgb(rgb,surface,.18);
  const onSecondary=readableTone(rgb,[secondary,secondaryPressed],dark);
  const navBackgrounds=dark ? [[18,18,18],surface] : [[255,255,255],surface];
  const navIcon=readableTone(rgb,navBackgrounds,dark,3.1);
  const navLabel=readableTone(rgb,navBackgrounds,dark);
  return {
    seed,primarySurface:colorHex(primary),primaryPressed:colorHex(primaryPressed),
    primarySurfaceDark:colorHex(primarySurfaceForRgb(rgb,true)),onPrimary,
    accentInk:colorHex(ink),controlAccent:colorHex(control),controlStrong:colorHex(ink),
    actionPrimary:colorHex(primary),onActionPrimary:onPrimary,
    actionPrimaryPressed:colorHex(primaryPressed),
    actionSecondary:colorHex(secondary),onActionSecondary:colorHex(onSecondary),
    actionSecondaryPressed:colorHex(secondaryPressed),
    switchThumb:colorHex(control),switchTrack:"rgba("+control.join(",")+",.50)",
    navIcon:colorHex(navIcon),navLabel:colorHex(navLabel),
    swatchForeground:foregroundForRgb(rgb).color
  };
}
