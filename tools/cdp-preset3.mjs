/** 直接调 __dshPreset.apply 看 localStorage 到底被改成什么。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\Windows\Temp", "dsh-cdp-p3-" + Date.now());
const START_URL = (process.env.DSH_TEST_URL || "").trim();
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const UA = "Mozilla/5.0 (Linux; Android 15; 23117RK66C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJson(url, tries = 80) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(250); } throw new Error("no cdp"); }
const child = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let ws; const pending = new Map(); let seq = 0;
function send(method, params = {}, sessionId) { const id = ++seq; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 30000); }); }
async function main() {
  const v = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  const ev = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __error: r.exceptionDetails.text, d: r.exceptionDetails.exception && r.exceptionDetails.exception.description }; return r.result.value; };
  const inject = () => ev("(() => {let s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";let q=document.getElementById('dsh-skin-script');if(!q){q=document.createElement('script');q.id='dsh-skin-script';document.body.appendChild(q);}q.textContent=" + JSON.stringify(js) + ";return 1;})()");
  await S("Page.navigate", { url: START_URL }); await sleep(5500); await inject(); await sleep(800);
  console.log("skin now:", await ev("localStorage.getItem('dsh-dream-skin:skin')"));
  console.log("snapshot keys:", await ev("Object.keys(window.__dshPreset.snapshot()).length"));
  const snap = await ev("JSON.stringify(window.__dshPreset.snapshot())");
  await ev("localStorage.setItem('dsh-dream-skin:skin','zz-broken-theme')");
  console.log("after mutate:", await ev("localStorage.getItem('dsh-dream-skin:skin')"));
  const r = await ev("(() => { try { window.__dshPreset.apply(" + snap + "); return 'ok'; } catch (e) { return 'ERR ' + e.message; } })()");
  console.log("apply ->", r);
  console.log("after apply:", await ev("localStorage.getItem('dsh-dream-skin:skin')"));
  await S("Page.navigate", { url: START_URL }); await sleep(5500);
  console.log("after reload:", await ev("localStorage.getItem('dsh-dream-skin:skin')"), "| attr:", await ev("document.documentElement.getAttribute('data-dsh-dream-skin-scheme')"));
}
main().catch((e) => { console.error("FAIL " + e.message); process.exitCode = 1; }).finally(async () => { try { ws && ws.close(); } catch {} try { child.kill(); } catch {} await sleep(300); process.exit(process.exitCode || 0); });
