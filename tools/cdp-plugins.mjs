/**
 * 插件页开关 / 详情 命中测试。SKIN=0 时不注入皮肤（基线对照）。
 *
 *   SKIN=1 DSH_TEST_URL="https://你的域名/?token=xxx" node tools/cdp-plugins.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-plug-" + Date.now());
const SKIN = process.env.SKIN !== "0";
const START_URL = (process.env.DSH_TEST_URL || "").trim();
if (!START_URL) {
  console.error("需要 DSH_TEST_URL");
  process.exit(2);
}
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const UA =
  "Mozilla/5.0 (Linux; Android 15; 23117RK66B Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log((SKIN ? "[skin] " : "[base] ") + m);

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
  ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"],
  { stdio: "ignore" }
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
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
  const mouse = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(500);
  };
  const touch = async (x, y) => {
    await S("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await S("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
  };

  log("navigate " + (SKIN ? "with skin" : "baseline"));
  await S("Page.navigate", { url: START_URL });
  await sleep(5500);
  if (SKIN) {
    await ev(
      "(() => {let s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" +
        JSON.stringify(css) +
        ";let q=document.getElementById('dsh-skin-script');if(!q){q=document.createElement('script');q.id='dsh-skin-script';document.body.appendChild(q);}q.textContent=" +
        JSON.stringify(js) +
        ";return 1;})()"
    );
    await sleep(1500);
    await mouse(24, 26); // 开抽屉
    await sleep(500);
    const s = await ev(`(() => { const b = document.querySelector('.dsh-settings-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    log("click settings at " + JSON.stringify(s));
    if (s) await mouse(s.x, s.y);
    await sleep(900);
  } else {
    // 基线：走账号菜单 → 设置
    const acc = await ev(`(() => { const b = document.querySelector('[class*="_settingsArea"] button[aria-label]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    log("click account at " + JSON.stringify(acc));
    if (acc) await mouse(acc.x, acc.y);
    await sleep(600);
    const mi = await ev(`(() => { const b = Array.from(document.querySelectorAll('[role="menuitem"]')).find(x => (x.innerText||'').indexOf('设置') >= 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    log("click menu item at " + JSON.stringify(mi));
    if (mi) await mouse(mi.x, mi.y);
    await sleep(900);
  }

  // 进插件页
  const tab = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { error: 'no dialog' };
    const cell = Array.from(dlg.querySelectorAll('[class*="_navCell"]')).find(c => (c.innerText||'').indexOf('插件') >= 0);
    if (!cell) return { error: 'no plugin tab' };
    cell.scrollIntoView({ inline: 'center', block: 'nearest' });
    const list = cell.closest('[class*="_navList"]');
    if (list) list.scrollLeft = Math.max(0, cell.offsetLeft - 12);
    const r = cell.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), listScroll: list ? list.scrollLeft : null };
  })()`);
  log("plugin tab: " + JSON.stringify(tab));
  if (tab && !tab.error) {
    await sleep(400);
    await mouse(tab.x, tab.y);
    await sleep(1200);
  }

  const state = () =>
    ev(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { error: 'dialog gone' };
      const rows = Array.from(dlg.querySelectorAll('button[class*="_switcher"], [class*="_switcher"]')).map(el => ({
        cls: (el.className || '').toString(),
        aria: el.getAttribute('aria-checked') || el.getAttribute('aria-pressed') || null,
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 20)
      }));
      return { switchers: rows.slice(0, 4), head: (dlg.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) };
    })()`);

  const before = await state();
  log("before: " + JSON.stringify(before).slice(0, 700));

  const sw = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = dlg && dlg.querySelector('button[class*="_switcher"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height), top: top ? (top.className || '').toString().slice(0, 40) : null };
  })()`);
  log("switch: " + JSON.stringify(sw));

  if (sw) {
    await mouse(sw.x, sw.y);
    log("after mouse: " + JSON.stringify(await state()).slice(0, 700));
    await touch(sw.x, sw.y);
    log("after touch: " + JSON.stringify(await state()).slice(0, 700));
    await ev(`(() => { const dlg = document.querySelector('[role="dialog"]'); const el = dlg && dlg.querySelector('button[class*="_switcher"]'); if (el) el.click(); return 1; })()`);
    await sleep(800);
    log("after js click: " + JSON.stringify(await state()).slice(0, 700));
  }

  // 点插件条目（列表里的卡片）看详情
  const item = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const cands = Array.from(dlg.querySelectorAll('[class*="_row"], [class*="_card"], [class*="_item"], [class*="_pluginRow"]'))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 150 && r.height > 30 && r.y > 90; });
    const el = cands[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + Math.min(60, r.width / 2)), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return { cls: (el.className || '').toString().slice(0, 40), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30), x: cx, y: cy, top: top ? (top.className || '').toString().slice(0, 40) : null };
  })()`);
  log("row: " + JSON.stringify(item));
  if (item) {
    await mouse(item.x, item.y);
    await sleep(900);
    const after = await ev(`(() => { const dlg = document.querySelector('[role="dialog"]'); return { head: dlg ? (dlg.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) : null }; })()`);
    log("after row click: " + JSON.stringify(after).slice(0, 600));
  }

  try {
    const shot = await S("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "build", SKIN ? "plug-skin.png" : "plug-base.png"), Buffer.from(shot.data, "base64"));
    log("shot saved");
  } catch (e) {
    log("shot failed " + e.message);
  }
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
