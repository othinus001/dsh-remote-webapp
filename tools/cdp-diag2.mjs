/** 量 2.0 皮肤的头部第二行排布 + 设置面板滚动容器，供修 CSS 用。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9300 + Math.floor(Math.random() * 600);
const PROFILE = path.join(process.env.TEMP || "C:\\Windows\\Temp", "dsh-diag2-" + Date.now());
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
const child = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let seq = 0;
const pending = new Map();
function send(ws, method, params = {}, sessionId) {
  const id = ++seq;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function waitJson(url) {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(250); }
  throw new Error("no cdp");
}

const HEADER_DUMP = `(function(){
  var hdr=document.querySelector('[data-slot="conversation.header"]');
  if(!hdr) return JSON.stringify({err:'no header'});
  var rows=[];
  var walk=function(el,depth){
    if(depth>6||!el) return;
    var b=el.getBoundingClientRect(), cs=getComputedStyle(el);
    rows.push({d:depth,tag:el.tagName.toLowerCase(),cls:String(el.className||'').slice(0,30),
      x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),
      pos:cs.position,right:cs.right,bottom:cs.bottom,disp:cs.display,ord:cs.order,
      aria:el.getAttribute&&el.getAttribute('aria-label'),
      txt:String(el.innerText||'').replace(/\\s+/g,' ').slice(0,20)});
    for(var i=0;i<el.children.length;i++) walk(el.children[i],depth+1);
  };
  walk(hdr,0);
  var kids=function(sel){
    var p=hdr.querySelector(sel);
    if(!p) return null;
    var pb=p.getBoundingClientRect();
    return {box:{x:Math.round(pb.x),y:Math.round(pb.y),w:Math.round(pb.width),h:Math.round(pb.height)},
      disp:getComputedStyle(p).display,
      kids:[].slice.call(p.children).map(function(c){var b=c.getBoundingClientRect();
        return {cls:String(c.className||'').slice(0,24),aria:c.getAttribute('aria-label'),x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}})};
  };
  return JSON.stringify({rows:rows,actions:kids('[class*="_headerActions"]'),utils:kids('[class*="_headerUtilities"]'),corner:kids('[class*="_headerCorner"]'),tabs:kids('[class*="_tabs"]')});
})()`;

const PANEL_DUMP = `(function(){
  var dlg=document.querySelector('[role="dialog"]');
  if(!dlg) return JSON.stringify({err:'no dialog'});
  var rows=[];
  var walk=function(el,depth){
    if(depth>6||!el) return;
    var b=el.getBoundingClientRect(), cs=getComputedStyle(el);
    rows.push({d:depth,tag:el.tagName.toLowerCase(),cls:String(el.className||'').slice(0,30),
      x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),
      ovf:cs.overflow,ovfY:cs.overflowY,pos:cs.position,disp:cs.display,flex:cs.flex,minH:cs.minHeight,
      sh:el.scrollHeight,ch:el.clientHeight,
      txt:String(el.innerText||'').replace(/\\s+/g,' ').slice(0,18)});
    for(var i=0;i<el.children.length;i++) walk(el.children[i],depth+1);
  };
  walk(dlg,0);
  return JSON.stringify({rows:rows});
})()`;

async function main() {
  const version = await waitJson("http://127.0.0.1:" + PORT + "/json/version");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Emulation.setUserAgentOverride", { userAgent: UA, acceptLanguage: "zh-CN,zh;q=0.9", platform: "Linux armv81" });
  await S("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await S("Page.navigate", { url: START_URL });
  for (let i = 0; i < 80; i++) { const r = await S("Runtime.evaluate", { expression: "!!document.querySelector('[class*=\"_sidebarCol\"]')", returnByValue: true }); if (r.result.value === true) break; await sleep(250); }
  await sleep(1500);
  const click = async (x, y) => {
    await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const ev = async (expression) => (await S("Runtime.evaluate", { expression, returnByValue: true })).result.value;

  // 皮肤先注入，让布局是 2.0 的样子
  await ev("(function(){var s=document.getElementById('dsh-skin-style');if(!s){s=document.createElement('style');s.id='dsh-skin-style';document.head.appendChild(s);}s.textContent=" + JSON.stringify(css) + ";})()");
  await ev(js);
  await sleep(1200);

  // 打开抽屉 → 点一个真实会话 → 关抽屉
  await click(24, 26);
  await sleep(900);
  const PICK = `(function(){
    var rows=[].slice.call(document.querySelectorAll('[role="treeitem"][class*="_sessionRow"]'));
    for (var i=0;i<rows.length;i++){ var t=String(rows[i].innerText||'');
      if (t.indexOf('进行中')>=0){ var b=rows[i].getBoundingClientRect(); return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}); } }
    return null; })()`;
  let pick = null;
  for (let i = 0; i < 40; i++) { const v = await ev(PICK); if (v) { pick = JSON.parse(v); break; } await sleep(400); }
  if (pick) await click(pick.x, pick.y);
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('[data-slot=\"conversation.header\"] header:not([class*=\"_headerBlank\"])')")) break;
    await sleep(400);
  }
  await sleep(1200);
  const h = JSON.parse((await ev(HEADER_DUMP)) || "{}");
  fs.writeFileSync(path.join(OUT, "diag2-header.json"), JSON.stringify(h, null, 1));
  console.log("== header rows ==");
  for (const n of h.rows || []) console.log(" ".repeat(n.d * 2) + [n.tag, n.cls, n.x + "," + n.y + " " + n.w + "x" + n.h, n.pos, "r=" + n.right, n.aria || "", JSON.stringify(n.txt)].join(" "));
  console.log("== actions ==", JSON.stringify(h.actions));
  console.log("== utils ==", JSON.stringify(h.utils));
  console.log("== corner ==", JSON.stringify(h.corner));
  console.log("== tabs ==", JSON.stringify(h.tabs));
  const sh1 = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "diag2-header.png"), Buffer.from(sh1.data, "base64"));

  // 打开抽屉 → 点侧栏「设置」
  await click(24, 26);
  await sleep(900);
  const btn = await ev(`(function(){var b=document.querySelector('.dsh-settings-btn');if(!b)return null;var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  console.log("settings btn", btn);
  if (btn) { const p = JSON.parse(btn); await click(p.x, p.y); }
  let opened = false;
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('[role=\"dialog\"]')")) { opened = true; break; } await sleep(400); }
  console.log("dialog opened", opened);
  await sleep(1200);
  const d = JSON.parse((await ev(PANEL_DUMP)) || "{}");
  fs.writeFileSync(path.join(OUT, "diag2-panel.json"), JSON.stringify(d, null, 1));
  console.log("== panel rows ==");
  for (const n of d.rows || []) console.log(" ".repeat(n.d * 2) + [n.tag, n.cls, n.x + "," + n.y + " " + n.w + "x" + n.h, "ovfY=" + n.ovfY, "sh/ch=" + n.sh + "/" + n.ch, n.disp, JSON.stringify(n.txt)].join(" "));
  const sh2 = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "diag2-panel.png"), Buffer.from(sh2.data, "base64"));
  ws.close();
}
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} process.exit(2); }, 150000);
main().catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(async () => { clearTimeout(hardStop); await sleep(200); try { child.kill(); } catch {} });
