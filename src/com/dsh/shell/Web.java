package com.dsh.shell;

import java.util.Locale;

/**
 * 与 WebView 无关的纯逻辑：同源判定、缓存判定、MIME 推断、皮肤注入（可在 JVM 上直接测）。
 *
 * 站点地址不在代码里：用户第一次启动时填，运行时通过参数传进来（见 Settings）。
 */
public final class Web {

    private Web() {
    }

    /** 是否属于这个站点。 */
    public static boolean sameOrigin(String url, String origin) {
        return url != null && origin != null && origin.length() > 0 && url.startsWith(origin);
    }

    /** 主文档永远要落盘（断网首屏靠它），其余按 isCacheable 判定。 */
    public static boolean shouldStore(String url, boolean document, String origin) {
        return document || isCacheable(url, origin);
    }

    public static boolean isCacheable(String url, String origin) {
        if (!sameOrigin(url, origin)) return false;
        String u = url.toLowerCase(Locale.US);
        if (u.contains("/plugins/events") || u.contains("/api/")) return false;
        if (u.contains(".js") || u.contains(".css")) return true;
        int q = u.indexOf('?');
        String path = q >= 0 ? u.substring(0, q) : u;
        return path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".css")
                || path.endsWith(".woff") || path.endsWith(".woff2") || path.endsWith(".ttf")
                || path.endsWith(".otf") || path.endsWith(".png") || path.endsWith(".jpg")
                || path.endsWith(".jpeg") || path.endsWith(".webp") || path.endsWith(".gif")
                || path.endsWith(".svg") || path.endsWith(".ico") || path.endsWith(".json")
                || path.contains("/assets/");
    }

    static String mimeOf(String url) {
        String u = url.toLowerCase(Locale.US);
        int q = u.indexOf('?');
        if (q >= 0) u = u.substring(0, q);
        if (u.endsWith(".js") || u.endsWith(".mjs")) return "application/javascript";
        if (u.endsWith(".css")) return "text/css";
        if (u.endsWith(".json")) return "application/json";
        if (u.endsWith(".html") || u.endsWith(".htm") || u.endsWith("/")) return "text/html";
        if (u.endsWith(".svg")) return "image/svg+xml";
        if (u.endsWith(".png")) return "image/png";
        if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
        if (u.endsWith(".webp")) return "image/webp";
        if (u.endsWith(".gif")) return "image/gif";
        if (u.endsWith(".ico")) return "image/x-icon";
        if (u.endsWith(".woff2")) return "font/woff2";
        if (u.endsWith(".woff")) return "font/woff";
        if (u.endsWith(".ttf")) return "font/ttf";
        if (u.endsWith(".otf")) return "font/otf";
        return "text/html";
    }

    /**
     * 把皮肤直接写进 HTML（style 放 </head> 前、script 放 </body> 前）。
     *
     * 为什么不等 onPageFinished 再注入：抽屉布局要改栅格/位置，晚注入会先画出
     * 一帧原生布局再跳变；写进文档里第一帧就是最终形态。
     */
    public static byte[] withSkin(byte[] html, String css, String js) {
        if (html == null || html.length == 0) return html;
        String src = new String(html, java.nio.charset.StandardCharsets.UTF_8);
        if (src.contains("dsh-skin-style")) return html;
        String style = "<style id=\"dsh-skin-style\">" + safe(css, "</style") + "</style>";
        String script = "<script id=\"dsh-skin-script\">" + safe(js, "</script") + "</script>";
        String out = insertBefore(src, "</head", style);
        out = insertBefore(out, "</body", script);
        return out.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String safe(String code, String closing) {
        if (code == null) return "";
        return replaceIgnoreCase(code, closing, "<" + (char) 92 + "/" + closing.substring(2));
    }

    private static String insertBefore(String html, String marker, String payload) {
        int i = indexOfIgnoreCase(html, marker);
        if (i < 0) return html + payload;
        return html.substring(0, i) + payload + html.substring(i);
    }

    private static int indexOfIgnoreCase(String s, String needle) {
        return s.toLowerCase(Locale.US).indexOf(needle.toLowerCase(Locale.US));
    }

    private static String replaceIgnoreCase(String s, String from, String to) {
        StringBuilder sb = new StringBuilder();
        String low = s.toLowerCase(Locale.US);
        String f = from.toLowerCase(Locale.US);
        int i = 0;
        while (true) {
            int j = low.indexOf(f, i);
            if (j < 0) {
                sb.append(s, i, s.length());
                return sb.toString();
            }
            sb.append(s, i, j).append(to);
            i = j + from.length();
        }
    }
}
