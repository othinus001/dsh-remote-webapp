/**
 * 验证「主题预设」按钮与小弹窗（412x915，headless Edge）。
 *
 *   DSH_TEST_URL="https://你的域名/?token=xxx" node tools/cdp-preset.mjs
 *
 * 做：打开抽屉 → 点主题预设 → 量弹窗 → 点「保存」→ 量 1 号变已保存 →
 *     点「删除」→ 量回到空。不改主题本身（不点有内容的槽位，避免刷新）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-preset-" + Date.now());
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
const log = (m) => console.log("[preset] " + m);

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
    "--hide-scrollbars",
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
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
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

  log("navigate");
  await S("Page.navigate", { url: START_URL });
  await sleep(5000);

  // 注入皮肤（等价 APK 的 Web.withSkin）
  await ev(
    "(() => {" +
      "let s = document.getElementById('dsh-skin-style');" +
      "if (!s) { s = document.createElement('style'); s.id = 'dsh-skin-style'; document.head.appendChild(s); }" +
      "s.textContent = " + JSON.stringify(css) + ";" +
      "let q = document.getElementById('dsh-skin-script');" +
      "if (!q) { q = document.createElement('script'); q.id = 'dsh-skin-script'; document.body.appendChild(q); }" +
      "q.textContent = " + JSON.stringify(js) + ";" +
      "return 1; })()"
  );
  await sleep(1600);

  // 打开抽屉（左上角命中区）
  await click(24, 26);
  await sleep(600);

  const btn = await ev(`(() => {
    const b = document.querySelector('.dsh-preset-btn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const s = document.querySelector('.dsh-settings-btn');
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: (b.innerText||'').trim(),
             aboveSettings: !!(s && b.nextElementSibling === s) };
  })()`);
  log("button: " + JSON.stringify(btn));
  if (!btn) throw new Error("没找到 .dsh-preset-btn");

  await click(Math.round(btn.x + btn.w / 2), Math.round(btn.y + btn.h / 2));
  await sleep(400);

  const pop1 = await ev(`(() => {
    const p = document.querySelector('.dsh-preset-pop');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const slots = Array.from(p.querySelectorAll('.dsh-preset-slot')).map(b => ({
      n: b.getAttribute('data-slot'), has: b.getAttribute('data-has'), sel: b.getAttribute('data-sel'),
      text: (b.innerText||'').trim()
    }));
    const acts = Array.from(p.querySelectorAll('.dsh-preset-acts button')).map(b => (b.innerText||'').trim());
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, slots, acts,
             inViewport: r.top >= 0 && r.bottom <= window.innerHeight };
  })()`);
  log("popover: " + JSON.stringify(pop1));

  // 点「保存」
  const savePos = await ev(`(() => {
    const b = document.querySelector('.dsh-preset-acts button[data-act="save"]');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  if (savePos) await click(savePos.x, savePos.y);
  await sleep(400);
  const afterSave = await ev(`(() => {
    const p = document.querySelector('.dsh-preset-pop');
    const slots = Array.from(p.querySelectorAll('.dsh-preset-slot')).map(b => b.getAttribute('data-slot') + ':' + b.getAttribute('data-has') + ':' + (b.innerText||'').replace(/\\s+/g,' ').trim());
    const raw = localStorage.getItem('dsh-app:theme-presets') || '';
    return { slots, savedKeys: raw ? Object.keys(JSON.parse(raw)['1'] || {}).length : 0, rawLen: raw.length };
  })()`);
  log("afterSave: " + JSON.stringify(afterSave));

  // 点「删除」
  const delPos = await ev(`(() => {
    const b = document.querySelector('.dsh-preset-acts button[data-act="del"]');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  if (delPos) await click(delPos.x, delPos.y);
  await sleep(400);
  const afterDel = await ev(`(() => {
    const p = document.querySelector('.dsh-preset-pop');
    const slots = Array.from(p.querySelectorAll('.dsh-preset-slot')).map(b => b.getAttribute('data-slot') + ':' + b.getAttribute('data-has'));
    return { slots, raw: localStorage.getItem('dsh-app:theme-presets') };
  })()`);
  log("afterDel: " + JSON.stringify(afterDel));

  // 截图
  try {
    const shot = await S("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "shot-preset.png"), Buffer.from(shot.data, "base64"));
    log("shot build/shot-preset.png");
  } catch (e) {
    log("screenshot failed: " + e.message);
  }

  fs.writeFileSync(
    path.join(OUT, "preset.json"),
    JSON.stringify({ btn, pop1, afterSave, afterDel }, null, 1),
    "utf8"
  );
  log("written build/preset.json");
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
