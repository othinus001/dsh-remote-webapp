package com.dsh.shell;

import android.content.Context;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 后台预取首屏 HTML 及它引用的资源，落盘后断网也能先显示界面。 */
public final class Preloader {

    private static final long THROTTLE_MS = 60L * 60L * 1000L;
    private static final int MAX_FILES = 200;
    private static final long MAX_BYTES = 64L * 1024L * 1024L;
    private static final Pattern ATTR =
            Pattern.compile("(?:src|href)\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);

    private static long sLastRun;

    private Preloader() {
    }

    public static void kick(Context ctx, String startUrl, String origin) {
        if (startUrl == null || startUrl.length() == 0) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - sLastRun < THROTTLE_MS) {
            return;
        }
        sLastRun = now;
        final Context app = ctx.getApplicationContext();
        final String url = startUrl;
        final String org = origin;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                Preloader.run(app, url, org);
            }
        }, "dsh-preload");
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();
    }

    public static void cacheUrls(Context ctx, List<String> urls, String origin) {
        final Context app = ctx.getApplicationContext();
        final List<String> copy = new ArrayList<String>(urls);
        final String org = origin;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                Preloader.cache(app, copy, org);
            }
        }, "dsh-cache");
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();
    }

    static void run(Context app, String startUrl, String origin) {
        try {
            byte[] html = fetch(app, startUrl, true, origin);
            if (html == null) {
                return;
            }
            List<String> urls = extract(new String(html, "UTF-8"), startUrl);
            cache(app, urls, origin);
        } catch (Throwable ignored) {
        }
    }

    static void cache(Context app, List<String> urls, String origin) {
        if (urls == null || urls.isEmpty()) {
            return;
        }
        AssetCache cache = AssetCache.get(app);
        long total = 0L;
        int n = 0;
        Set<String> seen = new HashSet<String>();
        for (String url : urls) {
            if (n >= MAX_FILES || total >= MAX_BYTES) {
                break;
            }
            if (!Web.sameOrigin(url, origin)) {
                continue;
            }
            if (!seen.add(url)) {
                continue;
            }
            if (!Web.isCacheable(url, origin)) {
                continue;
            }
            if (cache.savedAt(url) > 0L) {
                continue;
            }
            byte[] body = fetch(app, url, false, origin);
            if (body == null) {
                continue;
            }
            total += body.length;
            n++;
        }
    }

    private static byte[] fetch(Context app, String url, boolean document, String origin) {
        try {
            Fetch.Result r = Fetch.get(url, document ? 9000 : 15000, document ? 20000 : 30000);
            if (r == null || r.code < 200 || r.code >= 300 || r.body == null || r.body.length == 0) {
                return null;
            }
            if (Web.shouldStore(url, document, origin)) {
                AssetCache.get(app).write(url, r.body);
            }
            return r.body;
        } catch (Throwable t) {
            return null;
        }
    }

    static List<String> extract(String html, String base) {
        Set<String> out = new LinkedHashSet<String>();
        if (html == null) {
            return new ArrayList<String>(out);
        }
        Matcher m = ATTR.matcher(html);
        while (m.find()) {
            String raw = unescape(m.group(1).trim());
            if (raw.length() == 0 || raw.startsWith("#") || raw.startsWith("data:")
                    || raw.startsWith("blob:") || raw.startsWith("javascript:")) {
                continue;
            }
            String abs = resolve(base, raw);
            if (abs != null) {
                out.add(abs);
            }
        }
        return new ArrayList<String>(out);
    }

    static String unescape(String s) {
        return s.replace("&amp;", "&").replace("&#38;", "&").replace("&quot;", "\"").replace("&#39;", "'");
    }

    static String resolve(String base, String raw) {
        try {
            if (raw.startsWith("//")) {
                return "https:" + raw;
            }
            if (raw.startsWith("http://") || raw.startsWith("https://")) {
                return raw;
            }
            URI b = new URI(base);
            String authority = b.getAuthority();
            String scheme = b.getScheme() == null ? "https" : b.getScheme();
            if (raw.startsWith("/")) {
                return scheme + "://" + authority + raw;
            }
            String path = b.getPath() == null ? "/" : b.getPath();
            int slash = path.lastIndexOf('/');
            String dir = slash >= 0 ? path.substring(0, slash + 1) : "/";
            String rel = raw.startsWith("./") ? raw.substring(2) : raw;
            return scheme + "://" + authority + dir + rel;
        } catch (Throwable t) {
            return null;
        }
    }
}
