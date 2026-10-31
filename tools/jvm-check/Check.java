package com.dsh.shell;

import android.content.Context;
import android.webkit.CookieManager;

import java.io.File;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * 在普通 JVM 上跑真实的纯逻辑代码（不需要模拟器/手机）。
 *
 * 两组用例：
 *  - 离线用例：皮肤注入、同源/缓存判定、资源解析、缓存读写 —— 任何环境都跑；
 *  - 联网用例：token → 303 → cookie → 首屏 HTML → 取资源 → 落盘 → 断网回放。
 *    需要自备地址：DSH_TEST_URL="https://你的域名/?token=xxxx" bash tools/jvm-check/run.sh
 *    没提供就跳过联网部分（不算失败）。
 */
public final class Check {

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 15; 23117RK66C Build/AP3A.240905.015) "
                    + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

    private static int failures;

    public static void main(String[] args) throws Exception {
        Fetch.userAgent = UA;

        String url = System.getenv("DSH_TEST_URL");
        if (url == null || url.length() == 0) {
            url = System.getProperty("dsh.url", "");
        }
        url = url.trim();
        String origin = originOf(url);

        offlineCases(origin);
        if (url.length() == 0) {
            System.out.println("SKIP 联网用例（没提供 DSH_TEST_URL）");
        } else {
            onlineCases(url, origin);
        }

        System.out.println(failures == 0 ? "ALL OK" : ("FAILURES: " + failures));
        System.exit(failures == 0 ? 0 : 1);
    }

    // ------------------------------------------------------------------ 离线用例

    private static void offlineCases(String origin) throws Exception {
        String o = origin.length() > 0 ? origin : "https://example.com";

        // 皮肤注入
        String html = "<!doctype html><html><head><title>t</title></head><body>hi</body></html>";
        byte[] out = Web.withSkin(html.getBytes("UTF-8"), "body{color:red}", "console.log(1)");
        String s = new String(out, "UTF-8");
        check(s.contains("<style id=\"dsh-skin-style\">body{color:red}</style></head>"), "皮肤 style 插在 </head> 前");
        check(s.contains("<script id=\"dsh-skin-script\">console.log(1)</script></body>"), "皮肤 script 插在 </body> 前");
        check(s.contains("hi"), "原内容保留");
        byte[] twice = Web.withSkin(out, "body{color:red}", "console.log(1)");
        check(new String(twice, "UTF-8").equals(s), "重复注入幂等");
        String broken = "<html><head><style>x{}</style></head><body></body></html>";
        String esc = new String(Web.withSkin(broken.getBytes("UTF-8"), "a{}</style><b>", "x</script><y>"), "UTF-8");
        check(!esc.contains("</style><b>") && !esc.contains("</script><y>"), "结束标记被转义");

        // 同源与缓存判定
        check(Web.sameOrigin(o + "/?token=x", o), "同源判定");
        check(!Web.sameOrigin("https://other.example/x", o), "跨站不算同源");
        check(Web.isCacheable(o + "/assets/index-abc.js", o), ".js 可缓存");
        check(Web.isCacheable(o + "/assets/vendor.css", o), ".css 可缓存");
        check(Web.isCacheable(o + "/plugins/??a/client.js,b/client.js", o), "合并 URL 可缓存");
        check(!Web.isCacheable(o + "/plugins/events", o), "/plugins/events 不缓存");
        check(!Web.isCacheable(o + "/api/state", o), "/api/ 不缓存");
        check(Web.shouldStore(o + "/", true, o), "主文档总是落盘");
        check(!Web.shouldStore(o + "/api/x", false, o), "接口不落盘");

        // 资源解析
        String doc = "<base href=\"./\"><link rel=preload href=\"plugins/??a/client.js&amp;rev=1\">"
                + "<script src=\"./assets/index.js\"></script><img src=\"/x/y.png\">";
        List<String> urls = Preloader.extract(doc, o + "/");
        check(urls.contains(o + "/plugins/??a/client.js&rev=1"), "解析相对路径 + 反转义 &amp;");
        check(urls.contains(o + "/assets/index.js"), "解析 ./ 前缀");
        check(urls.contains(o + "/x/y.png"), "解析根路径");

        // 缓存读写
        File dir = new File("build/jvm-check/cache");
        deleteTree(dir);
        dir.mkdirs();
        Context ctx = new Context(dir);
        AssetCache cache = AssetCache.get(ctx);
        String key = o + "/assets/a.js";
        cache.write(key, "var a=1".getBytes("UTF-8"));
        byte[] back = cache.read(key);
        check(back != null && new String(back, "UTF-8").equals("var a=1"), "缓存写入后能读回");
        check(cache.savedAt(key) > 0L, "缓存有时间戳");
    }

    // ------------------------------------------------------------------ 联网用例

    private static void onlineCases(String url, String origin) throws Exception {
        Fetch.Result doc = Fetch.get(url, 9000, 20000);
        if (doc == null) {
            check(false, "首屏请求返回 null");
            return;
        }
        String html = new String(doc.body, "UTF-8");
        System.out.println("首屏: code=" + doc.code + " finalUrl=" + doc.finalUrl
                + " bytes=" + doc.body.length);
        check(doc.code == 200, "首屏状态码 200");
        check(html.contains("__DSH_BOOT__"), "首屏含 __DSH_BOOT__");
        check(!html.contains("authentication required"), "首屏不是 401 页面");
        String cookie = CookieManager.getInstance().getCookie(origin + "/");
        check(cookie != null && cookie.contains("dsh-auth-"), "303 换到了鉴权 cookie");

        Fetch.Result root = Fetch.get(origin + "/", 9000, 20000);
        check(root != null && root.code == 200, "裸根路径仅靠 cookie 也能 200");

        List<String> urls = Preloader.extract(html, url);
        System.out.println("解析出资源 " + urls.size() + " 个");
        check(urls.size() >= 4, "至少解析出 4 个资源");
        int cacheable = 0;
        for (String u : urls) {
            if (Web.isCacheable(u, origin)) {
                cacheable++;
            }
        }
        System.out.println("其中可缓存 " + cacheable + " 个");
        check(cacheable >= 3, "至少 3 个资源可缓存");

        File dir = new File("build/jvm-check/cache");
        deleteTree(dir);
        dir.mkdirs();
        Context ctx = new Context(dir);
        AssetCache cache = AssetCache.get(ctx);

        List<String> subset = new ArrayList<String>();
        for (String u : urls) {
            if (Web.isCacheable(u, origin) && subset.size() < 3) {
                subset.add(u);
            }
        }
        Preloader.cache(ctx, subset, origin);
        int cached = 0;
        long bytes = 0L;
        for (String u : subset) {
            byte[] body = cache.read(u);
            if (body != null) {
                cached++;
                bytes += body.length;
            }
        }
        System.out.println("预取落盘 " + cached + "/" + subset.size() + " 个，共 " + bytes + " 字节");
        check(cached == subset.size(), "预取资源全部落盘");
        check(bytes > 0L, "落盘字节数大于 0");

        // ---------- 断网模拟：同一个 Policy，换成「永远失败」的 Loader ----------
        byte[] docOnline = Policy.load(Policy.NETWORK, cache, url, true, origin);
        check(docOnline != null && docOnline.length > 40000, "在线首屏被写入缓存");
        List<String> res2 = Preloader.extract(new String(docOnline, "UTF-8"), url);
        List<String> keep = new ArrayList<String>();
        for (String u : res2) {
            if (Web.isCacheable(u, origin) && keep.size() < 2) {
                keep.add(u);
            }
        }
        for (String u : keep) {
            Policy.load(Policy.NETWORK, cache, u, false, origin);
        }
        Policy.Loader offline = new Policy.Loader() {
            @Override
            public Fetch.Result get(String u, int connectMs, int readMs) {
                return null;
            }
        };
        byte[] docOffline = Policy.load(offline, cache, url, true, origin);
        check(docOffline != null && new String(docOffline, "UTF-8").contains("__DSH_BOOT__"),
                "断网时首屏来自缓存（含 __DSH_BOOT__）");
        int fromCache = 0;
        for (String u : keep) {
            byte[] b = Policy.load(offline, cache, u, false, origin);
            if (b != null && b.length > 0) {
                fromCache++;
            }
        }
        System.out.println("断网时命中缓存资源 " + fromCache + "/" + keep.size() + " 个");
        check(keep.size() > 0 && fromCache == keep.size(), "断网时静态资源全部来自缓存");
    }

    // ------------------------------------------------------------------ 工具

    private static String originOf(String url) {
        try {
            URI u = new URI(url);
            String scheme = u.getScheme();
            String authority = u.getAuthority();
            if (scheme == null || authority == null) {
                return "";
            }
            return scheme + "://" + authority;
        } catch (Throwable t) {
            return "";
        }
    }

    private static void check(boolean ok, String what) {
        System.out.println((ok ? "  ok   " : "  FAIL ") + what);
        if (!ok) {
            failures++;
        }
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) {
            for (File k : kids) {
                deleteTree(k);
            }
        }
        f.delete();
    }
}
