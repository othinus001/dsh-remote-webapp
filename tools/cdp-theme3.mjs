/**
 * 找「内置主题（亮/暗/跟随系统）」存在哪个 settings 命名空间里。
 *
 *   DSH_TEST_URL="https://你的域名/?token=xxx" node tools/cdp-theme3.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-theme3-" + Date.now());
fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });

const START_URL = (process.env.DSH_TEST_URL || "").trim();
if (!START_URL) {
  console.error("需要 DSH_TEST_URL");
  process.exit(2);
}
const UA =
  "Mozilla/5.0 (Linux; Android 15; 23117RK66C Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await S("Page.navigate", { url: START_URL });
  await sleep(7000);

  const ev = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.text };
    return r.result.value;
  };

  const out = await ev(`(() => {
    const ctx = window.__dshClientCtx && window.__dshClientCtx.fiber && window.__dshClientCtx.fiber.ctx;
    if (!ctx) return { error: "no ctx" };
    const cf = ctx.get("configForms");
    if (!cf) return { error: "no configForms" };
    const mirror = cf.mirror && cf.mirror.getSnapshot ? cf.mirror.getSnapshot() : null;
    const view = mirror && mirror.view;
    const names = view && view.namespaces ? view.namespaces.map(n => n.ns) : [];
    const hits = [];
    for (const n of (view && view.namespaces) || []) {
      const s = JSON.stringify(n);
      if (/theme|appearance|skin|color|scheme/i.test(s)) hits.push({ ns: n.ns, fields: (n.fields || []).map(f => f.path || f.key || f.name) });
    }
    return { status: mirror && mirror.status, count: names.length, names, hits };
  })()`);
  console.log(JSON.stringify(out, null, 1).slice(0, 3000));
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
