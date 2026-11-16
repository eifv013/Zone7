"""
화면 연기 테스트(smoke test): 빌드한 dist/index.html 을 실제 브라우저로 열어 하루 이상(70초) 돌린다.

단위 테스트(npm test)는 규칙과 그림 모듈만 검사하고 화면 코드(src/ui.js)는 실행하지 않는다.
그래서 화면 코드의 오타 같은 오류는 여기서 잡는다. 게임은 한 프레임의 오류를 삼키고 안내만 띄우므로
(safeFrame), 페이지 오류뿐 아니라 console.error 와 화면의 오류 안내까지 함께 본다.

  실행: python3 tools/smoke.py        (Playwright 와 Chrome 이 필요하다)
  결과: 문제가 없으면 종료 코드 0, 있으면 1 과 함께 내용을 출력한다.
"""
import json, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'index.html')
SAVE_KEY = 'zone7-save-v2'

def market(**over):
    """2구역까지 연 판: 거래, 방벽, 특성, 철수가 모두 돌아가는 상태."""
    s = {"version": 2, "supplies": 5e9, "runEarned": 5e10, "lifetimeEarned": 9e10, "clicks": 40, "zone": 1,
         "buildings": {"scouts": 60, "garden": 40, "purifier": 30, "workshop": 20}, "defenses": {},
         "upgrades": {"crowbar": 2, "maps": 3}, "stalls": 20, "goods": 300, "price": 1.9, "autoSell": False,
         "day": 12, "dayClock": 44, "wavesCleared": 5, "signalIn": 3,
         "goalsDone": {"z1a": True, "z1b": True, "z1c": True}, "story": {"z1-0": True, "z1-1": True, "z1-2": True, "z2-0": True, "retreat-1": True},
         "antibodies": 12, "antibodyTotal": 12, "retreats": 1, "perks": {"harvest": 1}, "startedAt": 1}
    s.update(over)
    return s

def factory(**over):
    """3구역(공단)까지 연 판: 기계는 아직 없고 물자는 넉넉하다."""
    s = market(zone=2, supplies=5e13, runEarned=5e13, autoSell=True, dayClock=5, signalIn=500,
               defenses={"wire": 80, "tower": 60, "turret": 50, "flame": 40, "emp": 20},
               goalsDone={"z1a": True, "z1b": True, "z1c": True, "z2a": True, "z2b": True, "z2c": True})
    s["story"].update({"z2-1": True, "z2-2": True, "z3-0": True})
    s.update(over)
    return s

def station(**over):
    """4구역(환승역)까지 연 판: 열차도 노선도 아직 없고 물자는 넉넉하다."""
    s = factory(zone=3, supplies=5e22, runEarned=5e22, machines={"sorter": 20, "press": 30, "assembler": 60},
                defenses={"wire": 80, "tower": 60, "turret": 50, "flame": 40, "emp": 40, "rail": 30})
    s["goalsDone"].update({"z3a": True, "z3b": True, "z3c": True})
    s["story"].update({"z3-1": True, "z3-2": True, "z4-0": True})
    s.update(over)
    return s

def lab(**over):
    """5구역(대학 병원)까지 연 판: 연구원은 없고, 과제 셋이 나와 있으며 점수는 한 과제를 끝낼 만큼 있다."""
    s = station(zone=4, supplies=5e27, runEarned=5e27, trains=12, routes={"loop": 2, "river": 2, "outer": 2, "express": 1},
                points=100, offers=["soil", "serum", "drop"])
    s["goalsDone"].update({"z4a": True, "z4b": True, "z4c": True})
    s["story"].update({"z4-1": True, "z4-2": True, "z5-0": True})
    s.update(over)
    return s

# (이름, 화면 크기, 저장, 할 일)
CASES = [
    ('폰 · 2구역, 못 막는 밤', (390, 760), market(), 'full'),
    ('PC · 2구역, 막는 밤', (1280, 900), market(defenses={"wire": 60, "tower": 40, "turret": 30, "flame": 10}, autoSell=True), 'full'),
    ('폰 · 새 게임', (390, 760), None, 'new'),
    ('폰 · 3구역 생산 라인', (390, 760), factory(), 'line'),
    ('PC · 3구역 생산 라인', (1280, 900), factory(), 'line'),
    ('폰 · 4구역 노선', (390, 760), station(), 'rail'),
    ('PC · 4구역 노선', (1280, 900), station(), 'rail'),
    ('폰 · 5구역 연구', (390, 760), lab(), 'lab'),
    ('PC · 5구역 연구', (1280, 900), lab(), 'lab'),
]

def run_case(browser, name, size, state, mode):
    problems = []
    ctx = browser.new_context(viewport={'width': size[0], 'height': size[1]})
    page = ctx.new_page()
    page.on('pageerror', lambda e: problems.append('페이지 오류: ' + str(e)))
    # 외부 글꼴을 못 받아 생기는 네트워크 오류는 게임과 무관하므로 뺀다
    page.on('console', lambda m: problems.append('console.error: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'net::' not in m.text else None)
    if state is not None:
        page.add_init_script("var s=%s; s.lastSeen=Date.now(); if(!localStorage.getItem('%s'))localStorage.setItem('%s', JSON.stringify(s))" % (json.dumps(state), SAVE_KEY, SAVE_KEY))
    page.goto(URL)
    # 시작 화면: 열자마자 보여야 하고, 준비가 끝나면(최소 2.2초 + 흐려지는 0.35초) 사라져야 한다.
    page.wait_for_timeout(300)
    if page.locator('#boot').count() != 1: problems.append('시작 화면이 나오지 않았다')
    page.wait_for_timeout(3000)
    if page.locator('#boot').count() != 0: problems.append('시작 화면이 사라지지 않았다')

    def close_story():
        for _ in range(8):
            if page.evaluate("!document.getElementById('story').hidden"):
                page.click('#story'); page.wait_for_timeout(250)
    def clear():    # 화면을 덮는 창(일지, 특전 고르기)이 떠 있으면 닫는다. 특전은 첫 장을 고른다
        close_story()
        if page.evaluate("!document.getElementById('perk').hidden"):
            page.locator('#perk-list button').first.click(); page.wait_for_timeout(200)
            if page.evaluate("!document.getElementById('perk').hidden"): problems.append('특전을 골랐는데 창이 닫히지 않았다')
    def tap(sel):   # 넓은 화면에는 하단 메뉴가 없으므로 보이는 것만 누른다
        clear()
        loc = page.locator(sel)
        if loc.count() and loc.first.is_visible() and loc.first.is_enabled():
            loc.first.click(); page.wait_for_timeout(120); return True
        return False
    def fits():
        return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth && (window.innerWidth > 900 || document.documentElement.scrollHeight <= window.innerHeight)")
    def text(i):
        return page.evaluate("document.getElementById('%s').textContent" % i)

    close_story()
    if mode == 'new':
        for _ in range(60): page.click('#scavenge')
        tap('[data-mview-set=manage]')
        if not tap('#row-scouts'): problems.append('첫 수색조를 살 수 없다')
        tap('[data-tab=wall]')
        if not tap('#row-wire'): problems.append('첫 철조망을 살 수 없다')
        tap('[data-tab=z1]'); tap('[data-tab=z2]'); tap('[data-tab=z0]')
        tap('[data-mview-set=exped]'); tap('[data-mview-set=record]')
        for t in ['radio', 'stats', 'notes', 'help', 'journal', 'save']: tap('[data-rtab-set=%s]' % t)
        # 의견 보내기: 빈 글로는 못 보내고, 글을 쓰면 단추가 켜지고, 복사하면 안내가 뜨고, 닫힌다
        if not tap('#feedback-open'): problems.append('의견 보내기 단추를 누를 수 없다')
        if not page.locator('#feedback').is_visible(): problems.append('의견 창이 뜨지 않았다')
        if not page.is_disabled('#feedback-copy'): problems.append('빈 글인데 복사 단추가 켜져 있다')
        if '지금: 1구역 주택가' not in text('feedback-info'): problems.append('붙는 정보 미리 보기가 없다: ' + text('feedback-info')[:60])
        page.fill('#feedback-text', '시험 의견입니다')
        if page.is_disabled('#feedback-copy') or page.is_disabled('#feedback-issue'): problems.append('글을 썼는데 단추가 꺼져 있다')
        page.click('#feedback-copy'); page.wait_for_timeout(300)
        if not text('feedback-msg'): problems.append('복사한 뒤 안내가 없다')
        if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"): problems.append('의견 창이 옆으로 넘친다')
        page.click('#feedback-close'); page.wait_for_timeout(150)
        if page.locator('#feedback').is_visible(): problems.append('의견 창이 닫히지 않았다')
        tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
        if '초당 +0' in text('pps') and '0.5' not in text('pps'): problems.append('수색조를 샀는데 생산이 0이다: ' + text('pps'))
        page.wait_for_timeout(6000)
    elif mode == 'line':
        # 3구역: 기계가 없을 때의 안내 → 병목 올리기 → 직접 사서 병목이 바뀌는지 → 한 화면에 들어오는지
        tap('[data-mview-set=manage]'); tap('[data-tab=z2]')
        if not page.locator('#line').is_visible(): problems.append('3구역 탭에 생산 라인 칸이 없다')
        if '모두 있어야' not in text('line-note'): problems.append('기계가 없을 때의 안내가 없다: ' + text('line-note'))
        for _ in range(11):
            if not tap('#tune'): problems.append('병목 올리기를 누를 수 없다'); break
        levels = [text('row-%s' % m) for m in ['sorter', 'press', 'assembler']]
        if not ('Lv 2' in levels[0] and 'Lv 3' in levels[1] and 'Lv 6' in levels[2]): problems.append('병목 올리기 11번 뒤 레벨이 2·3·6 이 아니다: ' + ' | '.join(levels))
        if text('line-load') != '가동률 100%': problems.append('맞물렸는데 가동률이 100%가 아니다: ' + text('line-load'))
        if '정속 가동' not in text('line-note') or '초당 물자' not in text('line-note'): problems.append('정속 가동 표시가 없다: ' + text('line-note'))
        if not tap('#row-sorter'): problems.append('선별기를 살 수 없다')
        if page.locator('.line-cell.slow').count() != 1: problems.append('병목 표시가 정확히 하나가 아니다')
        if text('line-load') == '가동률 100%': problems.append('선별기만 올렸는데 가동률이 그대로다')
        tap('[data-qty="max"]'); tap('#tune'); tap('[data-qty="1"]')
        tap('#row-lube'); tap('#row-belt')
        if not fits(): problems.append('한 화면에 들어오지 않는다(3구역)')
        before = text('supplies'); page.wait_for_timeout(3000)
        if text('supplies') == before: problems.append('라인이 도는데 물자가 늘지 않는다')
        tap('[data-tab=z3]')
        if '아직 열지 않은' not in text('soon'): problems.append('잠긴 4구역 탭에 안내가 없다: ' + text('soon'))
        if page.locator('[data-tab=z4]').is_visible(): problems.append('아직 먼 5구역 탭이 보인다')
        tap('[data-mview-set=record]'); tap('[data-rtab-set=help]'); tap('[data-rtab-set=journal]'); tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
    elif mode == 'lab':
        # 5구역: 과제 셋이 보이고 → 하나를 끝내면 점수가 줄고 셋이 새로 나오고 → 다음 과제가 비싸지고 → 연구원을 뽑으면 점수가 모인다
        tap('[data-mview-set=manage]'); tap('[data-tab=z4]')
        if not page.locator('#lab').is_visible(): problems.append('5구역 탭에 연구 칸이 없다')
        if page.locator('.lab-offer:visible').count() != 3: problems.append('과제가 셋이 아니다: %d' % page.locator('.lab-offer:visible').count())
        if '토양 분석' not in text('offer-0') or '점수 60' not in text('offer-0'): problems.append('첫 과제 표시가 이상하다: ' + text('offer-0'))
        if '연구원을 뽑으면' not in text('lab-rate'): problems.append('연구원이 없을 때의 안내가 없다: ' + text('lab-rate'))
        if not tap('#offer-0'): problems.append('과제를 고를 수 없다')
        if text('lab-points') != '40': problems.append('과제를 끝냈는데 점수가 40이 아니다: ' + text('lab-points'))
        if '끝낸 과제 1개' not in text('lab-done') or '토양 분석 1' not in text('lab-done'): problems.append('끝낸 과제 표시가 없다: ' + text('lab-done'))
        if '점수 108' not in text('offer-0'): problems.append('다음 과제 값이 오르지 않았다: ' + text('offer-0'))
        if not page.is_disabled('#offer-0'): problems.append('점수가 모자란데 과제 단추가 켜져 있다')
        if not tap('#lab-reroll'): problems.append('다른 과제 보기를 누를 수 없다')
        if text('lab-points') != '13': problems.append('다시 뽑은 뒤 점수가 13이 아니다: ' + text('lab-points'))
        if not tap('#row-staff'): problems.append('연구원을 뽑을 수 없다')
        tap('[data-qty="10"]'); tap('#row-staff'); tap('[data-qty="1"]'); tap('#row-scope')
        if '초당 +' not in text('lab-rate'): problems.append('연구원을 뽑았는데 점수 속도가 없다: ' + text('lab-rate'))
        if not fits(): problems.append('한 화면에 들어오지 않는다(5구역)')
        page.wait_for_timeout(4000)
        if text('lab-points') == '13': problems.append('연구원이 있는데 점수가 모이지 않는다')
        tap('[data-tab=z5]')
        if '다음 버전' not in text('soon'): problems.append('6구역 탭에 준비 중 안내가 없다: ' + text('soon'))
        tap('[data-mview-set=record]'); tap('[data-rtab-set=help]'); tap('[data-rtab-set=radio]'); tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
    elif mode == 'rail':
        # 4구역: 열차가 없을 때의 안내 → 열차와 순환선 → 운행이 시작되고 → 30초 뒤 화물이 들어오는지
        tap('[data-mview-set=manage]'); tap('[data-tab=z3]')
        if not page.locator('#rail').is_visible(): problems.append('4구역 탭에 노선 칸이 없다')
        if '열차가 없어요' not in text('rail-note'): problems.append('열차가 없을 때의 안내가 없다: ' + text('rail-note'))
        if not tap('#row-train'): problems.append('열차를 살 수 없다')
        if '쉬는 열차 1대' not in text('rail-note'): problems.append('노선이 없는데 쉬는 열차 표시가 없다: ' + text('rail-note'))
        if not tap('#row-route-loop'): problems.append('순환선을 복구할 수 없다')
        tap('#row-train'); tap('#row-train')
        if '쉬는 열차 1대' not in text('rail-note'): problems.append('자리(2대)를 넘는 열차가 쉬지 않는다: ' + text('rail-note'))
        tap('#row-route-river'); tap('#row-signal'); tap('#row-timetable')
        rows_text = page.evaluate("[...document.querySelectorAll('#rail-list .rail-row')].map(e => e.textContent).join(' | ')")
        if '끊김' not in rows_text or '/ 2대' not in rows_text: problems.append('노선 현황이 이상하다: ' + rows_text)
        if not fits(): problems.append('한 화면에 들어오지 않는다(4구역)')
        # 운행: 남은 시간이 줄다가, 한 바퀴(약 30초)를 돌면 다시 처음부터 센다. (들어온 물자의 양은 단위 테스트가 확인한다)
        def loop_left():
            t = page.evaluate("document.querySelector('#rail-list .rail-row .rail-side').textContent")   # 예: '2 / 2대 · 0:13'
            m, sec = t.split('·')[-1].strip().split(':'); return int(m) * 60 + int(sec)
        page.wait_for_timeout(15000); clear(); tap('[data-mview-set=manage]'); tap('[data-tab=z3]')
        mid = loop_left()
        if not (5 <= mid <= 20): problems.append('순환선의 남은 시간이 줄지 않는다: %d초' % mid)
        page.wait_for_timeout(17000); clear(); tap('[data-mview-set=manage]'); tap('[data-tab=z3]')
        if loop_left() <= mid: problems.append('순환선이 한 바퀴를 돌고도 다시 출발하지 않았다: %d초 → %d초' % (mid, loop_left()))
        tap('[data-tab=z4]')
        if '아직 열지 않은' not in text('soon'): problems.append('잠긴 5구역 탭에 안내가 없다: ' + text('soon'))
        if page.locator('[data-tab=z5]').is_visible(): problems.append('아직 먼 6구역 탭이 보인다')
        tap('[data-mview-set=record]'); tap('[data-rtab-set=help]'); tap('[data-rtab-set=journal]'); tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
    else:
        # 구역 화면: 고점에 팔고, 좌판과 강화를 사고, 자동 판매를 켠다
        tap('[data-mview-set=manage]'); tap('[data-tab=z1]')
        if not tap('#sell'): problems.append('팔기 단추를 누를 수 없다')
        left = text('goods').split('/')[0].strip().replace(',', '')   # 팔고 0.1초 사이에 다시 조금 쌓인다
        if not (left.replace('.', '').isdigit() and float(left) < 100): problems.append('팔았는데 상품이 남았다: ' + text('goods'))
        tap('#row-stall'); tap('#row-scale'); tap('[data-qty="max"]'); tap('#row-stall'); tap('[data-qty="1"]')
        if page.locator('#auto-sell').is_visible() and not page.is_checked('#auto-sell'): page.check('#auto-sell')
        tap('[data-tab=z0]'); tap('#row-garden'); tap('#row-maps')
        tap('[data-tab=z2]')
        if '아직 열지 않은' not in text('soon'): problems.append('잠긴 3구역 탭에 안내가 없다: ' + text('soon'))
        if page.locator('#goals li:visible').count() != 0: problems.append('잠긴 구역 탭에 목표가 보인다')
        if page.locator('[data-tab=z3]').is_visible(): problems.append('아직 먼 4구역 탭이 보인다')
        tap('[data-tab=wall]'); tap('#row-wire')
        # 특성: 하나 찍고, 되돌리고, 다시 찍는다
        tap('[data-mview-set=exped]')
        if not tap('#row-immune'): problems.append('특성을 찍을 수 없다')
        if tap('#trait-reset'): tap('#confirm-yes')
        if '쓴 것 0' not in text('trait-points'): problems.append('특성을 되돌렸는데 쓴 샘플이 남았다: ' + text('trait-points'))
        tap('#row-immune'); tap('#row-bulwark')
        tap('[data-mview-set=record]')
        for t in ['radio', 'stats', 'notes', 'help', 'save', 'journal']: tap('[data-rtab-set=%s]' % t)
        tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
        page.wait_for_timeout(5000)
        tap('#signal')
        page.wait_for_timeout(65000)     # 무리 도착(50초)과 밤 결과(60초)를 지나간다
        close_story()
        logs = page.evaluate("[...document.querySelectorAll('#log li .log-text')].map(e => e.textContent).join(' / ')")
        if not any(k in logs for k in ['막아냈다', '뚫렸다', '버티기만']): problems.append('밤 결과가 무전 로그에 없다')
        if name.startswith('폰') and '무리가 도착했다' not in logs: problems.append('도착 경보가 무전 로그에 없다')
        # 철수: 두 번 눌러야 한다
        zone_before = text('base-no')
        if not tap('#retreat'): problems.append('철수 단추를 누를 수 없다')
        tap('#retreat'); page.wait_for_timeout(400); close_story()
        if text('base-no') != '1구역 주택가': problems.append('철수했는데 1구역이 아니다: ' + zone_before + ' → ' + text('base-no'))
        if text('supplies') != '0': problems.append('철수했는데 물자가 남았다: ' + text('supplies'))
        page.wait_for_timeout(1500)
    note = page.evaluate("document.getElementById('notice').hidden ? '' : document.getElementById('notice-text').textContent")
    if '문제가 생겼' in note: problems.append('화면의 오류 안내: ' + note)
    ctx.close()
    return problems

def main():
    if not os.path.exists(URL[7:]):
        print('dist/index.html 이 없다. 먼저 node build.js 를 실행한다.'); return 1
    failed = False
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
        try:
            for name, size, state, mode in CASES:
                problems = run_case(browser, name, size, state, mode)
                print(('실패 ' if problems else '통과 ') + name)
                for line in problems[:6]: print('   ', line)
                failed = failed or bool(problems)
        finally:
            browser.close()
    return 1 if failed else 0

if __name__ == '__main__':
    sys.exit(main())
