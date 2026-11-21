package io.github.eifv013.zone7;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * 예약해 둔 시각이 되면 불려서 알림을 띄운다(MainActivity 가 앱이 가려질 때 예약한다).
 * 어느 단계에서 실패해도 조용히 끝낸다: 알림은 없어도 게임에는 지장이 없다.
 */
public class NoticeReceiver extends BroadcastReceiver {
    static final String CHANNEL = "zone7";
    static final String PREFS = "zone7-notice";
    static final String KIND = "kind";
    static final String KIND_FULL = "full", KIND_BACK = "back", KIND_ATTEND = "attend";
    static final int ID_FULL = 1, ID_BACK = 2, ID_ATTEND = 3;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.getBoolean("enabled", true)) return;
            String kind = intent.getStringExtra(KIND);
            boolean back = KIND_BACK.equals(kind), attend = KIND_ATTEND.equals(kind);
            String text;
            if (attend) {
                // 4.7.3 문구는 게임이 알려 준 것(받을 보상에 뽑기권이 있으면 그 말). 없으면 기본 문구
                text = Notices.cleanText(prefs.getString("attendText", null), Notices.ATTEND_TEXT);
            } else if (back) {
                int index = prefs.getInt("backIndex", 0);
                text = Notices.backText(index, prefs.getString("hero", null), prefs.getString("pet", null));
                prefs.edit().putInt("backIndex", index + 1).apply();
            } else {
                text = Notices.FULL_TEXT;
            }
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            ensureChannel(nm);
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
            b.setSmallIcon(R.drawable.ic_notice)
                .setContentTitle("7구역")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(tap)
                .setAutoCancel(true);
            nm.notify(attend ? ID_ATTEND : back ? ID_BACK : ID_FULL, b.build());
        } catch (Throwable e) {
            // 알림 권한이 없거나 기기가 막은 경우 등. 할 수 있는 일이 없다.
        }
    }

    /** 알림 채널(안드로이드 8 이상에서 필요). 이미 있으면 그대로 둔다. */
    static void ensureChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26 || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "거점 소식", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("창고가 가득 찼을 때, 오래 비웠을 때, 출석 보상이 준비됐을 때 알려 줘요.");
        nm.createNotificationChannel(ch);
    }
}
