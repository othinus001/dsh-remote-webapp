/** 量会话头部内部元素（宽度/文本），为给标题腾地方做依据。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-hdr-" + Date.now());
const OUT = path.join(ROOT, "build");
fs.mkdirSync(OUT, { recursive: true });
const props = fs.readFileSync(path.join(ROOT, "local.properties"), "utf8");
const prop = (k) => (props.match(new RegExp("^" + k + "=(.*)$", "m")) || [, ""])[1].trim();
const START_URL = prop("server.url").replace(/\/$/, "") + "/?token=" + prop("server.token");
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const UA =
  "Mozilla/5.0 (Linux; Android 15; 23117RK66C Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let seq = 0;
const pending = new Map();
function send(ws, method, params = {}, sessionId) {
  const id = ++seq;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function waitJson(url) {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(250); }
  throw new Error("no cdp");
}
const DUMP = `(function(){
  var hdr=document.querySelector('[data-slot="conversation.header"]');
  if(!hdr) return JSON.stringify({err:'no header'});
  var out=[];
  var walk=function(el,depth){
    if(depth>4||!el) return;
    var b=el.getBoundingClientRect();
    var cs=getComputedStyle(el);
    out.push({d:depth,tag:el.tagName.toLowerCase(),cls:String(el.className||'').slice(0,34),
      x:Math.round(b.x),w:Math.round(b.width),h:Math.round(b.height),
      disp:cs.display,flex:cs.flex,ovf:cs.overflow,
      txt:String(el.innerText||'').replace(/\\s+/g,' ').slice(0,28),
      aria:el.getAttribute&&el.getAttribute('aria-label')});
    for(var i=0;i<el.children.length;i++) walk(el.children[i],depth+1);
  };
  walk(hdr,0);
  var hb=hdr.getBoundingClientRect();
  var bx=function(el){if(!el)return null;var r=el.getBoundingClientRect();return {x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height)}};
  var crumb=hdr.querySelector('[class*="_crumbCurrent"]')||hdr.querySelector('[class*="_crumb"]');
  var utils=hdr.querySelector('[class*="_headerUtilities"]');
  var utilsKids=utils?[].slice.call(utils.children).map(function(c){var b=c.getBoundingClientRect();return {cls:String(c.className||'').slice(0,26),aria:c.getAttribute('aria-label'),x:Math.round(b.x),w:Math.round(b.width)}}):[];
  var comp=document.querySelector('[contenteditable="true"]');
  var md=document.querySelector('[class*="_markdown"]');
  var col=md&&md.closest('[class*="_column"]');
  return JSON.stringify({
    header:{x:Math.round(hb.x),w:Math.round(hb.width),h:Math.round(hb.height)},
    crumb:crumb?{x:Math.round(crumb.getBoundingClientRect().x),w:Math.round(crumb.getBoundingClientRect().width),sw:crumb.scrollWidth,cw:crumb.clientWidth,txt:String(crumb.innerText||'').slice(0,24)}:null,
    utils:bx(utils),utilsKids:utilsKids,
    composer:bx(comp),markdown:bx(md),column:bx(col),
    colPad:col?getComputedStyle(col).paddingLeft+'/'+getComputedStyle(col).paddingRight:null,
    nodes:out
  });
})()`;
async function main() {
  const version = await waitJson("http://127.0.0.1:" + PORT + "/json/version");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await S("Page.navigate", { url: START_URL });
  for (let i = 0; i < 80; i++) { const r = await S("Runtime.evaluate", { expression: "!!document.querySelector('[class*=\"_sidebarCol\"]')", returnByValue: true }); if (r.result.value === true) break; await sleep(250); }
  await sleep(1500);
  // 先点一个真实会话，让头部出现
  const PICK = `(function(){
    var rows=[].slice.call(document.querySelectorAll('[role="treeitem"][class*="_sessionRow"]'));
    for (var i=0;i<rows.length;i++){
      var t=String(rows[i].innerText||'');
      if (t.indexOf('进行中')>=0){
        var b=rows[i].getBoundingClientRect();
        return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)});
      }
    }
    return null;
  })()`;
  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  await click(24, 26);
  await sleep(900);
  let pick = { result: { value: null } };
  for (let i = 0; i < 40; i++) {
    pick = await S("Runtime.evaluate", { expression: PICK, returnByValue: true });
    if (pick.result.value) break;
    await sleep(500);
  }
  const p0 = pick.result.value ? JSON.parse(pick.result.value) : null;
  if (p0) await click(p0.x, p0.y);
  for (let i = 0; i < 40; i++) {
    const r = await S("Runtime.evaluate", {
      expression: "!!document.querySelector('[data-slot=\"conversation.header\"] header:not([class*=\"_headerBlank\"])')",
      returnByValue: true,
    });
    if (r.result.value === true) break;
    await sleep(500);
  }
  await sleep(800);
  await S("Runtime.evaluate", { expression:
    "(function(){var s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";})()" });
  await S("Runtime.evaluate", { expression: js });
  await sleep(1500);
  const r = await S("Runtime.evaluate", { expression: DUMP, returnByValue: true });
  fs.writeFileSync(path.join(OUT, "header-dump.json"), r.result.value || "{}");
  const d = JSON.parse(r.result.value || "{}");
  console.log("header", JSON.stringify(d.header));
  for (const n of d.nodes || []) console.log(" ".repeat(n.d * 2) + [n.tag, n.cls, n.x + "/" + n.w + "x" + n.h, n.disp, n.aria || "", JSON.stringify(n.txt)].join(" "));
  const sh = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "header-shot.png"), Buffer.from(sh.data, "base64"));
  ws.close();
}
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} process.exit(2); }, 120000);
main().catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(hardStop); await sleep(200); try { child.kill(); } catch {} });
