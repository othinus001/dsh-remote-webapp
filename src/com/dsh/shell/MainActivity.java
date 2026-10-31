package com.dsh.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * 单 Activity 外壳。
 *
 * 第一次启动：弹窗让用户粘贴自己的 DSH Web 地址（https://你的域名/?token=xxxx），存起来；
 * 之后启动直接进，和手动在浏览器里用一模一样。
 * 返回键退到后台而不是销毁页面，所以再打开是热启动、不重新加载；冷启动时先用本地缓存画界面。
 */
public class MainActivity extends Activity {

    private WebView web;
    private String startUrl = "";
    private String origin = "";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFF15161A);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        configure(web);
        setContentView(web);

        startUrl = Settings.startUrl(this);
        if (startUrl.length() == 0) {
            askForUrl(true);
            return;
        }
        open(startUrl);
        if (state != null) {
            web.restoreState(state);
        }
    }

    /** 换地址（或首次输入）后重新绑定客户端并加载。 */
    private void open(String url) {
        startUrl = url;
        origin = Settings.origin(url);
        SkinWebClient client = new SkinWebClient(this, origin);
        client.onAuthRequired = new Runnable() {
            @Override
            public void run() {
                // 地址或 token 不对时网页只剩一行英文提示，这时让用户重新填
                askForUrl(false);
            }
        };
        web.setWebViewClient(client);
        web.setWebChromeClient(new WebChromeClient());
        web.clearHistory();
        web.loadUrl(url);
        Preloader.kick(this, url, origin);
    }

    /**
     * 弹窗让用户填地址。firstRun=true 时不可取消（没有地址没法用），
     * 否则可以取消（只是回到原来的页面）。
     */
    private void askForUrl(final boolean firstRun) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint("https://你的域名/?token=xxxx");
        if (!firstRun && startUrl.length() > 0) {
            input.setText(startUrl);
            input.setSelection(input.getText().length());
        }

        FrameLayout box = new FrameLayout(this);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(input, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(firstRun ? "填一下你的 DSH Web 地址" : "这个地址没连上，重新填一下")
                .setMessage("填一下你的 DSH 的 Web 地址（公网 IP 或局域网 IP 都行）。注意：你得先用手机浏览器打开这条链接、确认能进到界面里；如果打开后没直接开始加载，说明你没连成，请卸载重装再填。")
                .setView(box)
                .setPositiveButton("开始使用", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        submit(input.getText().toString(), firstRun);
                    }
                });
        if (!firstRun) {
            b.setNegativeButton("取消", null);
        }
        AlertDialog dialog = b.create();
        dialog.setCancelable(!firstRun);
        dialog.setCanceledOnTouchOutside(false);
        dialog.show();
    }

    private void submit(String raw, boolean firstRun) {
        String url = Settings.normalize(raw);
        if (url.length() == 0) {
            Toast.makeText(this, "这个地址看起来不对，要以 http:// 或 https:// 开头", Toast.LENGTH_LONG).show();
            askForUrl(firstRun);
            return;
        }
        Settings.save(this, url);
        open(url);
    }

    private void configure(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 锁定文字缩放：系统字体调大也不让 9px 小字和图标栏挤爆
        try {
            s.setTextZoom(100);
        } catch (Throwable ignored) {
        }
        try {
            String ua = s.getUserAgentString();
            if (ua != null) {
                ua = ua.replace("; wv)", ")");
                s.setUserAgentString(ua);
                Fetch.userAgent = ua;
            }
        } catch (Throwable ignored) {
        }
        try {
            CookieManager.getInstance().setAcceptCookie(true);
        } catch (Throwable ignored) {
        }
        try {
            CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        // 退到后台：页面和 WebSocket 都留着，下次进来是热启动
        moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null && startUrl.length() > 0) {
            web.saveState(out);
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) {
                parent.removeView(web);
            }
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
