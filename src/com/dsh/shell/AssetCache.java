package com.dsh.shell;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;

/** 极简磁盘缓存：URL -> 文件，用于断网/慢网时秒开界面。 */
public final class AssetCache {

    private static AssetCache sInstance;
    private final File dir;

    private AssetCache(File dir) {
        this.dir = dir;
        if (!dir.isDirectory()) {
            dir.mkdirs();
        }
    }

    public static synchronized AssetCache get(Context ctx) {
        if (sInstance == null) {
            sInstance = new AssetCache(new File(ctx.getApplicationContext().getCacheDir(), "webcache"));
        }
        return sInstance;
    }

    private File fileFor(String url) {
        return new File(dir, sha1(url) + ".bin");
    }

    public static String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] b = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(b.length * 2);
            for (byte x : b) {
                sb.append(Character.forDigit((x >> 4) & 0xF, 16));
                sb.append(Character.forDigit(x & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    public byte[] read(String url) {
        File f = fileFor(url);
        if (!f.isFile() || f.length() == 0L) {
            return null;
        }
        try {
            FileInputStream in = new FileInputStream(f);
            try {
                return readAll(in);
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        }
    }

    public long savedAt(String url) {
        File f = fileFor(url);
        return f.isFile() ? f.lastModified() : 0L;
    }

    public void write(String url, byte[] body) {
        if (body == null || body.length == 0) {
            return;
        }
        // 目录可能被系统清理过，写之前补一下，不然会静默失败
        if (!dir.isDirectory()) {
            dir.mkdirs();
        }
        File f = fileFor(url);
        File tmp = new File(dir, f.getName() + ".tmp");
        try {
            FileOutputStream out = new FileOutputStream(tmp);
            try {
                out.write(body);
            } finally {
                out.close();
            }
            if (f.exists()) {
                f.delete();
            }
            if (!tmp.renameTo(f)) {
                tmp.delete();
            }
        } catch (Exception ignored) {
            tmp.delete();
        }
    }

    public static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(16384);
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) {
            bo.write(buf, 0, n);
        }
        return bo.toByteArray();
    }
}
