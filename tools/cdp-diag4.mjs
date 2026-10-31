/** 探针 4：试跑候选 CSS（头部按钮整齐 + 设置面板可滚动），不改项目文件。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-diag4-" + Date.now());
const OUT = path.join(ROOT, "build");
fs.mkdirSync(OUT, { recursive: true });
const props = fs.readFileSync(path.join(ROOT, "local.properties"), "utf8");
const prop = (k) => (props.match(new RegExp("^" + k + "=(.*)$", "m")) || [, ""])[1].trim();
const START_URL = prop("server.url").replace(/\/$/, "") + "/?token=" + prop("server.token");
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const CANDIDATE = fs.readFileSync(path.join(ROOT, "build", process.env.CAND || "candidate.css"), "utf8");
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

const BTN_DUMP = `(function(){
  var hdr=document.querySelector('[data-slot="conversation.header"]');
  var hb=hdr.getBoundingClientRect();
  var out=[];
  [].slice.call(hdr.querySelectorAll('button[aria-label]')).forEach(function(b){
    var r=b.getBoundingClientRect();
    if(r.width>0) out.push({aria:b.getAttribute('aria-label'),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right)});
  });
  var crumb=hdr.querySelector('[class*="_crumbCurrent"]');
  var cb=crumb?crumb.getBoundingClientRect():null;
  return JSON.stringify({header:{x:Math.round(hb.x),y:Math.round(hb.y),w:Math.round(hb.width),h:Math.round(hb.height)},
    crumb:cb?{x:Math.round(cb.x),w:Math.round(cb.width),sw:crumb.scrollWidth,cw:crumb.clientWidth}:null, btns:out});
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
  const ev = async (expression) => (await S("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  await ev("(function(){var s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";})()");
  await ev(js);
  await sleep(1200);

  // 打开会话
  await click(24, 26);
  await sleep(900);
  const PICK = `(function(){var rows=[].slice.call(document.querySelectorAll('[role="treeitem"][class*="_sessionRow"]'));
    for (var i=0;i<rows.length;i++){var t=String(rows[i].innerText||'');if(t.indexOf('进行中')>=0){var b=rows[i].getBoundingClientRect();return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)});}}return null;})()`;
  let pick = null;
  for (let i = 0; i < 40; i++) { const v = await ev(PICK); if (v) { pick = JSON.parse(v); break; } await sleep(400); }
  if (pick) await click(pick.x, pick.y);
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('[data-slot=\"conversation.header\"] header:not([class*=\"_headerBlank\"])')")) break; await sleep(400); }
  await sleep(1000);
  console.log("== BEFORE (当前 skin) ==");
  console.log(JSON.stringify(JSON.parse(await ev(BTN_DUMP)), null, 1));

  // 注入候选 CSS
  await ev("(function(){var s=document.getElementById('dsh-candidate');if(!s){s=document.createElement('style');s.id='dsh-candidate';document.head.appendChild(s);}s.textContent=" + JSON.stringify(CANDIDATE) + ";})()");
  await sleep(1200);
  const candJsPath = path.join(ROOT, "build", process.env.CANDJS || "candidate.js");
  if (fs.existsSync(candJsPath)) {
    console.log("candidate.js =>", await ev(fs.readFileSync(candJsPath, "utf8")));
    await sleep(600);
  }
  console.log("== AFTER (候选 CSS) ==");
  console.log(JSON.stringify(JSON.parse(await ev(BTN_DUMP)), null, 1));
  const sh1 = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "diag4-header.png"), Buffer.from(sh1.data, "base64"));

  // 设置面板滚动测试
  await click(24, 26);
  await sleep(900);
  const sb = await ev(`(function(){var b=document.querySelector('.dsh-settings-btn');if(!b)return null;var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  if (sb) { const p = JSON.parse(sb); await click(p.x, p.y); }
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('[role=\"dialog\"]')")) break; await sleep(400); }
  await sleep(800);
  const tabPos = await ev(`(function(){var t=[].slice.call(document.querySelectorAll('[role="dialog"] [class*="_navCell"]')).filter(function(c){return String(c.innerText||'').indexOf('通用设置')>=0;})[0];if(!t)return null;var r=t.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  if (tabPos) { const p = JSON.parse(tabPos); await click(p.x, p.y); }
  await sleep(1200);
  const measure = `(function(){var o=document.querySelector('[role="dialog"] [class*="_options"]');var c=document.querySelector('[role="dialog"] [class*="_content"]');
    var p=document.querySelector('[role="dialog"]');var orb=o.getBoundingClientRect();
    return JSON.stringify({options:{sh:o.scrollHeight,ch:o.clientHeight,st:o.scrollTop,y:Math.round(orb.y),h:Math.round(orb.height),ovfY:getComputedStyle(o).overflowY},
      content:{h:Math.round(c.getBoundingClientRect().height),minH:getComputedStyle(c).minHeight,ovf:getComputedStyle(c).overflow},
      panel:{h:Math.round(p.getBoundingClientRect().height),ovfY:getComputedStyle(p).overflowY}});})()`;
  console.log("panel before scroll", await ev(measure));
  await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: 206, y: 600 });
  for (let i = 0; i < 6; i++) { await S("Input.dispatchMouseEvent", { type: "mouseWheel", x: 206, y: 600, deltaX: 0, deltaY: 300 }); await sleep(120); }
  await sleep(400);
  console.log("panel after wheel", await ev(measure));

  // 顶部标签条横向滚动测试
  const navMeasure = `(function(){var n=document.querySelector('[role="dialog"] [class*="_navList"]');if(!n)return 'null';
    var cells=[].slice.call(n.children).map(function(c){var r=c.getBoundingClientRect();return {t:String(c.innerText||'').trim().slice(0,6),x:Math.round(r.x),w:Math.round(r.width)};});
    return JSON.stringify({sw:n.scrollWidth,ch:n.clientWidth,sl:Math.round(n.scrollLeft),ovfX:getComputedStyle(n).overflowX,cells:cells});})()`;
  console.log("nav before", await ev(navMeasure));
  await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200, y: 28 });
  for (let i = 0; i < 6; i++) { await S("Input.dispatchMouseEvent", { type: "mouseWheel", x: 200, y: 28, deltaX: 200, deltaY: 0 }); await sleep(120); }
  await sleep(400);
  console.log("nav after wheel", await ev(navMeasure));
  const sh2 = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "diag4-settings.png"), Buffer.from(sh2.data, "base64"));
  ws.close();
}
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} process.exit(2); }, 150000);
main().catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(hardStop); await sleep(200); try { child.kill(); } catch {} });
