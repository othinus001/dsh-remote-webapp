/**
 * 验证「刷新」= 清空网页端主题键 + 重新加载，且保存的预设不受影响。
 *   DSH_TEST_URL="..." node tools/cdp-refresh.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-rf-" + Date.now());
const START_URL = (process.env.DSH_TEST_URL || "").trim();
if (!START_URL) { console.error("需要 DSH_TEST_URL"); process.exit(2); }
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const UA = "Mozilla/5.0 (Linux; Android 15; 23117RK66C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log("[rf] " + m);

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(250); }
  throw new Error("CDP not ready");
}

const child = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let ws; const pending = new Map(); let seq = 0;
function send(method, params = {}, sessionId) {
  const id = ++seq; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 30000); });
}

async function main() {
  const v = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const ev = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __error: r.exceptionDetails.text }; return r.result.value; };
  const mouse = async (x, y) => { await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(600); };
  const inject = () => ev("(() => {let s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";let q=document.getElementById('dsh-skin-script');if(!q){q=document.createElement('script');q.id='dsh-skin-script';document.body.appendChild(q);}q.textContent=" + JSON.stringify(js) + ";return 1;})()");

  await S("Page.navigate", { url: START_URL });
  await sleep(5500);
  await inject();
  await sleep(1200);

  // 造数据：假主题键 + 一个保存好的预设
  const seeded = await ev(`(() => {
    localStorage.setItem('dsh-dream-skin:skin', 'zz-fake-theme');
    localStorage.setItem('dsh-dream-skin:accent', '#ff0000');
    localStorage.setItem('dsh-dream-skin:builtin-last', 'dark');
    localStorage.setItem('dsh-app:theme-presets', JSON.stringify({ 1: { 'dsh-dream-skin:skin': 'nebula', 'dsh-dream-skin:accent': '#4f83f2' } }));
    localStorage.setItem('dsh-app:theme-preset-sel', '1');
    const theme = [], other = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); (k.indexOf('dsh-dream-skin:') === 0 ? theme : other).push(k); }
    return { theme: theme.length, other };
  })()`);
  log("seeded " + JSON.stringify(seeded));

  // 打开抽屉 → 主题预设 → 点「刷新」
  await mouse(24, 26);
  await sleep(400);
  const pbtn = await ev(`(() => { const b = document.querySelector('.dsh-preset-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  log("preset btn " + JSON.stringify(pbtn));
  if (pbtn) await mouse(pbtn.x, pbtn.y);
  await sleep(600);
  const rb = await ev(`(() => { const b = document.querySelector('.dsh-preset-pop [data-act="reload"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: b.innerText }; })()`);
  log("reload btn " + JSON.stringify(rb));
  if (rb) await mouse(rb.x, rb.y);
  await sleep(5000); // 等重新加载
  await inject();
  await sleep(1200);

  const after = await ev(`(() => {
    const theme = [], other = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); (k.indexOf('dsh-dream-skin:') === 0 ? theme : other).push(k); }
    let presets = null;
    try { presets = JSON.parse(localStorage.getItem('dsh-app:theme-presets') || 'null'); } catch (e) {}
    return { themeKeys: theme, other, presetsKept: !!(presets && presets['1']), presetSkin: presets && presets['1'] ? presets['1']['dsh-dream-skin:skin'] : null, url: location.href.slice(0, 40) };
  })()`);
  log("after " + JSON.stringify(after));
}

main().catch((e) => { console.error("FAIL " + e.message); process.exitCode = 1; }).finally(async () => { try { ws && ws.close(); } catch {} try { child.kill(); } catch {} await sleep(300); process.exit(process.exitCode || 0); });
