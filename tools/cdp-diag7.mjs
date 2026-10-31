/** 探针 7：检查 navList 上 overflow 为何不生效（内联/计算值/规则命中）。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-diag7-" + Date.now());
const props = fs.readFileSync(path.join(ROOT, "local.properties"), "utf8");
const prop = (k) => (props.match(new RegExp("^" + k + "=(.*)$", "m")) || [, ""])[1].trim();
const START_URL = prop("server.url").replace(/\/$/, "") + "/?token=" + prop("server.token");
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const CAND = process.env.CAND ? fs.readFileSync(path.join(ROOT, "build", process.env.CAND), "utf8") : "";
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

async function main() {
  const target = await waitJson("http://127.0.0.1:" + PORT + "/json/version");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  });
  const { targetId } = await send(ws, "Target.createTarget", { url: START_URL });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p = {}) => send(ws, m, p, sessionId);
  const ev = async (expression) => (await S("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await S("Page.enable");
  await S("Page.navigate", { url: START_URL });
  await sleep(4000);
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('[class*=\"_sidebarCol\"]')")) break; await sleep(400); }
  await sleep(1200);
  await ev("(function(){var s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";})()");
  await ev(js);
  await sleep(1200);
  if (CAND) { await ev("(function(){var s=document.getElementById('dsh-candidate');if(!s){s=document.createElement('style');s.id='dsh-candidate';document.head.appendChild(s);}s.textContent=" + JSON.stringify(CAND) + ";})()"); await sleep(600); }

  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  await click(24, 26);
  await sleep(900);
  const sb = await ev(`(function(){var b=document.querySelector('.dsh-settings-btn');if(!b)return null;var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  if (sb) { const p = JSON.parse(sb); await click(p.x, p.y); }
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('[role=\"dialog\"]')")) break; await sleep(400); }
  await sleep(1000);

  const out = await ev(`(function(){
    var n=document.querySelector('[role="dialog"] [class*="_navList"]');
    var cs0=getComputedStyle(n);
    var before={ovfX:cs0.overflowX,ovfY:cs0.overflowY,cw:n.clientWidth,sw:n.scrollWidth};
    n.style.setProperty('overflow-x','auto','important');
    n.style.setProperty('overflow-y','hidden','important');
    var cs1=getComputedStyle(n);
    var afterInline={ovfX:cs1.overflowX,ovfY:cs1.overflowY,cw:n.clientWidth,sw:n.scrollWidth};
    n.scrollLeft=120;
    var sl=n.scrollLeft;
    var styleEl=document.getElementById('dsh-candidate');
    var txt=styleEl?styleEl.textContent:'';
    return JSON.stringify({before:before, afterInline:afterInline, scrollLeftAfterSet:sl,
      candLen:txt.length, candHasRule:txt.indexOf('_navList')>=0, candTail:txt.slice(-200)}, null, 1);
  })()`);
  console.log(out);
  ws.close();
}
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} process.exit(2); }, 150000);
main().catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(hardStop); await sleep(200); try { child.kill(); } catch {} });
