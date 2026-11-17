package io.github.eifv013.zone7;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

/** Notices 단위 테스트: 알림 시각(조용한 시간)과 문구. */
public class NoticesTest {
    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");

    private static long at(int hour, int minute) {
        Calendar c = Calendar.getInstance(SEOUL);
        c.set(2026, Calendar.NOVEMBER, 17, hour, minute, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
    private static int hourOf(long t) { Calendar c = Calendar.getInstance(SEOUL); c.setTimeInMillis(t); return c.get(Calendar.HOUR_OF_DAY); }

    @Test public void 낮에는_예정한_시각에_그대로_울린다() {
        assertEquals(at(14, 0), Notices.fireAt(at(10, 0), Notices.FULL_AFTER_MS, SEOUL));
        assertEquals(at(21, 59), Notices.fireAt(at(17, 59), Notices.FULL_AFTER_MS, SEOUL));
    }

    @Test public void 밤_열시부터_아침_여덟시_사이는_아침_여덟시로_미룬다() {
        long late = Notices.fireAt(at(19, 0), Notices.FULL_AFTER_MS, SEOUL);       // 23시 → 다음 날 8시
        assertEquals(8, hourOf(late));
        assertEquals(at(8, 0) + 24L * 60 * 60 * 1000, late);
        long dawn = Notices.fireAt(at(1, 0), Notices.FULL_AFTER_MS, SEOUL);        // 5시 → 같은 날 8시
        assertEquals(at(8, 0), dawn);
        assertEquals(at(8, 0), Notices.fireAt(at(4, 0), Notices.FULL_AFTER_MS, SEOUL));   // 정각 8시는 그대로
        assertTrue(Notices.fireAt(at(10, 0), -5, SEOUL) >= at(10, 0));             // 잘못된 지연은 0 으로 본다
    }

    @Test public void 오래_비웠을_때의_문구는_네_가지가_차례로_돈다() {
        assertEquals("여기는 7구역. 라라, 들리면 응답하라.", Notices.backText(0, "라라", "딩딩"));
        assertEquals("무전기가 하루째 조용해요.", Notices.backText(1, "라라", "딩딩"));
        assertEquals("딩딩이 문 앞에서 기다리고 있어요.", Notices.backText(2, "라라", "딩딩"));
        assertEquals("방벽 너머가 시끄러워요. 한번 봐 주세요.", Notices.backText(3, "라라", "딩딩"));
        assertEquals(Notices.backText(0, "라라", "딩딩"), Notices.backText(4, "라라", "딩딩"));
        assertEquals("나비가 문 앞에서 기다리고 있어요.", Notices.backText(2, "라라", "나비"));
    }

    @Test public void 이름이_없거나_이상하면_기본값을_쓴다() {
        assertEquals("여기는 7구역. 라라, 들리면 응답하라.", Notices.backText(0, null, null));
        assertEquals("여기는 7구역. 라라, 들리면 응답하라.", Notices.backText(0, "   ", ""));
        assertEquals("여기는 7구역. 라라, 들리면 응답하라.", Notices.backText(0, "아주아주아주아주아주아주긴이름입니다", null));
        assertEquals("무전기가 하루째 조용해요.", Notices.backText(2, "라라", null));    // 친구가 없으면 두 번째 문구
        assertEquals("무전기가 하루째 조용해요.", Notices.backText(-3, "라라", null));   // 음수여도 죽지 않는다(-3 → 1번)
    }
}
