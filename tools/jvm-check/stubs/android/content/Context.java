package android.content;

import java.io.File;

/** 仅供 JVM 冒烟测试的 Context 替身。 */
public class Context {

    private final File cacheDir;

    public Context(File cacheDir) {
        this.cacheDir = cacheDir;
    }

    public Context getApplicationContext() {
        return this;
    }

    public File getCacheDir() {
        return cacheDir;
    }
}
