# dsh webapp —— 项目文档

> 一个把 DSH 网页装进手机的小 App（web 套壳）：第一次填一次地址，之后点开就是界面，
> 断网也能先把界面画出来，并且把几处在手机上别扭的排版改掉。
>
> 这份文档是**公开版**：所有域名、登录令牌都写成占位符，你需要换成自己的。
> 代码层交接看 [`HANDOVER.md`](HANDOVER.md)；
> 普通用户怎么装看 [`README.md`](README.md)。

---

## 1. 这是什么

| 项 | 值 |
| --- | --- |
| 包名 | `com.dsh.shell` |
| 形态 | 单 Activity + 全屏 WebView（无设置页、无开关、无运行时配置） |
| 版本 | `versionName 2.1.3` / `versionCode 18` |
| SDK | `minSdk 24` / `targetSdk 34` |
| 体积 | 约 494 KB（自签 APK） |
| 入口 | `https://你的域名/?token=你的登录令牌`（编译期写进 `Config.START_URL`） |
| 依赖 | 只用 Android 平台 API + JDK 17 + Android build-tools，**不用 Gradle、不引第三方库** |

设计目标是"给自己用"：装上点开就进界面，不需要任何配置；排版按自己的手机改死，不给开关。

---

## 2. 能力清单

1. **自动登录**：`?token=` 会被服务端用 **303 + Set-Cookie** 换成会话 Cookie（`dsh-auth-…`，
   HttpOnly、30 天）。`HttpURLConnection` 跟随 303 时不会带新 Cookie，所以 App 自己实现重定向
   循环：每一跳手动带 Cookie、收 `Set-Cookie`，并同步给 `CookieManager`，让 WebView 里的
   XHR / WebSocket 也带着它。之后冷启动靠 Cookie 直接 200。
2. **离线首屏**：拦截同源 GET，把主文档和 JS/CSS/字体/图标写进 App 私有缓存
   （`cacheDir/webcache`，键是 URL 的 SHA-1，先写 `.tmp` 再 rename）。
   - 主文档：有网时网络优先（9s 连接 / 20s 读取），失败或超时回退缓存；**判定无网时直接跳过
     网络**，不干等超时。
   - 静态资源：缓存优先（秒开），超过 6 小时后台静默刷新。
3. **预热**：装好第一次在线打开时，后台把整站 UI 资源预取下来（上限 200 个文件 / 64 MB），
   之后每次启动只补缺的；页面加载完再用 `performance.getEntriesByType('resource')` 回填
   实际加载过的资源。
4. **排版皮肤**：把 `assets/skin.css` + `assets/skin.js` 注入页面，改掉 13 处手机上的排版问题
   （见 §6）。皮肤只改"呈现"，不改服务端、不改 DSH 插件。
5. **退后台不重载**：`onBackPressed` → `canGoBack() ? goBack() : moveTaskToBack(true)`，
   返回键退到后台而不是销毁页面；`configChanges` 全给，旋转/切深浅色不重建 Activity。

---

## 3. 架构总览

```
MainActivity
  └─ WebView（全屏、深色底 #15161A、UA 去掉 "; wv"）
       ├─ SkinWebClient extends WebViewClient
       │    ├─ shouldInterceptRequest()  ← 同源 GET 全部走这里
       │    │     ├─ 主文档：Fetch 网络优先 → 失败/无网 → AssetCache
       │    │     └─ 静态资源：AssetCache 优先 → 过期则后台 Fetch 刷新
       │    ├─ onPageFinished()          ← 注入 skin.css / skin.js（350/1200/2600ms 重试）
       │    └─ evaluateJavascript(performance entries) → Preloader.cacheUrls()
       ├─ Fetch       纯逻辑：手写重定向循环 + Cookie 收发（JVM 可测）
       ├─ AssetCache  纯逻辑：磁盘缓存 + SHA-1 键（JVM 可测）
       ├─ Preloader   纯逻辑：HTML 解析资源、后台预取（JVM 可测）
       ├─ Policy      纯逻辑：在线/离线判定 → 决定"网络优先"还是"缓存优先"
       ├─ Web         纯逻辑：ORIGIN / START_URL / 可缓存判定 / MIME 推断
       └─ Settings    用户第一次启动填的入口地址（SharedPreferences）
```

**为什么把逻辑拆成 `Fetch` / `AssetCache` / `Preloader` / `Policy` / `Web`**：这些类不 import
任何 `android.webkit.*`，所以能在普通 JVM 上跑单测（`tools/jvm-check`），不需要模拟器。

---

## 4. 目录与文件

```
dsh-android-shell/
  AndroidManifest.xml          单 Activity（singleTask、configChanges 全给、exported）+ INTERNET 权限
  build.sh                     手工构建脚本（7 步，见 §7）
  keystore/dsh.keystore        自签证书（alias dsh / 口令 dshshell）——公开仓库请自己生成一份
  dist/dsh-shell.apk           已经构建好的包（含明文令牌，公开前删掉）
  assets/skin.css   347 行     注入样式（13 处排版改动）
  assets/skin.js    398 行     注入脚本（状态同步、合成设置按钮、消息对齐、点会话收起）
  res/                         图标（mipmap 各密度 + adaptive-icon）、主题、颜色
  src/com/dsh/shell/
    MainActivity.java      111 行  WebView 配置、返回键、状态保存
    SkinWebClient.java     248 行  请求拦截、缓存策略、皮肤注入
    Fetch.java             218 行  HTTP + 重定向 + Cookie（纯逻辑）
    Preloader.java         165 行  资源预取（纯逻辑）
    AssetCache.java        107 行  磁盘缓存（纯逻辑）
    Policy.java             69 行  在线/离线策略（纯逻辑）
    Web.java                54 行  常量与判定（纯逻辑）
    Settings.java                  入口地址读写（SharedPreferences）+ 规范化
  tools/
    fetch-toolchain.sh            下载 JDK + build-tools + platform 到 ./toolchain
    jvm-check/                    JVM 冒烟测试（含 android.webkit.CookieManager 等桩）
    make-icons.py                 由源图生成全套 mipmap
  reference/icon-source.jpg    图标源图（tools/make-icons.py 读它）
  toolchain/                    下载的工具链（不提交，约 300 MB）
```

---

## 5. 运行链路

**冷启动**

1. `MainActivity.onCreate` → 建 WebView、设置 UA/JS/DOM storage/wide viewport、
   `CookieManager.setAcceptThirdPartyCookies(true)`。
2. `web.loadUrl(Config.START_URL)`。
3. `shouldInterceptRequest` 命中主文档：先看 `Policy` 判断有无网络。
   - 有网：`Fetch.get(url)`（自动跟 303、拿 Cookie）→ 200 且含 `__DSH_BOOT__` → 落盘 → 返回。
   - 无网或失败：读 `AssetCache`，命中就返回缓存 HTML（界面先出来）。
4. 页面开始加载子资源 → 同样走拦截器，缓存优先。
5. `onPageFinished` → 注入 `<style>` + `<script>`（皮肤）→ 3000ms 后收集
   `performance.getEntriesByType('resource')` 交给 `Preloader` 回填缓存。

**热启动（进程还活着）**

WebView 实例没销毁，页面保持在内存里，返回前台立即显示；`onSaveInstanceState` 存
`web.saveState()`，被系统回收后能恢复历史。

---

## 6. 皮肤：13 处排版改动

所有改动都在 `assets/skin.css` + `assets/skin.js`，选择器一律用
`[class*="_xxx"]` / `[aria-label]` / `[data-slot]` 这类**稳定特征**（网页的类名是 CSS Module
哈希，每次构建都会变，写死必挂）。

| # | 改动 | 做法要点 |
| --- | --- | --- |
| 1 | 侧栏图标栏的图标下方加小字 | `button[aria-label]` 变纵向 flex，`::after { content: attr(aria-label) }`，9px |
| 2 | 点某个会话后自动收起侧栏 | 捕获阶段监听 `click`，命中 `[class*="_sessionRow"]` 且抽屉开着 → 90ms 后点收起按钮 |
| 3 | 打开/收起按钮都在左上角 | 抽屉态把 `_logoRow` 改 `justify-content: flex-start`，`_toggle` 用 `order: -1` |
| 4 | 抽屉里的「设置」搬到头像上方 | 合成点击账号菜单里的「设置」项，生成一个 `.dsh-settings-btn` 放在账号按钮上方 |
| 5 | 侧栏图标放大、边距收紧 | 图标 20px、`_quietBars` 左右 padding 3px |
| 6 | 对话/思考内容与输入框左对齐 | 量出输入框左边界，给消息列设 `padding-left`（注意 `parseFloat("") === NaN`） |
| 7 | 头部按钮归位 | 「成员」绝对定位贴住右侧边栏图标；「后台任务」挪到第二行最右（仅图标栏形态） |
| 8 | 设置面板左栏缩到 15% | `[role="dialog"] > [class*="_nav"] { flex: 0 0 15% }`，栏内改上下排（图标 15px + 9px 字） |
| 9 | 设置面板账号卡片换行 | `_card { flex-wrap: wrap }` + `_identity { flex: 1 1 100% }`，名字/号码不再被压成 0 宽 |
| 10 | 输入框下方状态行不跳 | `[class*="_composerStack"] [class*="_dock"] { min-height: 26px; box-sizing: border-box }` |
| 11 | 会话标题完整显示 | 头部两层布局：标题独占第一行（135px），后台任务挪到第二行 |
| 12 | 抽屉里字标不被切 | 字标 `flex: 1 1 auto; width: 0`（按剩余空间缩放，不依赖自然宽度） |
| 13 | 隐藏原按钮、代点 | `[data-dsh-moved="1"]` 压成 1px 透明；代点时用 `position: fixed` 挪到替身位置再真点击 |

**皮肤注入时机**：目前是 `onPageFinished` 注入 + 350/1200/2600ms 重试。因为皮肤**不改几何**
（不动栅格宽度、不动内边距），晚注入只会"文字/图标晚半秒出现"，不会出现"先画错再矫正"。
**如果以后要改几何，必须改成随 HTML 下发**。

---

## 7. 构建

不需要 Gradle、不需要 Android Studio。三样东西：JDK 17、Android build-tools 34、platform 34 的 `android.jar`。

```bash
bash tools/fetch-toolchain.sh        # 下载到 ./toolchain（国内镜像，约 300 MB，可重复执行）
```

也可以自己准备，然后用环境变量指过去（目录布局见下）：

```bash
export ANDROID_TOOLCHAIN=/path/to/toolchain
```

```
toolchain/
  jdk/jdk-17.0.2/            OpenJDK 17
  build-tools/android-14/    aapt2 / d8 / zipalign / apksigner / keytool
  platform/android-34/       android.jar
```

`build.sh` 找工具链的顺序：`$ANDROID_TOOLCHAIN` → `./toolchain` → `../tools/android`。

准备凭据（**只需一次**，真实域名和令牌不进源码）：

```bash
# 编辑 server.url / server.token 填你自己的
```

构建：

```bash
bash build.sh                    # 产物 out/dsh-shell.apk
```

七步（脚本里就是这七步）：

2. `aapt2 compile --dir res -o build/res.zip`
3. `aapt2 link -o build/base.apk -I android.jar --manifest AndroidManifest.xml build/res.zip --java build/gen -A assets ...`
4. `javac --release 8 -classpath android.jar -d build/classes <所有 .java + 生成文件>`
5. `d8 --release --min-api 24 --lib android.jar --output build/dex <classes>`
6. 用 Python `zipfile` 把 `classes.dex` 追加进 `base.apk`
7. `zipalign -f -p 4` → `apksigner sign`（首次自动 `keytool` 生成 keystore）

版本号只改 `AndroidManifest.xml` 的 `versionCode` / `versionName`，脚本会读出来。

---

## 8. 测试

两套，都不需要手机：

| 套件 | 命令 | 覆盖 |
| --- | --- | --- |
| JVM 冒烟 | `bash tools/jvm-check/run.sh` | 登录链路（303→Cookie）、缓存落盘、断网首屏、资源可缓存判定、MIME |
| 页面复验 | ego-browser 脚本 | 412×915 视口下量 DOM 坐标 |

---

## 9. 发版

1. 改 `AndroidManifest.xml` 的 `android:versionCode` / `android:versionName`
   （**必须改这里**，`aapt2 --version-code` 会被 manifest 覆盖）。
2. `bash dsh-android-shell/build.sh`。
3. 核对：`aapt2 dump badging out/dsh-shell.apk | head -1` 看 versionCode/versionName；
   `apksigner verify out/dsh-shell.apk`（需要 `JAVA_HOME`）。
4. 发给自己（QQ / 网盘 / adb install，随便哪种）。
5. 覆盖安装要求**同一签名 + versionCode 递增**；换 keystore 必须卸载重装。

---

## 10. 边界与已知限制

- **不改服务端**：DSH 插件、profile、nginx 一律不动。唯一的外部依赖是"域名能公网访问"
  （本项目自用的做法：nginx 反代到本机一个固定端口镜像）。
- **没有开关**：改动设计死，装上就是改后的样子。要试不同方案只能出不同 APK。
- **类名会变**：网页升级后 `wtg9ga_*` / `AnXs9G_*` 这些哈希会变，但皮肤用的是 `[class*="_xxx"]`
  片段，通常不用改；如果网页改了结构（比如换了 `_nav` 的名字），对应规则要跟着调。
- **皮肤晚注入**：见 §6 末尾。
- **缓存没有版本号**：改了皮肤后，手机上如果还留着旧的首屏 HTML 缓存，可能看不到新皮肤，
  需要清 App 数据或重装。
- **入口不在 APK 里**：地址和令牌由用户在第一次启动时填写，存在本机 SharedPreferences，仓库和安装包里都没有真实地址。

- **只做过 412×915 的验证**：其它尺寸没专门适配，平板/折叠屏表现未验证。

---

## 11. 版本历史（摘要）

| 版本 | 内容 |
| --- | --- |
| 1.0 | 最小可用：WebView + 登录 + 缓存 |
| 1.1 | 七处排版改动（小字、自动收起、左上角开合、设置按钮、图标放大、消息对齐、字标） |
| 1.2 | 侧栏宽度/内边距收紧（后被 1.3 撤销） |
| 1.3 | **撤销所有宽度/内边距改动**，改为原生 56/280；修好"打开抽屉 2 秒后矫正" |
| 1.4 | 头部按钮归位（成员贴右侧边栏图标、后台任务挪第二行） |
| 1.5 | 设置面板左栏 25% + 账号卡片换行 |
| 1.6 | 设置面板左栏 15%（改上下排图标 + 9px 小字） |
| 2.0 | **抽屉式重写**：侧栏变 280px 抽屉 + 遮罩，内容满屏；纯 CSS + data 属性（只新增 1 个设置按钮节点）；头部标题独占第一行；设置面板改全屏 sheet + 顶部 tab 条 |
| 2.1.3 | 「刷新」改为清空本机网页端全部 `dsh-dream-skin:*` 键再重新加载（网页回到出厂状态，等同新客户端），保存的预设存放在 `dsh-app:theme-presets`，不受影响 |
| 2.1.2 | 修三个 bug：①侧栏「设置」点开变成主题预设弹窗（合成按钮选择器误命中 `.dsh-preset-btn`）；②「刷新」改成重新加载当前预设；③设置面板打开时不再抢左上角入口、也不吞面板里的点击，插件页开关/条目恢复正常 |
| 2.1.1 | 新增「主题预设」：侧栏「设置」上方一个按钮，弹窗里 3 个槽位 + 保存/删除/刷新；预设只存本机（localStorage 里 `dsh-dream-skin:*` 的快照），所以手机能留住自己的主题。首次启动弹窗文案改为用户指定版本，断网兜底页文案也简化 |
| 2.1.0 | 入口地址改为**首次启动时由用户填写**（`Settings.java` + 弹窗），代码/仓库不再含任何真实域名或令牌；顺带修了缓存目录被系统清掉后静默写失败的问题 |
| 2.0.5 | 图标源图换成用户最新发的大头特写（`reference/icon-source.jpg`，可用 `ICON_SRC` 覆盖），其余同 2.0.4 |
| 2.0.4 | 图标回到照片风（`ICON_STYLE=photo`）：原图缩到目标尺寸的一半再 2x NEAREST 放大 = 原图标的一半清晰度；包体 87 KB → 166 KB |
| 2.0.3 | 图标画布 32→96、调色板 24→64（清晰度翻倍，观感接近原图的一半分辨率），包体 50 KB → 87 KB |
| 2.0.2 | 图标换成像素风（32×32 画布 + 24 色调色板 + NEAREST 放大），自适应图标背景改用纯色资源 ⇒ 安装包 505 KB → 50 KB |
| 2.0.1 | 头部第二行四个按钮改成 JS 固定定位（从右往左一行摆齐，y 全部 54px）；设置面板内容区可上下滑、顶部 tab 条可横向滑且不被 ✕ 压住 |

> 1.3 那次"撤销"是本项目最重要的一次修正：网页自己按 56/280 排版，任何外部改宽度都会让它的
> 内部测量和画面对不上，下一次重排就"矫正"一次。

---

## 12. 公开前检查清单

这份项目按"可以公开"的标准整理，把项目推出去之前过一遍：

1. 仓库里**不要出现任何真实域名/令牌**（代码、文档、脚本都别写）—— 入口由用户运行时填。

2. 文档里的地址/令牌都是 `你的域名` / `你的登录令牌` 占位符，`grep -rn "token=" *.md` 复查一遍。
3. `keystore/dsh.keystore` 是自签证书（口令 `dshshell`，公开的），
   **公开前请自己 `keytool` 生成一份**，否则任何人都能用你的签名打同包名 APK。
5. `build/`、`out/`、`toolchain/` 都不提交（已在 `.gitignore`）。
6. `out/` 里的构建产物不要提交（`.gitignore` 已挡）。
7. 别人拿到仓库后：`bash build.sh` 出包 → 装到手机 → 第一次打开填他自己的 DSH 网址。

---

## 13. 文档索引

| 文件 | 给谁看 | 内容 |
| --- | --- | --- |
| `README.md` | 使用者 | 怎么装、做了什么、已知限制 |
| `PROJECT.md`（本文） | 想了解全貌的人 | 定位、架构、目录、链路、改动清单、构建、测试、发版 |
| `HANDOVER.md` | 接手的工程师/Agent | 代码层细节、机制、逐条改动、构建坑、验证基线 |
