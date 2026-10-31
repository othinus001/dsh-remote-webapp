/**
 * 端到端验证「主题预设」真的能切换/还原外观。
 *
 *   DSH_TEST_URL="https://你的域名/?token=xxx" node tools/cdp-preset2.mjs
 *
 * 步骤：记录当前主题指纹 → 保存到 1 号 → 把皮肤键改坏（模拟「换了别的主题」）
 *       → 刷新页面确认指纹变了 → 点 1 号 → 刷新确认指纹回到原样。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-preset2-" + Date.now());
const OUT = path.join(ROOT, "build");
fs.mkdirSync(OUT, { recursive: true });

const START_URL = (process.env.DSH_TEST_URL || "").trim();
if (!START_URL) {
  console.error("需要 DSH_TEST_URL");
  process.exit(2);
}
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const UA =
  "Mozilla/5.0 (Linux; Android 15; 23117RK66C Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log("[preset2] " + m);

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("CDP not ready");
}

const child = spawn(
  EDGE,
  [
    "--headless=new",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + PROFILE,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ],
  { detached: false, stdio: "ignore" }
);

let ws;
const pending = new Map();
let seq = 0;
function send(method, params = {}, sessionId) {
  const id = ++seq;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout " + method));
      }
    }, 30000);
  });
}

async function main() {
  const v = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable");
  await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const ev = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result.value;
  };
  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(320);
  };
  const inject = () =>
    ev(
      "(() => {" +
        "let s = document.getElementById('dsh-skin-style');" +
        "if (!s) { s = document.createElement('style'); s.id = 'dsh-skin-style'; document.head.appendChild(s); }" +
        "s.textContent = " + JSON.stringify(css) + ";" +
        "let q = document.getElementById('dsh-skin-script');" +
        "if (!q) { q = document.createElement('script'); q.id = 'dsh-skin-script'; document.body.appendChild(q); }" +
        "q.textContent = " + JSON.stringify(js) + ";" +
        "return 1; })()"
    );

  const fingerprint = () =>
    ev(`(() => {
      const r = document.documentElement;
      const attrs = {};
      for (const a of Array.from(r.attributes)) if (a.name.indexOf('data-dsh') === 0 || a.name.indexOf('data-ds') === 0) attrs[a.name] = a.value.slice(0, 60);
      const bg = getComputedStyle(document.body).backgroundColor;
      const skin = localStorage.getItem('dsh-dream-skin:skin');
      const accent = localStorage.getItem('dsh-dream-skin:accent');
      return { attrs, bg, skin, accent };
    })()`);

  log("navigate");
  await S("Page.navigate", { url: START_URL });
  await sleep(5500);
  await inject();
  await sleep(1200);

  const base = await fingerprint();
  log("baseline: " + JSON.stringify(base));

  // 打开抽屉 → 点主题预设 → 保存到 1
  await click(24, 26);
  await sleep(500);
  const btn = await ev(`(() => { const b = document.querySelector('.dsh-preset-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  if (!btn) throw new Error("没有 .dsh-preset-btn");
  await click(btn.x, btn.y);
  await sleep(400);
  const savePos = await ev(`(() => { const b = document.querySelector('.dsh-preset-acts button[data-act="save"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  await click(savePos.x, savePos.y);
  await sleep(300);
  const saved = await ev(`(() => { const raw = localStorage.getItem('dsh-app:theme-presets') || '{}'; const o = JSON.parse(raw); return { slots: Object.keys(o), keys: o['1'] ? Object.keys(o['1']).length : 0, skin: o['1'] ? o['1']['dsh-dream-skin:skin'] : null }; })()`);
  log("saved: " + JSON.stringify(saved));

  // 模拟「主题被改了」：改掉 skin / accent 键
  await ev(`(() => {
    localStorage.setItem('dsh-dream-skin:skin', 'zz-broken-theme');
    localStorage.setItem('dsh-dream-skin:accent', '#ff0000');
    return 1;
  })()`);
  await S("Page.navigate", { url: START_URL });
  await sleep(5500);
  const changed = await fingerprint();
  log("after-mutate: " + JSON.stringify(changed));

  // 应用 1 号预设
  await inject();
  await sleep(1000);
  await click(24, 26);
  await sleep(500);
  const btn2 = await ev(`(() => { const b = document.querySelector('.dsh-preset-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  await click(btn2.x, btn2.y);
  await sleep(400);
  const slotPos = await ev(`(() => { const b = document.querySelector('.dsh-preset-slot[data-slot="1"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), has: b.getAttribute('data-has') }; })()`);
  log("slot1: " + JSON.stringify(slotPos));
  await click(slotPos.x, slotPos.y);
  await sleep(6000); // 页面会 reload
  const restored = await fingerprint();
  log("restored: " + JSON.stringify(restored));

  const sameAsBase = JSON.stringify(restored.attrs) === JSON.stringify(base.attrs) && restored.skin === base.skin && restored.accent === base.accent;
  const differsFromMutated = JSON.stringify(restored.attrs) !== JSON.stringify(changed.attrs);
  log("RESULT same-as-baseline=" + sameAsBase + " differs-from-mutated=" + differsFromMutated);

  fs.writeFileSync(
    path.join(OUT, "preset2.json"),
    JSON.stringify({ base, saved, changed, restored, sameAsBase, differsFromMutated }, null, 1),
    "utf8"
  );
  if (!sameAsBase) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("FAIL " + e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { ws && ws.close(); } catch {}
    try { child.kill(); } catch {}
    await sleep(300);
    process.exit(process.exitCode || 0);
  });
