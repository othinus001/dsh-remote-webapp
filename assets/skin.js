/* ============================================================
   DSH 手机壳 2.0 —— 抽屉式布局脚本（注入到 WebView 页面）

   只做 CSS 做不到的事，不搬官方 DOM：
   1. 标记 html[data-dsh-app-layout="drawer"]（本项目固定抽屉布局）
   2. 让官方侧栏保持「展开」态（点一次它自己的 toggle），抽屉只做位移
   3. 抽屉开合：frame[data-dsh-app-drawer]，全交给 CSS 的 transform
   4. 顶部左上角的入口按钮是 CSS 伪元素画的，这里按坐标命中
   5. 点遮罩 / 点会话 / 点抽屉里的官方 toggle → 收起抽屉
   6. 侧栏底部合成一个「设置」按钮（本项目唯一新增的 DOM 节点）
   7. 消息区左边界对齐底部输入框

   不做的事（踩过的坑，见 PITFALLS.md）：
   - 不写 grid-template-columns，不写侧栏宽度/内边距
   - 不移动、不隐藏官方按钮
   ============================================================ */
(function () {
  if (window.__dshAppSkin) return;
  window.__dshAppSkin = 1;

  var OPEN = "data-dsh-app-drawer";
  var LAYOUT = "data-dsh-app-layout";

  function root() {
    return document.documentElement;
  }
  function frame() {
    return (
      document.querySelector('[data-slot="root"] > [class*="_frame"]') ||
      document.querySelector('[class*="_frame"]:has(> [class*="_sidebarCol"])')
    );
  }
  function sidebarCol() {
    var f = frame();
    return f ? f.querySelector(":scope > [class*=\"_sidebarCol\"]") : null;
  }
  function toggleButton() {
    return document.querySelector(
      '[data-slot="sidebar"] [class*="_logoRow"] button[class*="_iconButton"]'
    );
  }
  /* 官方侧栏是展开的，还是折成了图标栏（这个属性官方写在 frame 上） */
  function expanded() {
    var f = frame();
    return !!f && !f.hasAttribute("data-sidebar-collapsed");
  }
  function drawerOpen() {
    var f = frame();
    return !!f && f.hasAttribute(OPEN);
  }

  root().setAttribute(LAYOUT, "drawer");

  /* ── 让侧栏保持展开：抽屉里只滑它，不重排 ─────────────────────────────── */

  var clicking = false;
  function setExpanded(open) {
    if (expanded() === open) return;
    var b = toggleButton();
    if (!b) return;
    clicking = true;
    try {
      b.click();
    } finally {
      clicking = false;
    }
  }

  function setDrawer(open) {
    if (!open && typeof closePop === "function") closePop();
    var f = frame();
    if (!f || f.hasAttribute(OPEN) === open) return;
    if (open) {
      setExpanded(true);
      f.setAttribute(OPEN, "");
    } else {
      f.removeAttribute(OPEN);
    }
  }

  /* 首屏和每次换布局后：侧栏展开、抽屉关上 */
  var settleTimer = 0;
  function settle(tries) {
    clearTimeout(settleTimer);
    var f = frame();
    if (!f || !toggleButton()) {
      if (tries > 0) settleTimer = setTimeout(function () { settle(tries - 1); }, 200);
      return;
    }
    if (!f.hasAttribute(OPEN)) setExpanded(true);
  }

  /* ── 顶部左上角的入口（CSS 伪元素画的按钮） ─────────────────────────────── */

  var HIT_W = 52;
  var HIT_H = 58;
  function inEntryZone(x, y) {
    return x >= 0 && x <= HIT_W && y >= 0 && y <= HIT_H;
  }

  /* 设置面板（[role=dialog]）打开时，页面上的点击全部交给网页自己处理：
     否则左上角入口区和「点外部收起抽屉」的拦截会把面板里的开关/条目点击吃掉。 */
  function dialogOpen() {
    return !!document.querySelector('[role="dialog"]');
  }

  document.addEventListener(
    "click",
    function (e) {
      if (clicking) return;
      if (drawerOpen()) return;
      if (dialogOpen()) return;
      if (inEntryZone(e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        setDrawer(true);
      }
    },
    true
  );

  /* ── 点遮罩收起：按坐标判定，遮罩上的一次点击不穿透到下面 ──────────────── */

  var pending = false;
  var swallow = false;
  function outsideDrawer(e) {
    if (!drawerOpen()) return false;
    if (dialogOpen()) return false;
    var side = sidebarCol();
    if (!side) return false;
    if (e.clientX <= side.getBoundingClientRect().right) return false;
    var t = e.target;
    var f = frame();
    return t === side || (!!f && f.contains(t) && !side.contains(t));
  }
  document.addEventListener(
    "pointerdown",
    function (e) {
      if (!outsideDrawer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      pending = true;
    },
    true
  );
  function lifted(e) {
    if (!pending) return;
    pending = false;
    e.stopPropagation();
    swallow = true;
    setTimeout(function () { swallow = false; }, 400);
    setDrawer(false);
  }
  document.addEventListener("pointerup", lifted, true);
  document.addEventListener("pointercancel", lifted, true);
  ["mousedown", "mouseup", "touchend"].forEach(function (type) {
    document.addEventListener(
      type,
      function (e) {
        if (pending || swallow) e.stopPropagation();
      },
      true
    );
  });

  /* ── 抽屉内部：官方 toggle 收起抽屉；点会话等目的地也收起 ───────────────── */

  document.addEventListener(
    "click",
    function (e) {
      if (clicking) return;
      if (swallow) {
        swallow = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var t = e.target;
      if (!t || !t.closest) return;

      /* 抽屉里的官方开关：折叠成图标栏没有意义，直接收起抽屉 */
      var b = t.closest('[data-slot="sidebar"] [class*="_logoRow"] button[class*="_iconButton"]');
      if (b && drawerOpen()) {
        e.preventDefault();
        e.stopPropagation();
        setDrawer(false);
        return;
      }

      if (!drawerOpen()) return;
      var side = sidebarCol();
      if (!side || !side.contains(t)) return;
      /* 菜单、行操作不收起 */
      if (t.closest('[class*="_rowActions"], [aria-haspopup], [aria-expanded]')) return;
      var dest = t.closest(
        '[role="treeitem"][class*="_sessionRow"], button[class*="_newSession"], button[class*="_brand"], button[class*="_panelRow"]'
      );
      if (dest) setTimeout(function () { setDrawer(false); }, 80);
    },
    true
  );

  /* ── 侧栏底部的「设置」入口（本项目唯一新增的节点） ─────────────────────── */

  var GEAR =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"></path>' +
    "</svg>";

  function accountButton() {
    var area = document.querySelector('[class*="_settingsArea"]');
    var inArea = area
      ? area.querySelector('button[aria-label]:not(.dsh-settings-btn):not(.dsh-preset-btn)')
      : null;
    return inArea || document.querySelector('button[aria-label="账号菜单"]');
  }

  function realClick(el) {
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    } catch (err) {
      el.click();
    }
  }

  function findMenuItem(text) {
    var items = document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button');
    for (var i = 0; i < items.length; i++) {
      if ((items[i].textContent || "").trim().indexOf(text) >= 0) return items[i];
    }
    return null;
  }

  function openSettings() {
    var acc = accountButton();
    if (!acc) return;
    realClick(acc);
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var item = findMenuItem("设置");
      if (item) {
        clearInterval(timer);
        realClick(item);
        setTimeout(function () { setDrawer(false); }, 120);
      } else if (tries > 12) {
        clearInterval(timer);
      }
    }, 80);
  }

  function ensureSettingsButton() {
    var area = document.querySelector('[class*="_settingsArea"]');
    if (!area) return;
    var existing = area.querySelector(".dsh-settings-btn");
    if (existing) {
      if (area.firstElementChild !== existing) area.insertBefore(existing, area.firstElementChild);
      return;
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dsh-settings-btn";
    btn.setAttribute("aria-label", "设置");
    btn.innerHTML = '<span class="dsh-settings-glyph" aria-hidden="true">' + GEAR + "</span><span>设置</span>";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    });
    area.insertBefore(btn, area.firstElementChild);
  }

  /* ── 侧栏底部的「主题预设」入口 + 小弹窗 ────────────────────────────────
     预设只存在本机（localStorage 里 dsh-dream-skin:* 那一组键的快照），
     所以手机能留住自己的主题，不会反过来改到电脑上。 */

  var PRESET_KEY = "dsh-app:theme-presets";
  var PRESET_SEL = "dsh-app:theme-preset-sel";
  var THEME_PREFIX = "dsh-dream-skin:";
  var THEME_SKIP = { "dsh-dream-skin:schema-version": 1 };

  var PALETTE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"></circle>' +
    '<circle cx="9.2" cy="9.6" r="1.15"></circle>' +
    '<circle cx="14.8" cy="9.6" r="1.15"></circle>' +
    '<circle cx="9.8" cy="14.9" r="1.15"></circle>' +
    '<circle cx="14.6" cy="14.9" r="1.15"></circle>' +
    "</svg>";

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }
  function presets() {
    var p = readJson(PRESET_KEY, {});
    return p && typeof p === "object" ? p : {};
  }
  function selectedSlot() {
    var n = parseInt(localStorage.getItem(PRESET_SEL) || "1", 10);
    return n >= 1 && n <= 3 ? n : 1;
  }
  /* 当前主题 = 所有 dsh-dream-skin:* 键（换肤插件把整套外观都放这儿） */
  function themeSnapshot() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf(THEME_PREFIX) !== 0 || THEME_SKIP[k]) continue;
      out[k] = localStorage.getItem(k) || "";
    }
    return out;
  }
  function themeApply(snap) {
    var drop = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(THEME_PREFIX) === 0 && !THEME_SKIP[k]) drop.push(k);
    }
    for (var j = 0; j < drop.length; j++) {
      try {
        localStorage.removeItem(drop[j]);
      } catch (e) {}
    }
    for (var key in snap) {
      if (!Object.prototype.hasOwnProperty.call(snap, key)) continue;
      try {
        localStorage.setItem(key, String(snap[key]));
      } catch (e) {}
    }
  }

  /* 刷新 = 把本机网页端的主题痕迹全部抹掉，让网页按它自己的状态重新来一遍
     （和电脑客户端一致）。保存的预设放在 dsh-app:theme-presets，不在这里删。 */
  function themeReset() {
    var drop = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(THEME_PREFIX) === 0) drop.push(k);
    }
    for (var j = 0; j < drop.length; j++) {
      try {
        localStorage.removeItem(drop[j]);
      } catch (e) {}
    }
    return drop.length;
  }

  var pop = null;

  function closePop() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
  }

  function renderPop() {
    if (!pop) return;
    var p = presets();
    var sel = selectedSlot();
    var slots = pop.querySelectorAll(".dsh-preset-slot");
    for (var i = 0; i < slots.length; i++) {
      var n = slots[i].getAttribute("data-slot");
      var has = p[n] && typeof p[n] === "object";
      slots[i].setAttribute("data-has", has ? "1" : "0");
      slots[i].setAttribute("data-sel", String(n) === String(sel) ? "1" : "0");
      var st = slots[i].querySelector(".dsh-preset-state");
      if (st) st.textContent = has ? "已保存" : "空";
    }
  }

  function onPopClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var slotEl = t.closest(".dsh-preset-slot");
    if (slotEl) {
      e.preventDefault();
      e.stopPropagation();
      var n = parseInt(slotEl.getAttribute("data-slot"), 10);
      try {
        localStorage.setItem(PRESET_SEL, String(n));
      } catch (err) {}
      var p = presets();
      if (p[n] && typeof p[n] === "object") {
        themeApply(p[n]);
        location.reload();
      } else {
        renderPop();
      }
      return;
    }
    var actEl = t.closest("[data-act]");
    if (!actEl) return;
    e.preventDefault();
    e.stopPropagation();
    var act = actEl.getAttribute("data-act");
    var sel = selectedSlot();
    if (act === "save") {
      var all = presets();
      all[sel] = themeSnapshot();
      writeJson(PRESET_KEY, all);
      renderPop();
    } else if (act === "del") {
      var all2 = presets();
      delete all2[sel];
      writeJson(PRESET_KEY, all2);
      renderPop();
    } else if (act === "reload") {
      themeReset();
      location.reload();
    }
  }

  function openPop(anchor) {
    closePop();
    pop = document.createElement("div");
    pop.className = "dsh-preset-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "主题预设");
    var html = '<div class="dsh-preset-title">主题预设</div>';
    for (var n = 1; n <= 3; n++) {
      html +=
        '<button type="button" class="dsh-preset-slot" data-slot="' + n + '" data-has="0" data-sel="0">' +
        '<span class="dsh-preset-num">' + n + "</span>" +
        '<span class="dsh-preset-state">空</span>' +
        "</button>";
    }
    html +=
      '<div class="dsh-preset-acts">' +
      '<button type="button" data-act="save">保存</button>' +
      '<button type="button" data-act="del">删除</button>' +
      '<button type="button" data-act="reload">刷新</button>' +
      "</div>";
    pop.innerHTML = html;
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var h = pop.offsetHeight || 220;
    var top = r.top - h - 8;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 8);
    pop.style.left = "12px";
    pop.style.top = Math.max(8, top) + "px";
    renderPop();
    pop.addEventListener("click", onPopClick);
  }

  function ensurePresetButton() {
    var area = document.querySelector('[class*="_settingsArea"]');
    if (!area) return;
    var existing = area.querySelector(".dsh-preset-btn");
    if (existing) {
      var anchorBtn = area.querySelector(".dsh-settings-btn");
      if (anchorBtn && existing.nextElementSibling !== anchorBtn) area.insertBefore(existing, anchorBtn);
      return;
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dsh-preset-btn";
    btn.setAttribute("aria-label", "主题预设");
    btn.innerHTML =
      '<span class="dsh-settings-glyph" aria-hidden="true">' + PALETTE + "</span><span>主题预设</span>";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (pop) {
        closePop();
        return;
      }
      openPop(btn);
    });
    var s = area.querySelector(".dsh-settings-btn");
    if (s) area.insertBefore(btn, s);
    else area.insertBefore(btn, area.firstElementChild);
  }

  /* 点空白处 / 按 Esc 关掉弹窗 */
  document.addEventListener(
    "pointerdown",
    function (e) {
      if (!pop) return;
      var t = e.target;
      if (pop.contains(t)) return;
      if (t && t.closest && t.closest(".dsh-preset-btn")) return;
      closePop();
    },
    true
  );
  document.addEventListener("keydown", function (e) {
    if (pop && e.key === "Escape") closePop();
  });

  /* ── 消息区左边界对齐底部输入框 ─────────────────────────────────────────── */

  function composerBox() {
    var input =
      document.querySelector('div[class*="_input"][contenteditable="true"]') ||
      document.querySelector("textarea[class*=\"_input\"]");
    if (!input) return null;
    var r = input.getBoundingClientRect();
    if (!r.width) return null;
    return r;
  }

  function findColumn(from) {
    var el = from;
    var best = null;
    while (el && el !== document.body) {
      var cs = getComputedStyle(el);
      var pad = parseFloat(cs.paddingLeft);
      if (!isNaN(pad) && pad >= 20) {
        best = el;
        if (pad >= 28) break;
      }
      el = el.parentElement;
    }
    return best;
  }

  function alignMessages() {
    var box = composerBox();
    if (!box) return;
    var md = document.querySelector('div[class*="_markdown"]');
    if (!md) return;
    var col = findColumn(md);
    if (!col) return;
    var target = box.left - col.getBoundingClientRect().left;
    if (target < 0 || target > 60) return;
    var cur = parseFloat(getComputedStyle(col).paddingLeft);
    if (isNaN(cur) || Math.abs(cur - target) > 0.5) {
      col.style.setProperty("padding-left", target + "px", "important");
    }
    var rightTarget = target;
    var curR = parseFloat(getComputedStyle(col).paddingRight);
    if (isNaN(curR) || Math.abs(curR - rightTarget) > 0.5) {
      col.style.setProperty("padding-right", rightTarget + "px", "important");
    }
  }

  /* ── 头部第二行：成员 / 文件夹 / 更多 / 后台任务 从右往左摆成一行 ───────── */

  function layoutHeaderRow() {
    var hdr = document.querySelector('[data-slot="conversation.header"]');
    if (!hdr) return;
    var picks = [
      hdr.querySelector('button[aria-label*="后台任务"]'),
      hdr.querySelector('button[aria-label="更多操作"]'),
      hdr.querySelector('button[aria-label*="文件资源管理器"]'),
      hdr.querySelector('[data-team-action="true"]')
    ];
    var RIGHT = 8;
    var GAP = 6;
    var TOP = 54;
    var acc = RIGHT;
    for (var i = 0; i < picks.length; i++) {
      var el = picks[i];
      if (!el) continue;
      var w = Math.round(el.getBoundingClientRect().width) || 40;
      el.style.setProperty("position", "fixed", "important");
      el.style.setProperty("left", "auto", "important");
      el.style.setProperty("right", acc + "px", "important");
      el.style.setProperty("top", TOP + "px", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("height", "40px", "important");
      el.style.setProperty("margin", "0", "important");
      el.style.setProperty("z-index", "3", "important");
      acc += w + GAP;
    }
  }

  /* ── 同步 ──────────────────────────────────────────────────────────────── */

  function sync() {
    root().setAttribute(LAYOUT, "drawer");
    ensureSettingsButton();
    ensurePresetButton();
    layoutHeaderRow();
    alignMessages();
  }

  var timer = setInterval(sync, 300);
  var debounce = 0;
  setTimeout(sync, 0);
  setTimeout(sync, 120);
  setTimeout(sync, 600);
  setTimeout(sync, 1500);
  setTimeout(function () { settle(50); }, 0);
  setTimeout(function () { settle(10); }, 800);
  setTimeout(function () { settle(10); }, 2000);

  if (document.body) {
    new MutationObserver(function () {
      clearTimeout(debounce);
      debounce = setTimeout(sync, 120);
    }).observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener("resize", function () { setTimeout(sync, 120); });

  /* 给调试用：控制台里能手动开关抽屉、直接读写预设 */
  window.__dshPreset = {
    snapshot: themeSnapshot,
    apply: themeApply,
    reset: themeReset,
    presets: presets,
    slot: selectedSlot,
  };
  window.__dshApp = {
    toggle: function () { setDrawer(!drawerOpen()); },
    open: function () { setDrawer(true); },
    close: function () { setDrawer(false); },
    isOpen: drawerOpen,
  };
})();
