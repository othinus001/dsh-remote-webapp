/**
 * 探查网页主题/外观是怎么存的（给「主题预设」功能做依据）。
 *
 *   DSH_TEST_URL="https://你的域名/?token=xxx" node tools/cdp-theme.mjs
 *
 * 输出 build/theme.json：
 *   - localStorage 全部键值（截断）
 *   - documentElement 的属性/class
 *   - 一批与配色有关的 CSS 变量
 *   - 设置面板里「通用设置」页的控件清单（文本/类型/选中态）
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-cdp-theme-" + Date.now());
const OUT = path.join(ROOT, "build");
fs.mkdirSync(OUT, { recursive: true });

const START_URL = (process.env.DSH_TEST_URL || "").trim();
if (!START_URL) {
  console.error("需要 DSH_TEST_URL 环境变量（例如 https://域名/?token=xxx）");
  process.exit(2);
}

const css = fs.readFileSync(path.join(ROOT, "assets", "skin.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "skin.js"), "utf8");

const UA =
  "Mozilla/5.0 (Linux; Android 15; 23117RK66C Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log("[theme] " + m);

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
        reject(new Error("timeout: " + method));
      }
    }, 30000);
  });
}

const CONSOLE = [];

async function main() {
  const version = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      CONSOLE.push(
        (msg.params.args || []).map((a) => String(a.value ?? a.description ?? "")).join(" ").slice(0, 300)
      );
    }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    screenWidth: 412,
    screenHeight: 915,
  });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  log("navigate " + START_URL.replace(/token=[^&]+/, "token=***"));
  await S("Page.navigate", { url: START_URL });
  await sleep(6000);

  const evalJs = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result.value;
  };

  // 1) 存储与根元素
  const base = await evalJs(`(() => {
    const out = { href: location.href, keys: [], root: {}, media: {}, vars: {} };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || "";
        out.keys.push([k, v.length > 400 ? v.slice(0, 400) + "…(" + v.length + ")" : v]);
      }
    } catch (e) { out.lsError = String(e); }
    const r = document.documentElement;
    out.root.class = r.className;
    for (const a of Array.from(r.attributes)) out.root[a.name] = a.value.slice(0, 120);
    out.media.dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const cs = getComputedStyle(r);
    for (const n of ["--ds-bg","--ds-color-bg","--ds-fg","--ds-color-fg","--ds-accent","--ds-color-accent","--ds-surface","--ds-color-surface","--ds-border","--ds-color-border","--ds-radius","--ds-font","--ds-theme","color","background-color"]) {
      const v = cs.getPropertyValue(n);
      if (v) out.vars[n] = v.trim().slice(0, 80);
    }
    return out;
  })()`);

  // 2) 打开设置 → 通用设置，dump 控件
  await evalJs(`(() => {
    const b = document.querySelector(".dsh-settings-btn");
    if (b) { const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 })); }
    return true;
  })()`);
  await sleep(1200);

  const settings = await evalJs(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { error: "no dialog" };
    const cells = Array.from(dlg.querySelectorAll('nav [class*="_navCell"]')).map((c) => (c.innerText || "").trim());
    return { cells, text: (dlg.innerText || "").slice(0, 1200) };
  })()`);

  const out = { base, settings, console: CONSOLE.slice(-40) };
  fs.writeFileSync(path.join(OUT, "theme.json"), JSON.stringify(out, null, 1), "utf8");
  log("written build/theme.json");
  console.log(JSON.stringify({ localStorageKeys: (base.keys || []).map((k) => k[0]), rootClass: base.root.class, media: base.media, settingsCells: settings.cells, settingsText: (settings.text || "").slice(0, 600) }, null, 1));
}

main()
  .catch((e) => {
    console.error("FAIL " + e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      ws && ws.close();
    } catch {}
    try {
      child.kill();
    } catch {}
    await sleep(300);
    process.exit(process.exitCode || 0);
  });
