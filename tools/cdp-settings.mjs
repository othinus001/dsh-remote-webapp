/**
 * 复现「设置按钮打开的是主题预设弹窗」和「插件页开关点不动」。
 *
 *   DSH_TEST_URL="https://你的域名/?token=xxx" node tools/cdp-settings.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-set-" + Date.now());
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
const log = (m) => console.log("[set] " + m);

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
    await sleep(450);
  };

  log("navigate");
  await S("Page.navigate", { url: START_URL });
  await sleep(5500);
  await ev(
    "(() => {let s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" +
      JSON.stringify(css) +
      ";let q=document.getElementById('dsh-skin-script');if(!q){q=document.createElement('script');q.id='dsh-skin-script';document.body.appendChild(q);}q.textContent=" +
      JSON.stringify(js) +
      ";return 1;})()"
  );
  await sleep(1500);

  // 开抽屉
  await click(24, 26);
  await sleep(500);

  const geo = await ev(`(() => {
    const p = document.querySelector('.dsh-preset-btn');
    const s = document.querySelector('.dsh-settings-btn');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { preset: r(p), settings: r(s), order: Array.from(document.querySelector('[class*="_settingsArea"]').children).map(c => c.className.slice(0,40)) };
  })()`);
  log("geo: " + JSON.stringify(geo));

  // 点「设置」按钮（不是预设按钮）
  const s = geo.settings;
  await click(Math.round(s.x + s.w / 2), Math.round(s.y + s.h / 2));
  await sleep(900);

  const afterSettings = await ev(`(() => {
    const pop = document.querySelector('.dsh-preset-pop');
    const dlg = document.querySelector('[role="dialog"]');
    const menu = document.querySelector('[role="menu"]');
    return {
      presetPop: !!pop,
      dialog: dlg ? { text: (dlg.innerText||'').replace(/\\s+/g,' ').trim().slice(0, 80), rect: (() => { const b = dlg.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })() } : null,
      menu: menu ? (menu.innerText||'').replace(/\\s+/g,' ').slice(0, 60) : null
    };
  })()`);
  log("afterSettingsClick: " + JSON.stringify(afterSettings));

  // 如果设置面板开了，点「内置插件」
  const tabs = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    return Array.from(dlg.querySelectorAll('nav [class*="_navCell"]')).map(c => { const b = c.getBoundingClientRect(); return { t: (c.innerText||'').trim(), x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2) }; });
  })()`);
  log("tabs: " + JSON.stringify(tabs));

  if (tabs && tabs.length) {
    // tab 条是横向滚动的，先把目标 tab 滚进可视区再点
    const target = tabs.find((t) => t.t.indexOf("插件") >= 0) || tabs[tabs.length - 1];
    await ev(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const list = dlg.querySelector('nav [class*="_navList"]') || dlg.querySelector('nav');
      const cell = Array.from(dlg.querySelectorAll('nav [class*="_navCell"]')).find(c => (c.innerText||'').indexOf('${target.t}') >= 0);
      if (list && cell) list.scrollLeft = Math.max(0, cell.offsetLeft - 12);
      return list ? list.scrollLeft : -1;
    })()`);
    await sleep(400);
    const again = await ev(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const cell = Array.from(dlg.querySelectorAll('nav [class*="_navCell"]')).find(c => (c.innerText||'').indexOf('${target.t}') >= 0);
      if (!cell) return null;
      const b = cell.getBoundingClientRect();
      return { x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2), w: Math.round(b.width) };
    })()`);
    log("click tab: " + target.t + " at " + JSON.stringify(again));
    if (again) await click(again.x, again.y);
    await sleep(1000);

    const rows = await ev(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { error: 'dialog gone' };
      const all = Array.from(dlg.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.cursor === 'pointer' && el.getBoundingClientRect().width > 20;
      }).slice(0, 12).map(el => {
        const b = el.getBoundingClientRect();
        const cx = Math.round(b.x + b.width/2), cy = Math.round(b.y + b.height/2);
        const top = document.elementFromPoint(cx, cy);
        return { tag: el.tagName, cls: (el.className||'').toString().slice(0,36), text: (el.innerText||'').replace(/\s+/g,' ').trim().slice(0,30),
                 x: cx, y: cy, w: Math.round(b.width), topIsSelf: !!top && (top === el || el.contains(top)) };
      });
      const sw = Array.from(dlg.querySelectorAll('[role="switch"], input[type=checkbox], [class*="_switch"], [class*="_toggle"], [class*="_knob"]')).map(el => {
        const b = el.getBoundingClientRect();
        const cx = Math.round(b.x + b.width/2), cy = Math.round(b.y + b.height/2);
        const top = document.elementFromPoint(cx, cy);
        return { tag: el.tagName, cls: (el.className||'').toString().slice(0,36), checked: el.getAttribute('aria-checked') || el.checked,
                 x: cx, y: cy, w: Math.round(b.width), h: Math.round(b.height), topIsSelf: !!top && (top === el || el.contains(top)),
                 topCls: top ? (top.className||'').toString().slice(0,36) : null };
      });
      return { switches: sw, clickable: all, text: (dlg.innerText||'').replace(/\s+/g,' ').slice(0, 300) };
    })()`);
    log("pluginPage: " + JSON.stringify(rows).slice(0, 2000));

    const sw = rows && rows.switches && rows.switches.find(o => o.topIsSelf);
    if (sw) {
      log("click switch " + sw.cls + " checked=" + sw.checked);
      await click(sw.x, sw.y);
      await sleep(900);
      const after = await ev(`(() => {
        const el = document.querySelector('[role="switch"], [class*="_switch"]');
        return { checked: el ? (el.getAttribute('aria-checked') || el.checked) : null };
      })()`);
      log("afterToggle: " + JSON.stringify(after));
    } else if (rows && rows.switches) {
      log("no switch is topmost; switches=" + JSON.stringify(rows.switches).slice(0, 400));
    }

    const item = rows && rows.clickable && rows.clickable.find(o => o.topIsSelf && o.w > 120 && o.y > 80);
    if (item) {
      log("click item " + item.text);
      await click(item.x, item.y);
      await sleep(1000);
      const det = await ev(`(() => { const dlg = document.querySelector('[role="dialog"]'); return { text: dlg ? (dlg.innerText||'').replace(/\s+/g,' ').slice(0, 220) : null }; })()`);
      log("afterItemClick: " + JSON.stringify(det).slice(0, 600));
    }
  }

  try {
    const shot = await S("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "shot-settings.png"), Buffer.from(shot.data, "base64"));
    log("shot build/shot-settings.png");
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
