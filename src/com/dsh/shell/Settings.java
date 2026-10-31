package com.dsh.shell;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.URI;

/**
 * 用户填的站点地址。
 *
 * 第一次启动时弹窗让用户粘贴自己的 DSH Web 地址（形如 https://你的域名/?token=xxxx），
 * 存进 SharedPreferences，之后每次启动直接用，不再打扰。代码里不写任何真实地址。
 */
public final class Settings {

    private static final String FILE = "dsh-shell";
    private static final String KEY_URL = "start_url";

    private Settings() {
    }

    /** 已保存的入口地址；没填过返回空串。 */
    public static String startUrl(Context ctx) {
        try {
            SharedPreferences sp = prefs(ctx);
            String v = sp.getString(KEY_URL, "");
            return v == null ? "" : v.trim();
        } catch (Throwable t) {
            return "";
        }
    }

    public static void save(Context ctx, String url) {
        try {
            prefs(ctx).edit().putString(KEY_URL, normalize(url)).apply();
        } catch (Throwable ignored) {
        }
    }

    public static void clear(Context ctx) {
        try {
            prefs(ctx).edit().remove(KEY_URL).apply();
        } catch (Throwable ignored) {
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** 补全 scheme、去掉首尾空白；不是合法 http(s) 地址时返回空串。 */
    public static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        String s = raw.trim();
        if (s.length() == 0) {
            return "";
        }
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            s = "https://" + s;
        }
        try {
            URI u = new URI(s);
            if (u.getHost() == null || u.getHost().length() == 0) {
                return "";
            }
        } catch (Throwable t) {
            return "";
        }
        return s;
    }

    /** 取 scheme://host[:port]，用于判定同源；解析失败返回空串。 */
    public static String origin(String url) {
        try {
            URI u = new URI(url);
            String scheme = u.getScheme();
            String authority = u.getAuthority();
            if (scheme == null || authority == null || authority.length() == 0) {
                return "";
            }
            return scheme + "://" + authority;
        } catch (Throwable t) {
            return "";
        }
    }
}
