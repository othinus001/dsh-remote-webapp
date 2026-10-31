package com.dsh.shell;

/**
 * 纯逻辑的取数策略（不依赖 WebView，可在 JVM 上直接测）：
 *  - 主文档：网络优先，失败/超时回退磁盘缓存；
 *  - 静态资源：缓存优先，没有才走网络。
 * 拿到网络结果后顺带写缓存，所以「第一次在线打开」之后就有断网首屏的底子。
 */
public final class Policy {

    /** 取数函数，生产环境是 {@link Fetch#get}，测试里可以换成「永远失败」来模拟断网。 */
    public interface Loader {
        Fetch.Result get(String url, int connectMs, int readMs);
    }

    public static final Loader NETWORK = new Loader() {
        @Override
        public Fetch.Result get(String url, int connectMs, int readMs) {
            return Fetch.get(url, connectMs, readMs);
        }
    };

    /** 断网时用的取数函数：立刻返回 null，让缓存直接顶上，不用等超时。 */
    public static final Loader OFFLINE = new Loader() {
        @Override
        public Fetch.Result get(String url, int connectMs, int readMs) {
            return null;
        }
    };

    private Policy() {
    }

    /**
     * @return 要交给 WebView 的响应体；null 表示交给 WebView 自己处理（或确实拿不到）。
     */
    public static byte[] load(Loader loader, AssetCache cache, String url, boolean document, String origin) {
        byte[] cached = cache == null ? null : cache.read(url);
        if (!document && cached != null) {
            return cached;
        }
        byte[] fresh = fetch(loader, cache, url, document, origin);
        if (fresh != null) {
            return fresh;
        }
        return cached;
    }

    /** 走网络并把成功结果写入缓存；失败返回 null。 */
    public static byte[] fetch(Loader loader, AssetCache cache, String url, boolean document, String origin) {
        if (loader == null) {
            return null;
        }
        try {
            Fetch.Result r = loader.get(url,
                    document ? 9000 : 15000,
                    document ? 20000 : 30000);
            if (r == null || r.code < 200 || r.code >= 300 || r.body == null || r.body.length == 0) {
                return null;
            }
            if (cache != null && Web.shouldStore(url, document, origin)) {
                cache.write(url, r.body);
            }
            return r.body;
        } catch (Throwable t) {
            return null;
        }
    }
}
