# dsh webapp —— 开发者交接文档（v2.1.4）

> 面向接手这个 App 项目的工程师 / Agent。看完这份文档应当能：读懂代码、改皮肤、重建 APK、自测、发版。
> 用户可读的版本说明在 [`README.md`](README.md)，本文是**代码层**的交接。
>
> 本文描述 **v2.1.3** 的实际状态：入口地址由用户第一次启动时填写，代码里不含任何站点信息。

## 0. 一句话

用 WebView 包住用户填的 `https://<域名>/?token=<令牌>`，自己处理登录（token → Cookie）、自己缓存首屏和
JS/CSS/字体（断网也能先画出界面），再在页面里注入一份 CSS/JS 把侧边栏和聊天区按手机尺寸重排。

- 包名 `com.dsh.shell`，单 Activity，`minSdk 24` / `targetSdk 34`
- 版本：`versionName 2.0.5` / `versionCode 14`
- 2.0.5 相对 2.0.4：图标源图换成 `reference/icon-source.jpg`（用户最新发的大头特写），`make-icons.py` 的 `SRC` 改为 `ICON_SRC` 环境变量或该默认路径。
- 2.0.4 相对 2.0.3：图标改回照片风但降到一半清晰度（`ICON_STYLE=photo` 默认，`ICON_HALF=1`），包体 87 KB → 166 KB。
- 2.0.3 相对 2.0.2：图标画布 32→96、调色板 24→64（`ICON_ART` / `ICON_COLORS` 环境变量可调），包体 50 KB → 87 KB。
- 2.0.2 相对 2.0.1：启动图标改像素风（`tools/make-icons.py` 重写），自适应图标背景由满幅 PNG 改为 `@color/ic_launcher_bg`，安装包从 505 KB 降到 50 KB。
- 2.0.1 相对 2.0：头部第二行四个按钮改为 `skin.js` 的 `layoutHeaderRow()` 固定定位（一行摆齐）；设置面板内容区可上下滑、顶部 tab 条可横向滑。
- 产物 `out/dsh-shell.apk`（约 494 KB），自签（`keystore/dsh.keystore`，alias `dsh`，口令 `dshshell`）
- 入口**不在代码里**：用户第一次启动时填，存 SharedPreferences（`Settings.startUrl(ctx)`），运行时传进 `SkinWebClient` / `Preloader`。

- 没有设置页、没有开关、没有运行时配置 —— 这是产品要求，不是没做完

## 1. 硬约束（改之前先看）

1. **不改服务端/插件端**：所有排版改动都在 App 注入的 `assets/skin.css` + `assets/skin.js` 里，
   DSH 的插件、profile、nginx 一律不动（唯一的外部依赖见 §9）。
2. **不给用户任何开关**：改动直接设计死，装上就是改后的样子。
3. **不靠自动点击糊弄**：需要「弹出某个面板」时，是去点真实的按钮（见 §6.4 的 `proxyClick` 思路
   在本版尚未引入；v1.2 的「设置」按钮是**合成点击**：点开账号菜单 → 点菜单里的「设置」）。
4. **必须可覆盖安装**：同一 keystore，只升 `versionCode`，不换签名。
5. 类名是 CSS Module 哈希（`wtg9ga_*`、`mP3x-q_*`、`GAkraW_*`、`_5Qcc8a_*`、`wnFoaW_*`），
   **每次网页构建都会变** ⇒ 选择器只能用 `[class*="_panelRow"]`、`[aria-label]`、`[data-slot]`
   这类稳定特征，绝不能写死哈希。

## 2. 目录与文件职责

```
dsh-android-shell/
  AndroidManifest.xml            单 Activity（singleTask、configChanges 全给、exported）、INTERNET 权限
  build.sh                       手工构建（不用 Gradle），7 步，见 §7
  keystore/dsh.keystore          自签证书（alias dsh / dshshell）
  assets/skin.css   231 行 9018 B   注入样式：七处排版改动
  assets/skin.js    362 行 12160 B  注入脚本：状态同步、合成设置按钮、消息对齐
  res/values/{strings,colors,styles}.xml   深色主题、无 ActionBar
  res/mipmap-*/ic_launcher*.png            图标（tools/make-icons.py 生成）
  res/mipmap-anydpi-v26/ic_launcher.xml    自适应图标（背景 = 满幅头像，前景全透明）
  src/com/dsh/shell/                       共 7 个文件 1004 行
    MainActivity.java     111 行  WebView 外壳：配置、返回键保活、状态保存
    SkinWebClient.java    244 行  拦截同源 GET、断网判定、注入皮肤、回填缓存
    Policy.java            69 行  取数策略（纯逻辑，可测）
    Fetch.java            218 行  手写重定向循环 + Cookie 收发
    AssetCache.java       107 行  磁盘缓存（SHA-1 键、原子写）
    Preloader.java        165 行  后台预取 + 从 HTML 抽资源 + URL 解析
    Settings.java          62 行  入口地址读写（SharedPreferences）+ 规范化
    Web.java              103 行  同源/缓存判定、MIME 推断、皮肤注入
  tools/jvm-check/                JVM 冒烟测试（stubs + Check.java 136 行 + run.sh）
  tools/make-icons.py             图标生成（源图 reference/icon-source.jpg）
  out/dsh-shell.apk               产物
```

**为什么把逻辑拆成 `Web` / `Policy` / `AssetCache` / `Fetch` / `Preloader`**：这五个类都不碰
WebView 类型，所以能直接在电脑 JVM 上跑（§8），改缓存/登录逻辑时不用装模拟器就能验证。

## 3. 启动链路

```
MainActivity.onCreate
  ├─ WebView 配置（JS、DOM storage、wide viewport、深色背景、UA 去掉 "; wv"）
  ├─ CookieManager.setAcceptThirdPartyCookies(web, true)
  ├─ web.setWebViewClient(new SkinWebClient(this))
  ├─ Preloader.kick(this)          → 后台线程预取首屏 + 资源（1 小时内不重复）
  └─ web.loadUrl(Web.START_URL)    → https://你的域名/?token=你的登录令牌

SkinWebClient.shouldInterceptRequest(view, request)
  ├─ 只处理 GET + 同源（url.startsWith(Web.ORIGIN)），其余 return null 交给 WebView
  ├─ document = request.isForMainFrame()
  ├─ loader = hasNetwork() ? Policy.NETWORK : Policy.OFFLINE
  ├─ body = Policy.load(loader, cache, url, document)   → null 时：文档给 offlinePage()，资源 return null
  ├─ !document && 有旧缓存 → maybeRefresh(url)           → 后台线程按 6h 阈值静默刷新
  └─ return toResponse(url, body)                        → 带 Web.mimeOf(url) 的 WebResourceResponse

onPageFinished
  ├─ 350ms / 1200ms / 2600ms 各注入一次皮肤（幂等：window.__dshShellSkin + #dsh-skin-style 双重判重）
  └─ 3000ms harvest()：evaluateJavascript 取 performance.getEntriesByType('resource') → Preloader.cacheUrls
```

返回键：`canGoBack() ? goBack() : moveTaskToBack(true)` —— 退到后台而不是销毁，页面、WebSocket、
输入框内容都留着，再点开是热启动（这是「每次打开都要重新加载」的解法）。

## 4. 关键机制一：token 是 303 换 Cookie，不是直接放行

读 `dsh-client-connection/lib/index.js` 得到的服务端规则：

- `GET /?token=xxx`：token 正确 ⇒ **303 + `location: ./` + `Set-Cookie`**（`dsh-auth-<base64url(sha256(authority))>`，
  HttpOnly、SameSite=Strict、30 天）；cookie 有效 ⇒ 303 到 `./`；其余 401 并返回纯文本
  `dsh web authentication required; reopen the URL printed by dsh web.`
- cookie 的 authority 取自请求的 Host/Origin，所以**走 nginx 域名和走回环 IP 拿到的 cookie 名不同**。

后果：`HttpURLConnection.setInstanceFollowRedirects(true)` 跟 303 时**不会带上刚收到的 cookie**，
必然落到 401 页。所以 `Fetch.get` 手写了重定向循环：

- `MAX_HOPS = 6`，每一跳 `setInstanceFollowRedirects(false)`，手动拼 `Cookie` 头；
- `absorb()` 把响应的 `Set-Cookie` 收进本地 `TreeMap`（同名覆盖），同时 `CookieManager.setCookie` + `flush()`，
  这样 WebView 里的 XHR / WebSocket 也带得上；
- 301/302/303/307/308 都跟，`firstHeader("location")` + `resolve(base, loc)` 处理相对地址；
- 返回 `Result{code, body, finalUrl}`；非 2xx 或空体视为失败，让 `Policy` 回退缓存。

**改这里要小心**：登录态只靠 cookie，cookie 过期（30 天）后必须重新用带 token 的 URL 打开一次。

**地址填错时的两条回弹路径**（2.1.4 起两条都接）：

- token 错 ⇒ 服务端回上面那行英文 ⇒ `SkinWebClient.checkAuthPage()` 用 `evaluateJavascript` 探测到
  `authentication required` ⇒ `onAuthRequired` ⇒ `MainActivity.promptAgain()`；
- 域名/端口/路径错或服务端没开 ⇒ 主文档 `Policy.load` 返回 null（走兜底页），或 WebView 报
  `onReceivedError`（主框架）⇒ `SkinWebClient.onLoadFailed` ⇒ 同样回到 `promptAgain()`。
- `promptAgain()` 自带 3 秒节流 + `asking` 去重（`askForUrl` 进入时置位、`OnDismissListener` 复位），
  所以一次失败只会弹一次，不会连环弹。
`START_URL` 里始终带 token，所以正常使用不会掉线；但如果 token 换了，改 `Web.START_URL` 重新打包。

## 5. 关键机制二：缓存与断网首屏

`AssetCache`：目录 `getCacheDir()/webcache`，文件名 = `sha1(url) + ".bin"`，写入走 `.tmp` + rename。
没有过期时间（靠 `savedAt()` 判断新鲜度），也没有容量上限 —— 整站 UI 资源约 12 MB。

`Policy.load(loader, cache, url, document)`：

| 场景 | 行为 |
| --- | --- |
| 主文档（document=true） | 网络优先（9s 连接 / 20s 读取），失败/超时/非 2xx → 回退缓存；成功则写缓存 |
| 静态资源 | 缓存优先，命中直接返回；没有才走网络（15s / 30s）并写缓存 |
| 无网络（`ConnectivityManager` 无 activeNetwork） | loader 换成 `Policy.OFFLINE`（恒返回 null）⇒ 立刻用缓存，不干等超时 |
| 无网且无缓存（仅主文档） | 返回 `offlinePage()`：深色「现在没有网络」页面 |

`Preloader.kick()`：后台线程先取首屏 HTML，用正则 `(?:src|href)\s*=\s*["']([^"']+)["']` 抽资源，
`resolve()` 处理 `//`、绝对、`/`、`./`、`&amp;` 反转义，再逐个 `Fetch.get` 写缓存；
`MAX_FILES = 200`、`MAX_BYTES = 64MB`，1 小时内不重复跑。
`Preloader.cacheUrls(ctx, urls)` 由 `harvest()` 调用，把页面实际加载过的资源补进缓存。

注意：缓存里存的是**原始 HTML**（皮肤是渲染后注入的），所以改皮肤不需要清缓存；
但换皮肤后旧页面仍是旧样式，直到下一次加载 —— 这一点在 v1.2 没有做版本号处理。

## 6. 皮肤：注入样式 + 脚本

### 6.1 注入时机

`onPageFinished` 之后 `evaluateJavascript` 注入（350 / 1200 / 2600ms 各一次），脚本是：

```
(function(){
  try{ var s=document.getElementById('dsh-skin-style');
       if(!s){ s=document.createElement('style'); s.id='dsh-skin-style';
               (document.head||document.documentElement).appendChild(s); }
       s.textContent=<JSON 转义后的 skin.css>; }catch(e){}
  <skin.js 原文>
})();
```

`skin.js` 自己也有 `window.__dshShellSkin` 守卫，重复执行无副作用。

### 6.2 状态判定（最容易踩的坑）

**不能靠侧栏宽度判断展开/收起**（皮肤自己会改内边距，宽度会自我锁死）。做法是读左上角按钮的
`aria-label`：

- `收起侧边栏` ⇒ 抽屉展开（`html[data-dsh-drawer="1"]`）
- `打开侧边栏` ⇒ 图标栏（`html[data-dsh-rail="1"]`）

CSS 侧优先用 `:has()` 直接判（`:has([class*="_toggle"][aria-label="收起侧边栏"])`），
老 WebView 不支持时退回 JS 维护的 `data-dsh-*` 属性 —— 两种写法在每个规则里**双份并列**。

### 6.3 七处改动

| # | 改动 | 关键规则 |
| --- | --- | --- |
| 1 | 图标栏图标下方加小字 | `button[aria-label]` 变 `flex-direction: column`、`min-height: 44px`、`::after { content: attr(aria-label); font-size: 9px }`；`shortLabel()` 把长标签映射成短词（打开/新建/插件/自动化/更多/添加/搜索/设置/账号） |
| 2 | 点会话自动收起抽屉 | `document.addEventListener("click", h, true)`，`closest('[class*="_sessionRow"]')` 命中且抽屉开 ⇒ `setTimeout(() => realClick(toggle), 90)` |
| 3 | 开合按钮都在左上角 | 抽屉态 `logoRow { justify-content: flex-start }` + `> [class*="_toggle"] { order: -1; width/height: 34px }` |
| 4 | 图标放大 + 边距收紧 | 图标栏图标 17→20px，`_collapsed` 左右 padding 10→1px（**列宽保持网页原生 56/280，不碰**） |
| 5 | ~~侧栏缩到 75%~~ 已废弃 | 曾把列宽钉成 42/210，导致内容按原生 56/280 排版后被裁 + 两秒后矫正，四轮对照实验后删除，详见 §10.1 |
| 6 | 设置搬到侧栏头像上方 | `ensureSettingsButton()` 注入 `.dsh-settings-btn`（齿轮 svg + 文字），插在 `[class*="_settingsArea"]` 里，并把该容器改 `flex-direction: column`；点击 `openSettings()` = 点账号按钮 → 找菜单项「设置」→ `realClick` |
| 7 | 头部按钮归位 | `header { position: relative }`；图标栏形态下（`html[data-dsh-rail="1"]` 或 `:has(打开侧边栏)`）把 `[data-team-action="true"]` 绝对定位到 `right:40px; top:10px`（贴住右侧边栏图标）、`button[aria-label*="后台任务"]` 到 `right:8px; bottom:4px`（第二行最右），并给 `_headerUtilities` 加 `margin-right:36px` 让位。抽屉展开态不套用（头部仅 132px 会挤爆） |
| 8 | 设置面板左栏 15% | `[role="dialog"] > [class*="_nav"] { flex: 0 0 15% !important; width: 15% !important; padding: 22px 3px 0 }`（364 面板 → 55px）；55px 放不下横排文字，`_navCell` 改 `flex-direction: column`（图标 15px 在上、`_navLabel` 9px 在下，`line-height:1.3` + `-webkit-line-clamp:2`），`_navTitle/_navList` 去内边距。必须用 `[role="dialog"] >` 直接子选择器，否则 `_navTitle/_navList/_navCell/_navLabel` 会一起命中 |
| 9 | 设置面板账号卡片换行 | `[role="dialog"] [class*="_card"] { flex-wrap: wrap }`、`_identity { flex: 1 1 100% }`、`_identityCopy { min-width: 0 }`、`_accountInfo { margin-left: auto }`。右栏 176 时 `_identity` 会被压成 0 宽（名字/号码看不见），273 时只剩 84 仍硬裁，换行后该页 0 裁剪 |
| 10 | 对话/思考与输入框左对齐 | `alignMessages()`：取 `[contenteditable]` 外层 card 的 `rect.left` 与消息列的 `paddingLeft` 比较，不一致就写内联 `padding-left/right`；量不到合理值（0~48px 外）就跳过 |

### 6.4 `skin.js` 函数表（19 个）

`shortLabel` `sideCol` `frameEl` `toggleBtn` `isDrawerOpen` `tagFrame` `syncLabels` `sync`
`findColumn` `composerBox` `alignMessages` `accountButton` `ensureSettingsButton` `realClick`
`findMenuItem` `closeMenu` `openSettings` `watchCol` `boot`

- `realClick(el)`：`pointerdown/mousedown/pointerup/mouseup/click` 五连发，坐标用元素中心的
  `Input.dispatchEvent` 等价物 —— 网页里很多按钮只认真实事件序列，`el.click()` 打不开菜单。
- `sync()` 由 300ms 定时器 + `MutationObserver`（childList/subtree/aria-label）+ `ResizeObserver`
  三重驱动；`frame` 上还挂了 `transitionend → sync()`。
- `boot()` 等 `document.readyState` 到位后起定时器。

## 7. 构建（不用 Gradle）

工具链在 `../tools/android/`（JDK 17.0.2、build-tools 34、platform-34；来源脚本
`tools/android/fetch-toolchain.sh`，Adoptium 官方源在本机会被重置，走华为云/腾讯云镜像）。

```bash
bash dsh-android-shell/build.sh      # → out/dsh-shell.apk
```

七步（`build.sh` 里都有 echo）：

1. `aapt2 compile --dir res -o build/res.zip`
2. `aapt2 link -o build/base.apk -I android.jar --manifest AndroidManifest.xml build/res.zip --java build/gen -A assets --min-sdk-version 24 --target-sdk-version 34 --version-code 3 --version-name 1.2 --no-version-vectors`
3. `javac --release 8 -classpath android.jar -d build/classes @build/sources.txt`
4. `d8.bat --release --min-api 24 --lib android.jar --output build/dex <所有 .class>`
5. python zipfile 把 `classes.dex` 追加进 APK
6. `zipalign -f -p 4`
7. `keytool` 生成 keystore（已存在则跳过）+ `apksigner sign`（v2+v3）

### 构建坑（都踩过）

- `aapt2 link -R res.zip` 会被当成 overlay，报 `resource … does not override an existing resource`
  ⇒ `res.zip` 必须是**位置参数**。
- javac 用 `@build/sources.txt` 时，MSYS 不会转换文件内容里的 `/c/...` 路径，报 `找不到文件: \c\Users\...`
  ⇒ `build.sh` 先 `cd "$ROOT"`，`sources.txt` 里只写相对路径。
- 匿名 `Runnable` 里调用外部类的静态方法要写类名（`Preloader.run(app)`），否则被解析成 `Runnable.run()`。
- `aapt2` 的 `--version-code` / `--version-name` 会被 `AndroidManifest.xml` 覆盖 ⇒ **版本号改 manifest**，
  `build.sh` 里的 flag 只是对齐显示。
- `apksigner` 需要 `JAVA_HOME`（`build.sh` 里已 `export`，手动跑要自己设）。

## 8. 测试

### 8.1 JVM 冒烟（不需要手机、不需要模拟器）

```bash
bash tools/jvm-check/run.sh
```

`tools/jvm-check/stubs/` 里放了两个假类（`android.webkit.CookieManager`、
`android.content.Context`），`Check.java` 直接跑真实的 `Fetch` / `AssetCache` / `Preloader` /
`Web` / `Policy`，打的是**真网络**。当前输出（应全部 ok）：

```
首屏 200 / finalUrl https://你的域名/ / 44555 字节 / 含 __DSH_BOOT__
303 换到 dsh-auth cookie；裸根路径仅靠 cookie 也 200（不是 401 页）
解析 11 个资源，9 个可缓存；预取 3 个落盘 11 982 695 字节
断网模拟（Loader 恒 null）：首屏来自缓存、静态资源 2/2 命中缓存
ALL OK
```

### 8.2 浏览器里复验皮肤（ego-browser）

`ego-browser` 用 CDP 驱动 Edge。要点：

- 先设 UA 再设视口，**然后 reload**，只设视口会得到错乱布局：
  `Emulation.setUserAgentOverride{userAgent: <Android UA>, acceptLanguage:"zh-CN,zh;q=0.9", platform:"Linux armv81"}`
  → `setDeviceMetricsOverride{width:412, height:915, deviceScaleFactor:2.625, mobile:true}`
  → `setTouchEmulationEnabled{enabled:true}`
- 让皮肤「从文档开始就存在」：`Page.addScriptToEvaluateOnNewDocument` 注入
  `<style id="dsh-skin-style">` + `skin.js`（40ms 重试 60 次），再 `goto https://你的域名/?token=你的登录令牌`。
- 点开菜单/抽屉必须用 `Input.dispatchMouseEvent`（`element.click()` 无效）。
- 截图受限：窗口 minimized 时 `page.screenshot` 报错；桌面整屏 `CopyFromScreen` 在这台机器上恒为黑
  （RDP session），所以**只能用 DOM 测量 + `page.screenshot` 验证**。
- **脚本进程退出后 CDP 的 `Emulation.*` / 预注入脚本全部失效**：如果想让用户在屏幕上看到手机形态，
  必须把浏览器窗口本身设窄（约 430×1000），不能只靠 CDP 模拟。

v1.2 的基线数值（412×915，抽屉/图标栏两态）：

| 项 | 期望 |
| --- | --- |
| frame 列 | 图标栏 `42px …`；抽屉 `210px …`（第三列恒 0） |
| sidebarCol 宽 | 42 / 210 |
| 图标栏按钮 | 9 个，39×42，x=1，图标 17px，下方 9px 小字 |
| 抽屉 toggle | 左上角 ~10,19，34×34 |
| 抽屉「设置」 | 头像正上方，宽约 197–203 |
| 消息列 vs 输入框 | `markdown.left - card.left ≈ 0` |
| 点会话后 | colW 回到 42、`data-dsh-drawer` 消失 |

## 9. 发版 checklist

1. 改 `assets/skin.css` / `skin.js`（或 Java）。
2. 改 `AndroidManifest.xml` 的 `android:versionCode` / `android:versionName`（`build.sh` 里的同名 flag 一起改）。
3. `bash dsh-android-shell/build.sh`。
4. `aapt2 dump badging out/dsh-shell.apk | head -1` 核对版本号。
5. 核对包内资产与磁盘一致：
   `python -c "import zipfile,hashlib;z=zipfile.ZipFile('out/dsh-shell.apk');print(hashlib.sha256(z.read('assets/skin.css')).hexdigest())"`
6. `bash tools/jvm-check/run.sh` → ALL OK。
7. ego-browser 复验（§8.2）+ 截图存到 `tools/shot-*.png`。
8. 发到用户 QQ：SnowLuma OneBot HTTP `http://127.0.0.1:3000`，accessToken 在
   任意 OneBot 兼容实现的 `upload_private_file` 接口；
   `upload_private_file` 参数 `{user_id: <QQ号>, file: <绝对路径>, name: "dsh-shell.apk", upload_file: true}` ——
   **`upload_file` 必须是布尔 true**，传路径会报 `upload_file: expected a boolean`。

## 10. 已知问题（v1.3 现状）

### 10.1 为什么不要改侧边栏宽度和内边距（最重要的一条）

四轮独立包对照实验（e/f/g/j/k/l/m/n 系列，用户逐包安装反馈）得到的事实：

| 做法 | 结果 |
| --- | --- |
| `skin.js` 写 `grid-template-columns` 内联样式（v1.1） | 裁切 + 反复变动（和网页抢同一属性） |
| 样式表 `!important` 钉 42/210（v1.2–v1.2.1） | 列宽不跳，但内容仍按 56/280 排 ⇒ 被裁 + 两秒后矫正 |
| 42/210 + 内容层 `transform: scale(0.75)` | 仍裁 |
| 42/210 + `contain: paint` + 子元素 `max-width:100%` | 不裁，但仍有位置微移 |
| 只加抽屉 `_quietBars` 左右 padding 6px | 仍有两秒后位置微移 |
| 完全不碰宽度/内边距 | 干净 |

原因：网页自己按 56/280 排版，打开抽屉时有 0.3s `transition` 与内部重排；外面用 `!important`
改这些值会让它的内部测量与画面对不上，下一次重排就「矫正」一次。

**结论：皮肤只做「不影响网页布局计算」的改动**（小字标签、图标尺寸、按钮顺序、注入新按钮、
消息区 padding、dock 最小高度）。宽度、内边距一律不碰。

### 10.2 其它

1. 抽屉态 `deepseek HARNESS` 字标在极窄屏上可能被裁一点（品牌区由网页自己排，皮肤只做
   flex 收缩兜底，不保证所有机型）。
2. 只有一个入口 / token 写死；token 变了要改 `Web.START_URL` 重新打包。
3. 缓存里存原始 HTML：换皮肤后旧页面仍是旧样式，直到下一次加载（本版没有缓存版本号机制）。
4. 皮肤注入时机：**当前版本只在 `onPageFinished` 注入**（`evaluateJavascript`，350/1200/2600ms
   各一次）。所以首帧是网页原样，皮肤几十毫秒后才生效。因为现在的皮肤**不改几何**（不动
   `grid-template-columns`、不动 `_quietBars` 左右 padding），这个延迟肉眼看不出来；
   一旦有人再改几何，就会重新出现「先原样再跳一下」。
   （历史上试过把 `<style>`/`<script>` 直接写进文档 HTML 的做法，配合改宽度的皮肤反而更乱，
   已回退，现在代码里没有 `Web.withSkin`。）
5. versionCode 9 装不到已装过更高 versionCode 的实验包上（实验包是 100+），需先卸载。

## 11. 速查：踩坑清单

| 现象 | 原因 / 处理 |
| --- | --- |
| 打开 App 直接 401 页 | `Fetch` 的重定向循环被改坏，或 `CookieManager` 没同步 |
| 断网打开白屏 | 首次安装后没联网跑过一次预取；缓存目录被系统清理 |
| 皮肤完全不生效 | `shouldInterceptRequest` 把 `assets` 读失败、或注入的 JS 有语法错误（看 logcat） |
| 皮肤部分生效（宽度变了、小字没有） | `:has()` 判定没命中且 `data-dsh-*` 没写 ⇒ 看 `toggleBtn()` 的 aria-label 是否匹配 |
| 侧栏内容被截断 | 只改了 `grid-template-columns` 没改 `_quietBars` 的 `width:100%` |
| 「设置」按钮跑到头像左边 | `_settingsArea` 还是横排（规则被网页后写的样式盖了，加 `!important`） |
| 消息没对齐 | `composerBox()` 找不到 contenteditable（页面结构变了）⇒ 更新选择器 |
| 菜单点不开 | 用了 `el.click()`；必须 `realClick()` 派发完整事件序列 |
| `aapt2` 报 overlay 错误 | `res.zip` 用了 `-R` |
| `apksigner` 找不到 java | 没 `export JAVA_HOME` |
| python 打印中文乱码 | MSYS 下加 `PYTHONIOENCODING=utf-8` |
| python 读写 `/tmp/x` 失败 | MSYS 的 `/tmp` 与 Windows python 不通，临时文件放工作区 |

## 12. App 之外、但会影响它的东西（别改坏）

- **站点侧的「预览版说明」弹窗**：profile 里 `@deepseek-ai/dsh-client-ui-settings`（0.1.7）第 1509 行
  被固定成 `const persistence = "host";`，让非回环（手机/公网域名）页面也能读写 settings。
  没有这个补丁，手机每次打开都会弹「预览版说明」且点「继续」无效 —— App 只是 WebView，无法绕过。
  补丁由 `@local/dsh-web-access-helper` 启动时幂等重打，详见 `docs/welcome-notice-fix/`。
- **公网入口**：`你的域名` → nginx → `127.0.0.1:51081`（web-access-helper 的镜像端口）。
  该端口没在监听时，App 和浏览器都会 502。
- 网页改版（DSH 升级）会让 CSS Module 哈希和部分 DOM 结构变化 ⇒ 皮肤要跟着回归一次（§8.2）。

## 13. 怎么确认源码状态（逐项比对包内容）

改完代码想确认「打出来的包确实带上了我的改动」，可以把自己上次发布的包留一份作基准，
逐条比对包内条目（`skin.css` / `skin.js` / `classes.dex` 应与你磁盘上的文件一致）：

```bash
python - <<'EOF'
import zipfile, hashlib
apk = zipfile.ZipFile("out/dsh-shell.apk")
for n in ("classes.dex", "assets/skin.css", "assets/skin.js"):
    print(n, hashlib.sha256(apk.read(n)).hexdigest()[:16])
EOF
sha256sum assets/skin.css assets/skin.js
```

两侧一致即说明资产是最新的；APK 整体 sha 每次都会不同（zip 时间戳 + 签名元数据），属正常。
