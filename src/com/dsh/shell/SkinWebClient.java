package com.dsh.shell;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 拦截同源 GET：
 *  - 主文档：网络优先（9s 连接 / 20s 读取），失败或超时立刻回退磁盘缓存 ⇒ 断网也能先画出界面；
 *  - 静态资源：缓存优先（秒开），超过 6 小时在后台静默刷新；
 *  - 页面加载完成后注入 assets/skin.css + skin.js，并把已加载资源回填缓存。
 */
public final class SkinWebClient extends WebViewClient {

    private static final long REFRESH_AFTER_MS = 6L * 60L * 60L * 1000L;

    private final Context ctx;
    private final AssetCache cache;
    private final String origin;
    private final Handler ui = new Handler(Looper.getMainLooper());

    /** 检测到「需要登录」页时回调，让 Activity 重新弹窗让用户改地址。 */
    public Runnable onAuthRequired;

    /** 整页都没加载出来（连不上、也没有缓存）时回调，同样让用户重新填一次地址。 */
    public Runnable onLoadFailed;

    private volatile boolean loadFailedReported;

    private String skinCss;
    private String skinJs;
    private volatile boolean harvesting;

    public SkinWebClient(Context c, String origin) {
        this.ctx = c.getApplicationContext();
        this.cache = AssetCache.get(ctx);
        this.origin = origin == null ? "" : origin;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            if (request == null || request.getUrl() == null) {
                return null;
            }
            String url = request.getUrl().toString();
            if (!Web.sameOrigin(url, origin)) {
                return null;
            }
            String method = request.getMethod();
            if (method != null && !"GET".equalsIgnoreCase(method)) {
                return null;
            }
            boolean document = request.isForMainFrame();
            boolean cachedBefore = cache.savedAt(url) > 0L;
            Policy.Loader loader = hasNetwork() ? Policy.NETWORK : Policy.OFFLINE;
            byte[] body = Policy.load(loader, cache, url, document, origin);
            if (body == null) {
                if (document) {
                    notifyLoadFailed();
                    return offlinePage();
                }
                return null;
            }
            if (!document && cachedBefore) {
                maybeRefresh(url);
            }
            if (document) {
                loadFailedReported = false;
                ensureSkinLoaded();
                body = Web.withSkin(body, skinCss, skinJs);
            }
            return toResponse(url, body);
        } catch (Throwable t) {
            return null;
        }
    }

    /** 整页失败只上报一次，避免同一次加载里反复弹窗。 */
    private void notifyLoadFailed() {
        if (loadFailedReported) {
            return;
        }
        loadFailedReported = true;
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (onLoadFailed != null) {
                    onLoadFailed.run();
                }
            }
        });
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request,
                                android.webkit.WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request != null && request.isForMainFrame()) {
            notifyLoadFailed();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
        super.onReceivedError(view, errorCode, description, failingUrl);
        notifyLoadFailed();
    }

    private boolean hasNetwork() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) {
                return true;
            }
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        } catch (Throwable t) {
            return true;
        }
    }

    /** 没网又没缓存时的兜底页面，别让用户看系统错误页。 */
    private static WebResourceResponse offlinePage() {
        String html = "<!doctype html><meta charset=utf-8>"
                + "<meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>html,body{height:100%;margin:0;background:#15161A;color:#E6E8EE;"
                + "font:15px/1.7 system-ui,-apple-system,sans-serif;display:flex;align-items:center;"
                + "justify-content:center;text-align:center}div{padding:24px;max-width:320px}"
                + "b{display:block;font-size:17px;margin-bottom:10px;color:#fff}"
                + "span{color:#9AA3B2;font-size:13px}</style>"
                + "<div><b>没连上</b><span>可能没连接成功。稍等一下，会弹出输入框让你重新填地址。</span></div>";
        return new WebResourceResponse("text/html", "utf-8",
                new ByteArrayInputStream(html.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    private byte[] fetchAndStore(String url, boolean document) {
        return Policy.fetch(Policy.NETWORK, cache, url, document, origin);
    }

    private void maybeRefresh(final String url) {
        if (System.currentTimeMillis() - cache.savedAt(url) < REFRESH_AFTER_MS) {
            return;
        }
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                fetchAndStore(url, false);
            }
        }, "dsh-refresh");
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        checkAuthPage(view);
        injectSkin(view);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                injectSkin(view);
            }
        }, 350L);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                injectSkin(view);
            }
        }, 1200L);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                injectSkin(view);
            }
        }, 2600L);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                harvest(view);
            }
        }, 3000L);
    }

    /** DSH 的 401 页只有一行英文提示，看到它就说明地址或 token 不对。 */
    private void checkAuthPage(WebView view) {
        try {
            view.evaluateJavascript(
                    "(document.body&&document.body.innerText||'').indexOf('authentication required')>=0",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if ("true".equals(value) && onAuthRequired != null) {
                                onAuthRequired.run();
                            }
                        }
                    });
        } catch (Throwable ignored) {
        }
    }

    private void ensureSkinLoaded() {
        if (skinJs == null) {
            skinCss = readAsset("skin.css");
            skinJs = readAsset("skin.js");
        }
    }

    private void injectSkin(WebView view) {
        ensureSkinLoaded();
        if (skinJs == null || skinJs.length() == 0) {
            return;
        }
        String code = "(function(){try{var s=document.getElementById('dsh-skin-style');"
                + "if(!s){s=document.createElement('style');s.id='dsh-skin-style';"
                + "(document.head||document.documentElement).appendChild(s);}"
                + "s.textContent=" + JSONObject.quote(skinCss == null ? "" : skinCss) + ";}catch(e){}\n"
                + skinJs + "\n})();";
        try {
            view.evaluateJavascript(code, null);
        } catch (Throwable ignored) {
        }
    }

    private void harvest(final WebView view) {
        if (harvesting) {
            return;
        }
        harvesting = true;
        try {
            view.evaluateJavascript(
                    "(function(){try{var o=[];var es=performance.getEntriesByType('resource')||[];"
                            + "for(var i=0;i<es.length;i++){var n=es[i].name;"
                            + "if(typeof n==='string'&&n.indexOf('http')===0)o.push(n);}"
                            + "return JSON.stringify(o.slice(0,400));}catch(e){return '[]';}})()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            harvesting = false;
                            List<String> urls = parseUrlList(value);
                            if (!urls.isEmpty()) {
                                Preloader.cacheUrls(ctx, urls, origin);
                            }
                        }
                    });
        } catch (Throwable t) {
            harvesting = false;
        }
    }

    static List<String> parseUrlList(String jsValue) {
        List<String> out = new ArrayList<String>();
        if (jsValue == null || jsValue.length() == 0) {
            return out;
        }
        try {
            Object decoded = new JSONTokener(jsValue).nextValue();
            if (!(decoded instanceof String)) {
                return out;
            }
            JSONArray arr = new JSONArray((String) decoded);
            for (int i = 0; i < arr.length(); i++) {
                String u = arr.optString(i, null);
                if (u != null && u.length() > 0) {
                    out.add(u);
                }
            }
        } catch (Throwable ignored) {
        }
        return out;
    }

    private String readAsset(String name) {
        try {
            InputStream in = ctx.getAssets().open(name);
            try {
                return new String(AssetCache.readAll(in), "UTF-8");
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            return null;
        }
    }

    private static WebResourceResponse toResponse(String url, byte[] body) {
        String mime = Web.mimeOf(url);
        boolean text = mime.startsWith("text/") || mime.contains("javascript")
                || mime.contains("json") || mime.contains("xml") || mime.contains("svg");
        return new WebResourceResponse(mime, text ? "utf-8" : null, new ByteArrayInputStream(body));
    }

}
