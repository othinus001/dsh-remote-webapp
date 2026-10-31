package android.webkit;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/** 仅供 JVM 冒烟测试的极简 CookieManager 替身（按 host 存 name=value）。 */
public final class CookieManager {

    private static final Map<String, Map<String, String>> STORE =
            new LinkedHashMap<String, Map<String, String>>();

    private static final CookieManager INSTANCE = new CookieManager();

    public static CookieManager getInstance() {
        return INSTANCE;
    }

    private static String hostOf(String url) {
        try {
            return new URI(url).getHost();
        } catch (Exception e) {
            return "";
        }
    }

    public String getCookie(String url) {
        Map<String, String> jar = STORE.get(hostOf(url));
        if (jar == null || jar.isEmpty()) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : jar.entrySet()) {
            if (sb.length() > 0) {
                sb.append("; ");
            }
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    public void setCookie(String url, String value) {
        if (value == null) {
            return;
        }
        int semi = value.indexOf(';');
        String pair = (semi >= 0 ? value.substring(0, semi) : value).trim();
        int eq = pair.indexOf('=');
        if (eq <= 0) {
            return;
        }
        String host = hostOf(url);
        Map<String, String> jar = STORE.get(host);
        if (jar == null) {
            jar = new LinkedHashMap<String, String>();
            STORE.put(host, jar);
        }
        jar.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
    }

    public void setAcceptCookie(boolean accept) {
    }

    public void flush() {
    }

    public static String dump() {
        return STORE.toString();
    }
}
