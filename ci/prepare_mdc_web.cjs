"use strict";
const fs=require("fs");
const path=require("path");
const source=path.join("node_modules","material-components-web","dist");
const target=path.join("module","webroot");
for (const [from,to] of [["material-components-web.min.css","mdc-web.min.css"],["material-components-web.min.js","mdc-web.min.js"]]) {
  const input=path.join(source,from), output=path.join(target,to);
  if (!fs.existsSync(input)) throw new Error("Missing MDC Web distribution file: "+input);
  fs.copyFileSync(input,output);
}
console.log("Prepared local MDC Web v14.0.0 assets.");
