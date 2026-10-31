/**
 * dump 插件页结构（开关到底是什么元素）。
 *   DSH_TEST_URL="..." node tools/cdp-dump-plugins.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-dp-" + Date.now());
const START_URL = (process.env.DSH_TEST_URL || "").trim();
const SKIN = process.env.SKIN !== "0";
if (!START_URL) { console.error("需要 DSH_TEST_URL"); process.exit(2); }
const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");
const UA = "Mozilla/5.0 (Linux; Android 15; 23117RK66C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log("[dp] " + m);

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
  const mouse = async (x, y) => { await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(500); };

  await S("Page.navigate", { url: START_URL });
  await sleep(5500);
  if (SKIN) {
    await ev("(() => {let s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";let q=document.getElementById('dsh-skin-script');if(!q){q=document.createElement('script');q.id='dsh-skin-script';document.body.appendChild(q);}q.textContent=" + JSON.stringify(js) + ";return 1;})()");
    await sleep(1500);
    await mouse(24, 26); await sleep(500);
    const s = await ev(`(() => { const b = document.querySelector('.dsh-settings-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    if (s) await mouse(s.x, s.y);
    await sleep(900);
  } else {
    const acc = await ev(`(() => { const b = document.querySelector('[class*="_settingsArea"] button[aria-label]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    if (acc) await mouse(acc.x, acc.y);
    await sleep(600);
    const mi = await ev(`(() => { const b = Array.from(document.querySelectorAll('[role="menuitem"]')).find(x => (x.innerText||'').indexOf('设置') >= 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    if (mi) await mouse(mi.x, mi.y);
    await sleep(900);
  }

  const tab = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { error: 'no dialog' };
    const cell = Array.from(dlg.querySelectorAll('[class*="_navCell"]')).find(c => (c.innerText||'').indexOf('插件') >= 0);
    if (!cell) return { error: 'no tab' };
    const list = cell.closest('[class*="_navList"]');
    if (list) list.scrollLeft = Math.max(0, cell.offsetLeft - 12);
    const r = cell.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  log("tab " + JSON.stringify(tab));
  await sleep(400);
  if (tab && !tab.error) { await mouse(tab.x, tab.y); await sleep(1200); }

  const card = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = dlg && dlg.querySelector('button[class*="_cardContent"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return { aria: el.getAttribute('aria-label'), x: cx, y: cy, w: Math.round(r.width), topCls: top ? (top.className || '').toString().slice(0, 30) : null, topIsCard: !!top && (top === el || el.contains(top)) };
  })()`);
  log("card " + JSON.stringify(card));
  if (card) {
    await mouse(card.x, card.y);
    await sleep(1000);
    const after = await ev(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const panels = Array.from(document.querySelectorAll('[role="dialog"]')).map(d => ({ cls: (d.className||'').toString().slice(0,30), text: (d.innerText||'').replace(/\s+/g,' ').slice(0, 140) }));
      return { count: panels.length, panels, head: dlg ? (dlg.innerText||'').replace(/\s+/g,' ').slice(0, 220) : null };
    })()`);
    log("afterCard " + JSON.stringify(after).slice(0, 1600));
    const detail = await ev(`(() => {
      const all = Array.from(document.querySelectorAll('[role="dialog"] *'));
      const holder = all.find(el => (el.innerText||'').indexOf('配置状态') >= 0 && el.children.length > 1 && el.getBoundingClientRect().width < 420 && el.getBoundingClientRect().height < 900);
      const scope = holder || document.querySelector('[role="dialog"]');
      const switches = Array.from(scope.querySelectorAll('[role="switch"], input[type="checkbox"], [class*="_switch"], [class*="_toggle"], [class*="_switcher"]')).map(el => {
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width/2), cy = Math.round(r.y + r.height/2);
        const top = document.elementFromPoint(cx, cy);
        return { tag: el.tagName, cls: (el.className||'').toString().slice(0,34), aria: el.getAttribute('aria-label'), chk: el.getAttribute('aria-checked') || el.checked, x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height), topIsSelf: !!top && (top === el || el.contains(top)), topCls: top ? (top.className||'').toString().slice(0,30) : null };
      });
      const btns = Array.from(scope.querySelectorAll('button')).map(b => { const r = b.getBoundingClientRect(); return { cls: (b.className||'').toString().slice(0,26), aria: b.getAttribute('aria-label'), text: (b.innerText||'').replace(/\s+/g,' ').trim().slice(0,16), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(o => o.w > 0);
      return { holderCls: holder ? (holder.className||'').toString().slice(0,40) : null, switches, btns: btns.slice(0, 12) };
    })()`);
    log("detail " + JSON.stringify(detail).slice(0, 2200));
    const sw = detail && detail.switches && detail.switches.find(o => o.topIsSelf && o.w > 10);
    if (sw) {
      log("click switch " + sw.cls + " chk=" + sw.chk);
      await mouse(sw.x, sw.y);
      await sleep(1000);
      const post = await ev(`(() => { const d = document.querySelector('[role="dialog"]'); return { text: d ? (d.innerText||'').replace(/\s+/g,' ').slice(0, 260) : null }; })()`);
      log("afterSwitch " + JSON.stringify(post).slice(0, 800));
    }
}

main().catch((e) => { console.error("FAIL " + e.message); process.exitCode = 1; }).finally(async () => { try { ws && ws.close(); } catch {} try { child.kill(); } catch {} await sleep(300); process.exit(process.exitCode || 0); });
