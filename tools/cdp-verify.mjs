/**
 * 用 headless Edge + CDP 验证皮肤（不依赖 ego-browser）。
 *
 *   node tools/cdp-verify.mjs
 *
 * 流程：起 headless Edge（独立 profile/随机端口）→ 手机 UA + 412x915 + 触摸 →
 * 打开线上页面（走 303 换 cookie）→ 注入 assets/skin.css + skin.js（等价 APK 的
 * withSkin）→ 依次量：关闭态 / 点左上角入口 / 点会话 / 设置面板，
 * 每步截图到 build/shot-v2-*.png，汇总到 build/verify.json。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-" + Date.now());
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
const log = (m) => console.log("[cdp] " + m);

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("CDP endpoint not ready: " + url);
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

let seq = 0;
const pending = new Map();

function send(ws, method, params = {}, sessionId) {
  const id = ++seq;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const FRAME_SEL =
  '[data-slot="root"] > [class*="_frame"]';

const MEASURE = `(function(){
  var q=function(s,r){return (r||document).querySelector(s)};
  var fr=q('${FRAME_SEL}')||q('[class*="_frame"]:has(> [class*="_sidebarCol"])');
  var side=fr&&fr.querySelector(':scope > [class*="_sidebarCol"]');
  var center=fr&&fr.querySelector(':scope > [class*="_centerCol"]');
  var handle=fr&&fr.querySelector(':scope > [class*="_handle"]');
  var box=function(el){if(!el)return null;var r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  var hdr=q('[data-slot="conversation.header"]');
  var lead=hdr&&hdr.querySelector('[class*="_headerLeading"]');
  var entry=fr?getComputedStyle(fr,'::before'):null;
  var area=q('[class*="_settingsArea"]');
  var btn=area&&area.querySelector('.dsh-settings-btn');
  var rows=document.querySelectorAll('[role="treeitem"][class*="_sessionRow"]');
  var dlg=q('[role="dialog"]');
  var nav=dlg&&dlg.querySelector(':scope > nav');
  var content=dlg&&dlg.querySelector(':scope > [class*="_content"]');
  return JSON.stringify({
    layout:document.documentElement.getAttribute('data-dsh-app-layout'),
    drawer:!!(fr&&fr.hasAttribute('data-dsh-app-drawer')),
    collapsed:!!(fr&&fr.hasAttribute('data-sidebar-collapsed')),
    side:box(side), sideTransform:side?getComputedStyle(side).transform:null,
    center:box(center),
    centerCol:center?getComputedStyle(center).gridColumnStart+'/'+getComputedStyle(center).gridColumnEnd:null,
    handle:handle?getComputedStyle(handle).display:null,
    header:box(hdr), lead:lead?getComputedStyle(lead).paddingLeft:null,
    entryOpacity:entry?entry.opacity:null,
    entryMask:entry?String(entry.maskImage||entry.webkitMaskImage||'').slice(0,24):null,
    settingsArea:box(area), settingsBtn:box(btn),
    rows:rows.length, row0:box(rows[0]),
    dialog:box(dlg), dlgClass:dlg?String(dlg.className).slice(0,30):null,
    nav:box(nav), navDir:nav?getComputedStyle(nav).flexDirection:null,
    navCells:dlg?dlg.querySelectorAll('[class*="_navCell"]').length:0,
    content:box(content), menu:box(q('[role="menu"]')),
    vw:innerWidth, vh:innerHeight
  });
})()`;

async function main() {
  log("port " + PORT);
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
  log("endpoint ready");

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", {
    userAgent: UA,
    acceptLanguage: "zh-CN,zh;q=0.9",
    platform: "Linux armv81",
  });
  await S("Emulation.setDeviceMetricsOverride", {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    screenWidth: 412,
    screenHeight: 915,
  });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  log("navigate");
  await S("Page.navigate", { url: START_URL });
  for (let i = 0; i < 80; i++) {
    const r = await S("Runtime.evaluate", {
      expression: "!!document.querySelector('[class*=\"_sidebarCol\"]')",
      returnByValue: true,
    });
    if (r.result.value === true) break;
    await sleep(250);
  }
  log("frame ready");
  await sleep(1200);

  await S("Runtime.evaluate", {
    expression:
      "(function(){var s=document.getElementById('dsh-skin-style');" +
      "if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}" +
      "s.textContent=" + JSON.stringify(css) + ";})()",
  });
  await S("Runtime.evaluate", { expression: js });
  log("skin injected");
  await sleep(1600);

  const measure = async () => {
    const r = await S("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
    return JSON.parse(r.result.value || "{}");
  };
  const shot = async (name) => {
    const r = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, "shot-" + name + ".png"), Buffer.from(r.data, "base64"));
  };
  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const centerOf = async (selector) => {
    const r = await S("Runtime.evaluate", {
      expression:
        "(function(){var el=document.querySelector(" + JSON.stringify(selector) + ");if(!el)return null;" +
        "var b=el.getBoundingClientRect();return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)})})()",
      returnByValue: true,
    });
    return r.result.value ? JSON.parse(r.result.value) : null;
  };

  const report = {};
  report.closed = await measure();
  await shot("v2-closed");

  // 1) 点左上角入口 → 抽屉打开
  await click(24, 26);
  await sleep(700);
  report.openedByEntry = await measure();
  await shot("v2-open");

  // 2) 点抽屉里的会话 → 抽屉收起，会话头部出现
  const row = await centerOf('[role="treeitem"][class*="_sessionRow"]');
  if (row) await click(row.x, row.y);
  await sleep(1100);
  report.afterRowClick = await measure();
  await shot("v2-session");

  // 3) 打开抽屉 → 点设置 → 设置面板
  await click(24, 26);
  await sleep(700);
  const gear = await centerOf(".dsh-settings-btn");
  if (gear) await click(gear.x, gear.y);
  await sleep(1800);
  report.settings = await measure();
  await shot("v2-settings");

  fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  ws.close();
}

const hardStop = setTimeout(() => {
  console.error("HARD TIMEOUT 150s");
  try {
    child.kill("SIGKILL");
  } catch {}
  process.exit(2);
}, 150000);

main()
  .catch((e) => {
    console.error("FAIL", e && e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(hardStop);
    await sleep(200);
    try {
      child.kill();
    } catch {}
  });
