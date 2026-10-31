# dsh webapp（包名 com.dsh.shell）

一个把 DSH 网页装进手机的小 App——**就是 web 套壳**，没有别的花样。

## 它是什么

第一次启动填一次你自己的 DSH 网址，之后打开就是那个界面，不用再登录；界面资源缓存在手机本地，
断网也能先把界面画出来；顺手把几处手机上不好用的排版改掉。

## 为什么值得套个壳

**一是缓存能一键开好。** 界面资源存在手机本地，网络不好、甚至断网的时候，打开先能看到界面，不至于白屏干等。

**二是网页在手机上有些地方确实别扭，顺手调舒服一点。** 侧栏改成抽屉、图标下面补一行名字、点开会话自动收起、
设置面板能正常滑动——都是些小事，但一天点几十次就不算小事了。

## 为什么不干脆重写一个客户端

**不臃肿。** 它只有几百 KB，装完几乎不占地方，也不会凭空多出一整套要跟着桌面端同步维护的界面逻辑。

**因为它本来就不是一个独立应用。** 桌面端才是主体，这个是它的延伸——不在电脑前的时候，掏手机看一眼
电脑在干什么、接着往下说两句。做的是窗口，不是分身。

> 想了解全貌看 [`PROJECT.md`](PROJECT.md)（架构、目录、改动清单、构建、发版）；
> 要改代码看 [`HANDOVER.md`](HANDOVER.md)（代码层细节）。

- 安装包：`out/dsh-shell.apk`（169 KB，**v2.1.3** / versionCode 18，签名 v2+v3，minSdk 24 / targetSdk 34）
- 入口由用户自己填：**第一次启动弹一次输入框**，粘贴 `https://你的域名/?token=xxxx` 即可，
  存在 SharedPreferences 里（`Settings.java`），之后每次启动直接用。**仓库里不含任何真实地址**
- 没有设置页、没有开关 —— 只有那一次地址输入；填错（打开后只剩一行英文提示）会自动再弹一次让你改

## 手机上的布局

手机端是**抽屉式**的：内容占满整屏，侧边栏平时藏在屏幕左边外面，点左上角三条杠滑出来，
点会话/点空白自动收回。

| 位置 | 手机上的行为 |
| --- | --- |
| 左上角 | 三条杠入口；抽屉打开时同一位置变成「收起」 |
| 会话标题 | 独占第一行，完整显示（不被按钮挤成省略号） |
| 第二行 | 对话/上下文 + 成员、文件夹、更多、后台任务依次靠右 |
| 设置 | 小屏变全屏 sheet：顶部横向 tab 条 + 内容区通栏 |
| 消息区 | 与输入框左边界对齐 |
| 头部按钮 | 成员 / 文件夹 / 更多 / 后台任务 由 JS 从右往左摆成一行（y=54，间距 6，右边缘 404） |
| 设置滚动 | 内容区可上下滑；顶部 tab 条可横向滑，最后一个 tab 不会被 ✕ 压住 |
| 主题预设 | 「设置」上面多一个按钮，点开是小弹窗：3 个槽位 + 保存 / 删除 / 刷新。槽位有内容时点一下即切换（整页重载生效）；空槽位点了不做事；保存 = 用当前外观覆盖该槽位；删除 = 清空该槽位；刷新 = 清掉本机主题痕迹后重新加载（预设另存，不受影响） |

截图见 [`docs/shots/`](docs/shots)：`2.0-closed.png`、`2.0-drawer.png`、`2.0-session.png`、`2.0-settings.png`。

## 它做了什么

### 1. 登录：跟着浏览器的老路走，但不靠浏览器

DSH 的 `?token=` 不是直接放行，而是**回一个 303 把 token 换成 Cookie**（`dsh-auth-…`，HttpOnly、
30 天有效），之后所有请求靠这个 Cookie。安卓自带的 `HttpURLConnection` 跟随 303 时不会带上新
Cookie，会落到 401 页面，所以这里手写了重定向循环：每一跳自己带 Cookie、自己收 `Set-Cookie`，
并且同步给 `CookieManager`，让 WebView 里的 XHR/WebSocket 也带着它。

### 2. 缓存：断网也能先显示界面

- 拦截同源 GET，把首屏 HTML 和 JS/CSS/字体/图标写进 App 私有缓存目录（`cacheDir/webcache`，
  键是 URL 的 SHA-1，先写 `.tmp` 再改名，断电不会留半个文件）。
- **首屏**：有网时网络优先（9 秒连接 / 20 秒读取超时），失败或超时立刻回退本地缓存；
  **没网时直接跳过网络**（`ConnectivityManager` 判定），不用干等超时。
- **静态资源**：缓存优先，秒开；超过 6 小时在后台静默刷新一次。
- 装好后第一次在线打开，会在后台把整站 UI 资源（约 12 MB，主要是那几个合并的插件 bundle）预取下来；
  之后每次启动只补缺的。页面加载完成还会用 `performance.getEntriesByType('resource')` 把实际
  加载过的资源回填进缓存，避免漏网。
- 没网又从来没缓存过时，显示一张深色的「现在没有网络」提示页，而不是系统错误页。
- 返回键：有历史就后退，否则退到后台（`moveTaskToBack`），页面和 WebSocket 都留着，
  再点开是热启动、不会重新加载 —— 这解决「每次打开都要重新加载」。

## 已知限制

- 一个 App 只记一个入口。换地址/令牌不用改代码、不用重新编译：清掉 App 数据（或卸载重装）
  会重新弹输入框；填错时打开会看到一行英文提示，App 会自动再弹一次。
- 服务端部署新版本后，首屏 HTML 会拿到新的资源哈希，首次打开走网络、正常；离线时用的是上次缓存，
  界面可能比线上旧一点（下次联网自动追平）。

## 文件

```
dsh-android-shell/
  AndroidManifest.xml          单 Activity，singleTask，configChanges 全给（旋转不重建）
  build.sh                     手工构建脚本（7 步，不用 Gradle）
  keystore/dsh.keystore        自签证书（alias dsh，口令 dshshell）
  assets/skin.css|skin.js      13 处排版改动（样式 + 状态同步脚本）
  res/values/…                 主题（深色，无 ActionBar）、颜色、字符串
  res/mipmap-*/ic_launcher*    图标（tools/make-icons.py 由源图生成）
  src/com/dsh/shell/
    MainActivity.java          WebView 外壳、返回键保活、文字缩放锁定 100%
    SkinWebClient.java         拦截同源 GET、断网检测、注入皮肤、回填缓存
    Policy.java                取数策略（文档网络优先、资源缓存优先），可测
    Fetch.java                 手写重定向循环 + Cookie 收发的 HTTP 客户端
    AssetCache.java            磁盘缓存（SHA-1 键、原子写）
    Preloader.java             启动预取 + 从 HTML 抽资源 + URL 解析
    Settings.java              用户填的入口地址（SharedPreferences）+ 地址规范化
    Web.java                   同源/缓存判定、MIME 推断、皮肤注入
  tools/
    fetch-toolchain.sh         下载 JDK + build-tools + platform 到 ./toolchain
    jvm-check/                 JVM 冒烟测试（stubs + Check + run.sh）
    make-icons.py              图标生成（圆角方形 + 自适应图标）
  toolchain/                   下载的工具链（不提交）
  reference/icon-source.jpg    图标源图（tools/make-icons.py 读它）
  out/dsh-shell.apk            构建产物
```

## 文档

| 文件 | 给谁看 |
| --- | --- |
| `README.md` | 你：它是什么、改了什么、手机上的布局 |
| `PROJECT.md` | 项目全貌：架构、目录、运行链路、13 处改动、构建、测试、发版、公开前检查清单 |
| `HANDOVER.md` | 接手维护的人：代码层细节、函数清单、逐字节回归方法 |

