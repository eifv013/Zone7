package io.github.eifv013.zone7;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * 알림의 규칙(안드로이드 클래스를 쓰지 않는 순수한 계산). NoticesTest 가 검사한다.
 *
 * 알림은 두 가지뿐이다. 하루에 많아야 두 번이고, 앱을 다시 열면 둘 다 취소된다.
 *   - FULL : 앱을 닫고 FULL_AFTER_MS(4시간, 자리 비움 보상의 상한) 뒤. "창고가 가득 찼어요."
 *   - BACK : 앱을 닫고 BACK_AFTER_MS(24시간) 뒤. 네 가지 문구가 차례로 돌아가며 나온다.
 * 밤 10시부터 아침 8시 사이에 울릴 알림은 아침 8시로 미룬다.
 */
public final class Notices {
    private Notices() {}

    public static final long FULL_AFTER_MS = 4L * 60 * 60 * 1000;
    public static final long BACK_AFTER_MS = 24L * 60 * 60 * 1000;
    public static final int QUIET_FROM = 22, QUIET_TO = 8;      // 조용한 시간: 22시 ~ 8시(현지 시각)
    public static final String DEFAULT_HERO = "라라";
    public static final String FULL_TEXT = "창고가 가득 찼어요. 물자를 가져가세요.";
    public static final int BACK_COUNT = 4;

    /**
     * 지금(now)부터 delay 뒤에 울릴 시각. 그 시각이 조용한 시간에 걸리면 다음 아침 8시로 미룬다.
     * 시간대를 받는 것은 테스트를 위해서다(기기에서는 TimeZone.getDefault()).
     */
    public static long fireAt(long now, long delayMs, TimeZone zone) {
        long at = now + Math.max(0, delayMs);
        Calendar c = Calendar.getInstance(zone == null ? TimeZone.getDefault() : zone);
        c.setTimeInMillis(at);
        int hour = c.get(Calendar.HOUR_OF_DAY);
        if (hour >= QUIET_FROM || hour < QUIET_TO) {
            if (hour >= QUIET_FROM) c.add(Calendar.DAY_OF_MONTH, 1);      // 밤 10시 이후: 내일 아침으로
            c.set(Calendar.HOUR_OF_DAY, QUIET_TO);
            c.set(Calendar.MINUTE, 0);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            return c.getTimeInMillis();
        }
        return at;
    }

    /*
     * 4.7.3 출석 알림: 출석 보상을 받을 수 있게 되면 한 번. 게임(core.js 의 attendNoticeAt)과 같은 규칙이다.
     *   오늘 이미 받았으면 내일 자정부터, 아직이면 지금부터 ATTEND_DELAY_MS 뒤부터 센다. 그 뒤로 처음 오는 12시나 19시(현지 시각)에 울린다.
     *   다른 알림(FULL · BACK)과 ATTEND_GAP_MS 안으로 겹치면 울리지 않는다(-1).
     */
    public static final int[] ATTEND_SLOTS = { 12, 19 };
    public static final long ATTEND_DELAY_MS = 60L * 60 * 1000, ATTEND_GAP_MS = 90L * 60 * 1000;
    public static final String ATTEND_TEXT = "오늘의 보급품이 도착했어요. 출석 체크하고 받아 가세요.";

    /** 시각 → 그 시각의 현지 날짜 "YYYY-MM-DD"(게임의 todayStr 과 같은 꼴). */
    public static String dayOf(long t, TimeZone zone) {
        Calendar c = Calendar.getInstance(zone == null ? TimeZone.getDefault() : zone);
        c.setTimeInMillis(t);
        return String.format(java.util.Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** 출석 알림 시각. lastDay 는 마지막으로 받은 날("YYYY-MM-DD", 없으면 null). 울리지 않을 때는 -1. */
    public static long attendAt(long now, String lastDay, TimeZone zone) {
        TimeZone z = zone == null ? TimeZone.getDefault() : zone;
        boolean claimed = lastDay != null && lastDay.equals(dayOf(now, z));
        Calendar c = Calendar.getInstance(z);
        c.setTimeInMillis(now);
        long start;
        if (claimed) {
            c.add(Calendar.DAY_OF_MONTH, 1);
            c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
            start = c.getTimeInMillis();
        } else {
            start = now + ATTEND_DELAY_MS;
        }
        long at = -1;
        Calendar s = Calendar.getInstance(z);
        for (int off = 0; off < 3 && at < 0; off++) {
            for (int h : ATTEND_SLOTS) {
                s.setTimeInMillis(start);
                s.add(Calendar.DAY_OF_MONTH, off);
                s.set(Calendar.HOUR_OF_DAY, h); s.set(Calendar.MINUTE, 0); s.set(Calendar.SECOND, 0); s.set(Calendar.MILLISECOND, 0);
                if (s.getTimeInMillis() >= start) { at = s.getTimeInMillis(); break; }
            }
        }
        if (at < 0) return -1;
        long full = fireAt(now, FULL_AFTER_MS, z), back = fireAt(now, BACK_AFTER_MS, z);
        if (Math.abs(full - at) < ATTEND_GAP_MS || Math.abs(back - at) < ATTEND_GAP_MS) return -1;
        return at;
    }

    /** 이름을 다듬는다: 비었거나 너무 길면 기본값(또는 빈 글)으로. 알림에 이상한 글이 들어가지 않게 한다. */
    public static String clean(String name, String fallback) {
        if (name == null) return fallback;
        String t = name.trim();
        if (t.isEmpty() || t.length() > 12) return fallback;
        return t;
    }

    /** 게임이 보낸 알림 문구를 다듬는다: 비었거나 너무 길면(60자) 기본 문구. */
    public static String cleanText(String text, String fallback) {
        if (text == null) return fallback;
        String t = text.trim();
        if (t.isEmpty() || t.length() > 60) return fallback;
        return t;
    }

    /**
     * 오래 비웠을 때의 문구. index 는 지금까지 보낸 횟수(0부터)이고 네 가지가 차례로 돈다.
     * 세 번째 문구는 동물 친구의 이름이 있어야 한다. 친구가 없으면 두 번째 문구로 대신한다.
     */
    public static String backText(int index, String hero, String pet) {
        String h = clean(hero, DEFAULT_HERO), p = clean(pet, "");
        int k = ((index % BACK_COUNT) + BACK_COUNT) % BACK_COUNT;
        if (k == 0) return "여기는 7구역. " + h + ", 들리면 응답하라.";
        if (k == 2 && !p.isEmpty()) return p + josaIGa(p) + " 문 앞에서 기다리고 있어요.";
        if (k == 3) return "방벽 너머가 시끄러워요. 한번 봐 주세요.";
        return "무전기가 하루째 조용해요.";
    }

    /** 받침이 있으면 "이", 없으면 "가". 한글이 아니면 "가". */
    static String josaIGa(String word) {
        char c = word.charAt(word.length() - 1);
        boolean batchim = c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 != 0;
        return batchim ? "이" : "가";
    }
}
