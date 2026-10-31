package com.dsh.shell;

import android.webkit.CookieManager;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * 最小 HTTP 客户端。
 *
 * 关键点：DSH Web 的入口是「token 换 cookie」——GET /?token=xxx 返回 303 + Set-Cookie，
 * 再访问 / 才是真正的页面。HttpURLConnection 自己跟重定向时不会带上新 cookie，
 * 所以这里手写重定向循环，把每一跳的 Set-Cookie 同时写进本机 jar 和 WebView 的 CookieManager。
 */
public final class Fetch {

    private static final int MAX_HOPS = 6;

    /** 由 MainActivity 用 WebView 的真实 UA 覆盖，保证服务端看到的是同一个客户端。 */
    public static volatile String userAgent;

    public static final class Result {
        public final int code;
        public final byte[] body;
        public final String finalUrl;

        Result(int code, byte[] body, String finalUrl) {
            this.code = code;
            this.body = body;
            this.finalUrl = finalUrl;
        }
    }

    private Fetch() {
    }

    public static Result get(String url, int connectMs, int readMs) {
        String current = url;
        Map<String, String> jar = new TreeMap<String, String>();
        for (int hop = 0; hop < MAX_HOPS; hop++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(current).openConnection();
                c.setConnectTimeout(connectMs);
                c.setReadTimeout(readMs);
                c.setInstanceFollowRedirects(false);
                c.setRequestMethod("GET");
                String cookie = cookieHeader(current, jar);
                if (cookie != null) {
                    c.setRequestProperty("Cookie", cookie);
                }
                c.setRequestProperty("Accept",
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
                c.setRequestProperty("Accept-Encoding", "identity");
                c.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
                String ua = userAgent;
                if (ua != null && ua.length() > 0) {
                    c.setRequestProperty("User-Agent", ua);
                }

                int code = c.getResponseCode();
                Map<String, List<String>> headers = c.getHeaderFields();
                absorb(current, headers, jar);

                String location = firstHeader(headers, "location");
                boolean redirect = code == 301 || code == 302 || code == 303 || code == 307 || code == 308;
                if (redirect && location != null) {
                    String next = resolve(current, location);
                    drain(c);
                    c.disconnect();
                    c = null;
                    if (next == null) {
                        return null;
                    }
                    current = next;
                    continue;
                }

                byte[] body = new byte[0];
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) {
                    try {
                        body = AssetCache.readAll(in);
                    } finally {
                        in.close();
                    }
                }
                c.disconnect();
                c = null;
                return new Result(code, body, current);
            } catch (IOException e) {
                return null;
            } catch (Throwable t) {
                return null;
            } finally {
                if (c != null) {
                    c.disconnect();
                }
            }
        }
        return null;
    }

    private static void drain(HttpURLConnection c) {
        try {
            InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                byte[] buf = new byte[1024];
                while (in.read(buf) > 0) {
                    // 丢弃重定向响应体
                }
                in.close();
            }
        } catch (Throwable ignored) {
        }
    }

    private static String cookieHeader(String url, Map<String, String> jar) {
        StringBuilder sb = new StringBuilder();
        try {
            String stored = CookieManager.getInstance().getCookie(url);
            if (stored != null && stored.length() > 0) {
                sb.append(stored);
            }
        } catch (Throwable ignored) {
        }
        for (Map.Entry<String, String> e : jar.entrySet()) {
            String name = e.getKey() + "=";
            if (sb.indexOf(name) >= 0) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append("; ");
            }
            sb.append(name).append(e.getValue());
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    /** 把这一跳的 Set-Cookie 收进本地 jar，并同步给 WebView。 */
    private static void absorb(String url, Map<String, List<String>> headers, Map<String, String> jar) {
        if (headers == null) {
            return;
        }
        CookieManager cm = null;
        try {
            cm = CookieManager.getInstance();
        } catch (Throwable ignored) {
        }
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            if (e.getKey() == null || !"set-cookie".equalsIgnoreCase(e.getKey())) {
                continue;
            }
            for (String raw : e.getValue()) {
                if (raw == null || raw.length() == 0) {
                    continue;
                }
                int semi = raw.indexOf(';');
                String pair = (semi >= 0 ? raw.substring(0, semi) : raw).trim();
                int eq = pair.indexOf('=');
                if (eq > 0) {
                    jar.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
                }
                if (cm != null) {
                    try {
                        cm.setCookie(url, raw);
                    } catch (Throwable ignored) {
                    }
                }
            }
        }
        if (cm != null) {
            try {
                cm.flush();
            } catch (Throwable ignored) {
            }
        }
    }

    private static String firstHeader(Map<String, List<String>> headers, String name) {
        if (headers == null) {
            return null;
        }
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            if (e.getKey() == null || !name.equalsIgnoreCase(e.getKey())) {
                continue;
            }
            List<String> values = e.getValue();
            if (values != null && !values.isEmpty()) {
                return values.get(0);
            }
        }
        return null;
    }

    private static String resolve(String base, String location) {
        try {
            String loc = location.trim();
            if (loc.length() == 0) {
                return null;
            }
            if (loc.toLowerCase(Locale.US).startsWith("http://")
                    || loc.toLowerCase(Locale.US).startsWith("https://")) {
                return loc;
            }
            return new URI(base).resolve(loc).toString();
        } catch (Throwable t) {
            return null;
        }
    }
}
