package io.github.eifv013.zone7;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import java.util.TimeZone;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 7구역 — 안드로이드 껍데기.
 *
 * 하는 일은 하나다: 화면 전체에 웹뷰를 깔고 게임 주소(BuildConfig.GAME_URL)를 연다.
 *   - 게임 본체는 APK 안에 없다. GitHub Pages 에 올라간 파일을 불러온다.
 *     그래서 패치는 서버의 파일만 바꾸면 되고, 앱은 다음에 켤 때 새 버전을 받는다.
 *   - 한 번 열고 나면 게임의 서비스 워커(sw.js)가 파일을 저장해 두어 인터넷 없이도 열린다.
 *   - 게임 진행은 웹뷰의 localStorage 에 저장된다. 앱을 지우면 함께 사라진다.
 *
 * 외부 라이브러리를 쓰지 않는다(안드로이드 기본 클래스만). 빌드가 깨질 여지를 줄이기 위해서다.
 */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            web = new WebView(this);
        } catch (Throwable e) {
            // 기기에 "Android 시스템 WebView" 가 없거나 업데이트 중이면 여기서 실패한다. 죽지 않고 끝낸다.
            finish();
            return;
        }
        setContentView(web);
        // 게임의 첫 화면이 그려질 때까지 웹뷰를 숨긴다. 그동안은 창 바탕(어두운 바탕 + 아이콘)이 보인다.
        // 숨기지 않으면 페이지를 받아 오는 동안 빈 흰 화면이 번쩍인다.
        web.setBackgroundColor(0xFF17180F);
        web.setVisibility(View.INVISIBLE);
        // 안전장치: 무슨 이유로든 "그려졌다"는 신호가 오지 않아도 8초 뒤에는 보여 준다(빈 화면에 갇히지 않게).
        web.postDelayed(this::reveal, 8000);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);                   // 게임이 자바스크립트다
        s.setDomStorageEnabled(true);                   // localStorage: 게임 저장
        s.setMediaPlaybackRequiresUserGesture(false);   // 효과음이 첫 터치 전에도 막히지 않게
        s.setTextZoom(100);                             // 기기의 "글자 크게" 설정이 한 화면 배치를 깨뜨리지 않게
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);                    // 기기 파일을 읽을 일이 없다
        s.setAllowContentAccess(false);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setWebChromeClient(new WebChromeClient());  // alert/confirm 같은 기본 대화상자가 뜨게 한다
        // 게임이 알림 설정과 이름을 알려 줄 통로. 이 웹뷰는 게임 주소만 열고 다른 링크는 바깥 브라우저로 보내므로, 게임만 이 통로를 쓴다.
        web.addJavascriptInterface(new Bridge(), "Zone7Native");
        askNoticePermission();

        web.setWebViewClient(new WebViewClient() {
            /** 게임 주소만 앱 안에서 연다. 그 밖의 링크는 바깥 브라우저로 보낸다. */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = String.valueOf(request.getUrl());
                if (Links.isGame(url, BuildConfig.GAME_URL)) return false;
                openOutside(url);
                return true;
            }

            /** 페이지의 첫 내용이 화면에 그려졌다. 이제 웹뷰를 보여 준다(게임의 시작 화면이 이어서 보인다). */
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                reveal();
            }

            /**
             * 첫 화면을 못 받았을 때(처음 켜는데 인터넷이 없는 경우)만 안내 화면을 보여 준다.
             * 그림 하나를 못 받은 정도의 오류는 무시한다. 한 번이라도 열었다면 서비스 워커가 저장본으로 열어 주므로 여기로 오지 않는다.
             */
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) showOffline();
            }
        });

        // 화면을 돌리는 등으로 다시 만들어진 경우에는 웹뷰가 기억한 상태를 되살리고, 아니면 게임을 연다.
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(BuildConfig.GAME_URL);
    }

    /** 숨겨 둔 웹뷰를 보여 준다. 여러 번 불려도 괜찮다. 액티비티가 이미 끝났으면 아무 일도 하지 않는다. */
    private void reveal() {
        if (web != null) web.setVisibility(View.VISIBLE);
    }

    /** 바깥 브라우저로 연다. https 주소만 내보낸다. 열 앱이 없어도 죽지 않는다. */
    private void openOutside(String url) {
        if (url == null || !url.startsWith("https://")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            // 브라우저가 없는 기기: 할 수 있는 일이 없다. 조용히 넘어간다.
        }
    }

    /** 인터넷이 없어 게임을 받지 못했을 때의 안내. "다시 시도"는 게임 주소로 가는 평범한 링크다. */
    private void showOffline() {
        String html = "<!doctype html><html lang='ko'><meta charset='utf-8'>"
            + "<meta name='viewport' content='width=device-width, initial-scale=1'>"
            + "<body style='margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;"
            + "background:#cfcfc4;color:#17180f;font-family:sans-serif;text-align:center;padding:24px;box-sizing:border-box'>"
            + "<h1 style='font-size:28px;margin:0 0 12px'>7구역</h1>"
            + "<p style='margin:0 0 24px;line-height:1.6'>게임을 받아 오지 못했다.<br>처음 한 번은 인터넷 연결이 필요하다.</p>"
            + "<a href='" + BuildConfig.GAME_URL + "' style='background:#f0b400;color:#17180f;font-weight:bold;"
            + "padding:14px 28px;border:3px solid #17180f;text-decoration:none'>다시 시도</a></body></html>";
        // 기준 주소를 게임 주소로 두어, 뒤로 가기 기록에 깨진 주소가 남지 않게 한다.
        web.loadDataWithBaseURL(BuildConfig.GAME_URL, html, "text/html", "utf-8", null);
        reveal();
    }

    /* 앱이 가려지면 웹뷰도 쉬게 한다. 게임은 이때 "자리를 비웠다"로 처리하고 저장한다(페이지의 visibilitychange). */
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    /* ---------- 알림 ---------- */
    /*
     * 앱이 화면에서 사라질 때(onStop) 알림 두 개를 예약하고, 다시 보일 때(onStart) 취소한다.
     *   창고가 가득 찼을 때(4시간 뒤)와 오래 비웠을 때(24시간 뒤). 규칙과 문구는 Notices 에 있다.
     * 정확한 시각이 필요 없으므로 AlarmManager.set(대략적인 알람)을 쓴다: 따로 권한이 필요 없고 배터리를 덜 쓴다.
     * 기기를 껐다 켜면 예약이 사라진다(다시 앱을 열었다 닫으면 새로 잡힌다). 알림은 없어도 게임에는 지장이 없다.
     */
    @Override protected void onStop() { scheduleNotices(); super.onStop(); }
    @Override protected void onStart() { super.onStart(); cancelNotices(); }

    private SharedPreferences noticePrefs() { return getSharedPreferences(NoticeReceiver.PREFS, Context.MODE_PRIVATE); }

    private PendingIntent noticeIntent(String kind, int code) {
        Intent i = new Intent(this, NoticeReceiver.class);
        i.putExtra(NoticeReceiver.KIND, kind);
        return PendingIntent.getBroadcast(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void scheduleNotices() {
        try {
            if (!noticePrefs().getBoolean("enabled", true)) return;
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long now = System.currentTimeMillis();
            TimeZone zone = TimeZone.getDefault();
            am.set(AlarmManager.RTC_WAKEUP, Notices.fireAt(now, Notices.FULL_AFTER_MS, zone), noticeIntent(NoticeReceiver.KIND_FULL, NoticeReceiver.ID_FULL));
            am.set(AlarmManager.RTC_WAKEUP, Notices.fireAt(now, Notices.BACK_AFTER_MS, zone), noticeIntent(NoticeReceiver.KIND_BACK, NoticeReceiver.ID_BACK));
            // 4.7.3 출석 알림: 게임이 알려 준 마지막 출석 날을 보고 정한다(겹치면 -1 이라 걸지 않는다)
            long attendAt = Notices.attendAt(now, noticePrefs().getString("attendLast", null), zone);
            if (attendAt > now) am.set(AlarmManager.RTC_WAKEUP, attendAt, noticeIntent(NoticeReceiver.KIND_ATTEND, NoticeReceiver.ID_ATTEND));
        } catch (Throwable e) {
            // 예약하지 못해도 게임은 그대로다.
        }
    }

    private void cancelNotices() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.cancel(noticeIntent(NoticeReceiver.KIND_FULL, NoticeReceiver.ID_FULL));
                am.cancel(noticeIntent(NoticeReceiver.KIND_BACK, NoticeReceiver.ID_BACK));
                am.cancel(noticeIntent(NoticeReceiver.KIND_ATTEND, NoticeReceiver.ID_ATTEND));
            }
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancelAll();      // 앱을 열었으면 떠 있던 알림은 지운다
        } catch (Throwable e) {
            // 위와 같다.
        }
    }

    /** 안드로이드 13 이상은 알림을 띄우려면 허락을 받아야 한다. 처음 한 번만 묻는다(거절하면 다시 묻지 않는다). */
    private void askNoticePermission() {
        try {
            if (Build.VERSION.SDK_INT < 33) return;
            String perm = "android.permission.POST_NOTIFICATIONS";
            if (checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) return;
            SharedPreferences prefs = noticePrefs();
            if (prefs.getBoolean("asked", false)) return;
            prefs.edit().putBoolean("asked", true).apply();
            requestPermissions(new String[] { perm }, 1);
        } catch (Throwable e) {
            // 물어보지 못해도 게임은 그대로다.
        }
    }

    /** 게임(자바스크립트)이 부르는 통로. 받은 글은 길이를 다듬어 저장만 한다(Notices.clean). */
    private final class Bridge {
        /** 알림을 켜고 끈다(게임의 설정 화면). */
        @JavascriptInterface public void setNotify(boolean on) { noticePrefs().edit().putBoolean("enabled", on).apply(); }
        @JavascriptInterface public boolean getNotify() { return noticePrefs().getBoolean("enabled", true); }
        /** 알림 문구에 넣을 주인공과 동물 친구의 이름. 친구가 없으면 빈 글. */
        @JavascriptInterface public void setNames(String hero, String pet) {
            noticePrefs().edit().putString("hero", Notices.clean(hero, Notices.DEFAULT_HERO)).putString("pet", Notices.clean(pet, "")).apply();
        }
        /** 4.7.3 출석: 마지막으로 받은 날("YYYY-MM-DD", 아직 없으면 빈 글)과 다음 출석 알림의 문구. */
        @JavascriptInterface public void setAttend(String last, String text) {
            String l = last != null && last.matches("\\d{4}-\\d{2}-\\d{2}") ? last : null;
            noticePrefs().edit().putString("attendLast", l).putString("attendText", Notices.cleanText(text, Notices.ATTEND_TEXT)).apply();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    /**
     * 뒤로 가기: 먼저 게임에게 묻는다(window.Zone7Back). 게임이 창을 닫거나 화면을 옮겼으면("stay") 앱은 그대로 있고,
     * 게임이 더 물러날 곳이 없다고 하면("exit") 앱을 끝내지 않고 뒤로 보낸다(실수로 눌러도 게임이 처음부터 다시 열리지 않는다).
     * 전에는 묻지 않고 곧바로 뒤로 보내서, 창 하나 닫으려고 눌러도 홈 화면이 됐다.
     * 게임이 아직 뜨지 않았거나 오래된 게임이라 그 함수가 없으면 전처럼 바로 뒤로 보낸다.
     */
    @Override
    public void onBackPressed() {
        if (web == null) { moveTaskToBack(true); return; }
        try {
            web.evaluateJavascript(
                "(function(){try{return window.Zone7Back?String(window.Zone7Back()):'exit'}catch(e){return 'exit'}})()",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || !value.contains("stay")) moveTaskToBack(true);
                    }
                });
        } catch (Exception e) {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        super.onDestroy();
    }
}
