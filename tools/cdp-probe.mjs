/** 定向探针：打开抽屉 → 点会话 → 看是否真的进了会话（读 URL/标题/头部文本）。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-probe-" + Date.now());
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
const child = spawn(
  EDGE,
  ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
   "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" }
);

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
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("no cdp");
}

const STATE = `(function(){
  var rows=[].slice.call(document.querySelectorAll('[role="treeitem"][class*="_sessionRow"]'));
  var hdr=document.querySelector('[data-slot="conversation.header"]');
  var txt=function(el){return el?String(el.innerText||'').replace(/\\s+/g,' ').slice(0,60):null};
  return JSON.stringify({
    url:location.pathname+location.search,
    rows:rows.length,
    rowTexts:rows.slice(0,3).map(function(r){return txt(r)}),
    header:!!hdr, headerText:txt(hdr),
    bodyHead:String(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,90),
    drawer:!!document.querySelector('[data-dsh-app-drawer]')
  });
})()`;

async function main() {
  const version = await waitJson("http://127.0.0.1:" + PORT + "/json/version");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  await S("Page.enable");
  await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await S("Page.navigate", { url: START_URL });
  for (let i = 0; i < 80; i++) {
    const r = await S("Runtime.evaluate", { expression: "!!document.querySelector('[class*=\"_sidebarCol\"]')", returnByValue: true });
    if (r.result.value === true) break;
    await sleep(250);
  }
  await sleep(1500);
  await S("Runtime.evaluate", {
    expression:
      "(function(){var s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" +
      JSON.stringify(css) + ";})()",
  });
  await S("Runtime.evaluate", { expression: js });
  await sleep(1500);

  const state = async () => JSON.parse((await S("Runtime.evaluate", { expression: STATE, returnByValue: true })).result.value || "{}");
  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const centerOf = async (sel, nth) => {
    const r = await S("Runtime.evaluate", {
      expression:
        "(function(){var els=document.querySelectorAll(" + JSON.stringify(sel) + ");var el=els[" + (nth || 0) + "];if(!el)return null;" +
        "var b=el.getBoundingClientRect();return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2),w:Math.round(b.width),h:Math.round(b.height)})})()",
      returnByValue: true,
    });
    return r.result.value ? JSON.parse(r.result.value) : null;
  };

  const out = {};
  out.start = await state();
  await click(24, 26);
  await sleep(700);
  out.opened = await state();
  const pick = await S("Runtime.evaluate", {
    expression:
      "(function(){var rows=[].slice.call(document.querySelectorAll('[role=\"treeitem\"][class*=\"_sessionRow\"]'));" +
      "for(var i=0;i<rows.length;i++){var t=String(rows[i].innerText||'');" +
      "if(t.indexOf('进行中')>=0){var b=rows[i].getBoundingClientRect();" +
      "return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2),text:t.replace(/\s+/g,' ').slice(0,40)})}}return null})()",
    returnByValue: true,
  });
  out.pickedRow = pick.result.value ? JSON.parse(pick.result.value) : null;
  out.row0 = await centerOf('[role="treeitem"][class*="_sessionRow"]', 0);
  if (out.pickedRow) await click(out.pickedRow.x, out.pickedRow.y);
  await sleep(1200);
  out.afterClick = await state();
  await sleep(2500);
  out.afterWait = await state();

  const r = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "probe-after-session.png"), Buffer.from(r.data, "base64"));
  fs.writeFileSync(path.join(OUT, "probe.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  ws.close();
}

const hardStop = setTimeout(() => {
  try { child.kill("SIGKILL"); } catch {}
  process.exit(2);
}, 120000);
main().catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(hardStop); await sleep(200); try { child.kill(); } catch {} });
