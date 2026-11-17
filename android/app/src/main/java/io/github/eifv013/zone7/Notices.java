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

    /** 이름을 다듬는다: 비었거나 너무 길면 기본값(또는 빈 글)으로. 알림에 이상한 글이 들어가지 않게 한다. */
    public static String clean(String name, String fallback) {
        if (name == null) return fallback;
        String t = name.trim();
        if (t.isEmpty() || t.length() > 12) return fallback;
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
