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
def guard(**over):
    """6구역(강변 검문소)까지 연 판: 초소는 없고 물자는 넉넉하다."""
    s = lab(zone=5, supplies=5e33, runEarned=5e33, defenses={"rail": 3000000000000})
    s["goalsDone"].update({"z5a": True, "z5b": True, "z5c": True})
    s["story"].update({"z5-1": True, "z5-2": True, "z6-0": True})
    s.update(over)
    return s

def tower(**over):
    """7구역(송신탑)까지 연 판: 안테나는 없고 물자는 넉넉하다."""
    s = guard(zone=6, supplies=5e45, runEarned=5e45, posts=40, runSeconds=1e5)      # runSeconds: 길 정찰(1.6.2)이 이미 끝난 판
    s["goalsDone"].update({"z6a": True, "z6b": True, "z6c": True})
    s["story"].update({"z6-1": True, "z6-2": True, "z7-0": True})
    # 3.1.0: 정착지는 여덟 채를 지어 두고 마지막 한 채(학교)만 남긴다: 화면에서 짓는 것과 혈청의 문턱을 같이 본다
    s["settle"] = {k: True for k in ["farm", "mess", "store", "clinic", "lab7", "ward", "guard7", "watch"]}
    s["build"] = {"id": "school", "left": 1}
    s.update(over)
    return s

CASES = [
    ('폰 · 2구역, 못 막는 밤', (390, 760), market(), 'full'),
    ('PC · 2구역, 막는 밤', (1280, 900), market(defenses={"wire": 60, "tower": 40, "turret": 30, "flame": 10}, autoSell=True), 'full'),
    ('폰 · 새 게임', (390, 760), None, 'new'),
    ('폰 · 3구역 생산 라인', (390, 760), factory(jam={'id': 'press', 'left': 30}, jamIn=900, truck={'left': 20}, truckIn=900, stockSec=60), 'line'),
    ('PC · 3구역 생산 라인', (1280, 900), factory(jam={'id': 'press', 'left': 30}, jamIn=900, truck={'left': 20}, truckIn=900, stockSec=60), 'line'),
    ('폰 · 4구역 노선', (390, 760), station(), 'rail'),
    ('PC · 4구역 노선', (1280, 900), station(), 'rail'),
    ('폰 · 5구역 연구', (390, 760), lab(), 'lab'),
    ('PC · 5구역 연구', (1280, 900), lab(), 'lab'),
    ('폰 · 6구역 검문소', (390, 760), guard(), 'guard'),
    ('PC · 6구역 검문소', (1280, 900), guard(), 'guard'),
    ('폰 · 7구역 송신탑과 끝', (390, 760), tower(survivors=69000), 'tower'),
    ('PC · 7구역 송신탑과 끝', (1280, 900), tower(survivors=69000), 'tower'),
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
    def clear():    # 화면을 덮는 창(일지, 특전 고르기, 자리 비움 보상, 구역 지도)이 떠 있으면 닫는다. 특전은 첫 장을 고른다
        close_story()
        for box, btn in [('away', '#away-ok'), ('zmap', '#zmap-close')]:
            if page.evaluate("!document.getElementById('%s').hidden" % box): page.click(btn); page.wait_for_timeout(120)
        if page.evaluate("!document.getElementById('perk').hidden"):
            page.locator('#perk-list button').first.click(); page.wait_for_timeout(200)
            if page.evaluate("document.getElementById('confirm').hidden"): problems.append('특전을 눌렀는데 확인 창이 뜨지 않았다')
            page.locator('#confirm-yes').click(); page.wait_for_timeout(150)      # 0.5초 안에는 눌리지 않아야 한다
            if page.evaluate("document.getElementById('confirm').hidden"): problems.append('확인 창이 뜨자마자 눌렸다(연달아 누르기를 막지 못했다)')
            page.wait_for_timeout(500); page.locator('#confirm-yes').click(); page.wait_for_timeout(200)
            if page.evaluate("!document.getElementById('perk').hidden"): problems.append('특전을 골랐는데 창이 닫히지 않았다')
    def tap(sel):   # 넓은 화면에는 하단 메뉴가 없으므로 보이는 것만 누른다
        clear()
        loc = page.locator(sel)
        # 구역 화면은 운영 / 강화 / 목표로 나뉘어 있다: 누르려는 것이 다른 쪽에 있으면 그쪽으로 넘어가서 누른다
        if loc.count() and not loc.first.is_visible():
            for p in ['play', 'up', 'goal']:
                b = page.locator('#zone-panes [data-pane=%s]' % p)
                if b.count() and b.first.is_visible():
                    b.first.click(); page.wait_for_timeout(60)
                    if loc.first.is_visible(): break
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
        # 수색 지도: 칸을 직접 눌러 뒤지고, 구역 지도를 열었다 닫는다
        if page.locator('#search-grid .tile').count() != 20: problems.append('수색 지도가 20칸이 아니다')
        done_before = page.locator('#search-grid .tile.done').count()
        if not tap('#tile-19'): problems.append('수색 지도의 칸을 누를 수 없다')
        if page.locator('#search-grid .tile.done').count() != done_before + 1 or 'done' not in page.get_attribute('#tile-19', 'class'): problems.append('칸을 눌렀는데 뒤진 칸이 되지 않았다')
        if not tap('#zmap-open') or not page.locator('#zmap').is_visible(): problems.append('구역 지도가 열리지 않는다')
        if '1구역 주택가' not in text('zmap-z0') or '잠김' not in text('zmap-z1'): problems.append('구역 지도 내용이 이상하다: ' + text('zmap-z0') + ' | ' + text('zmap-z1'))
        page.click('#zmap-close')
        if not tap('#row-scouts'): problems.append('첫 수색조를 살 수 없다')
        tap('#zone-panes [data-pane=goal]')
        if page.locator('#goals li:visible').count() != 3 or page.locator('#row-scouts').is_visible(): problems.append('목표 화면에 목표 셋만 보여야 한다')
        tap('#zone-panes [data-pane=up]')
        if not page.locator('#row-crowbar').is_visible() or page.locator('#search').is_visible(): problems.append('강화 화면에 강화 목록만 보여야 한다')
        tap('#zone-panes [data-pane=play]')
        tap('[data-tab=wall]')
        if not tap('#row-wire'): problems.append('첫 철조망을 살 수 없다')
        tap('[data-tab=z1]'); tap('[data-tab=z2]'); tap('[data-tab=z0]')
        # 동물 친구: 고양이를 맞이하고 이름을 바꾼다
        tap('[data-mview-set=exped]')
        if not tap('#adopt-cat'): problems.append('고양이를 맞이할 수 없다')
        if not page.locator('#pet-card').is_visible() or '친구 1 /' not in text('pet-kind'): problems.append('친구 칸이 바뀌지 않았다: ' + text('pet-kind'))
        if '항체 샘플' not in text('adopt-dog'): problems.append('다시 데려오기 값이 보이지 않는다: ' + text('adopt-dog'))
        page.fill('#hero-input', '김씨'); page.click('#hero-rename'); page.wait_for_timeout(150)
        if page.get_attribute('#hero-input', 'placeholder') != '김씨': problems.append('주인공 이름이 바뀌지 않았다')
        page.fill('#pet-input', '나비'); page.click('#pet-rename'); page.wait_for_timeout(150)
        if text('pet-name') != '나비': problems.append('이름이 바뀌지 않았다: ' + text('pet-name'))
        if not fits(): problems.append('한 화면에 들어오지 않는다(특성)')
        tap('[data-mview-set=record]')
        for t in ['radio', 'stats', 'notes', 'help', 'journal', 'save']: tap('[data-rtab-set=%s]' % t)
        # 0.9.0 업적: 탭 여섯, 고른 묶음의 업적 카드, 머리줄의 달성 수
        tap('[data-mview-set=record]'); tap('[data-rtab-set=ach]')
        if page.locator('#ach-tabs button').count() != 8: problems.append('업적 탭이 여덟이 아니다')
        if page.locator('#ach .ach-card').count() != 30: problems.append('공통 업적 30개가 보이지 않는다: %d' % page.locator('#ach .ach-card').count())
        page.locator('#ach-tabs button').nth(2).click(); page.wait_for_timeout(100)
        if page.locator('#ach .ach-card').count() != 15: problems.append('구역 업적 15개가 보이지 않는다')
        if '/ 135' not in text('ach-count'): problems.append('업적 달성 수가 없다: ' + text('ach-count'))
        # 0.9.0 업데이트 알림 띠: '나중에'를 누르면 사라진다(단추가 연결돼 있는지 본다)
        page.evaluate("document.getElementById('update-bar').hidden = false")
        if page.locator('#update-bar button').count() != 1 or not page.locator('#update-now').is_visible(): problems.append('업데이트 알림에는 단추가 하나(지금 업데이트)만 있어야 한다')
        page.evaluate("document.getElementById('update-bar').hidden = true")
        # 0.8.10 저장 코드: 한글 이름이 있어도 코드가 만들어지고, 그 코드를 다시 불러올 수 있다
        tap('[data-mview-set=record]'); tap('[data-rtab-set=save]')
        tap('#export'); page.wait_for_timeout(200)
        code = page.input_value('#save-code')
        if len(code) < 200: problems.append('저장 코드가 만들어지지 않았다: ' + text('save-msg'))
        tap('#import'); page.wait_for_timeout(400)
        if '불러왔습니다' not in text('save-msg'): problems.append('저장 코드를 불러오지 못했다: ' + text('save-msg'))
        clear()
        # 0.8.10 도감과 패치노트
        tap('[data-rtab-set=dex]')
        if page.locator('#dex-tabs button').count() != 9: problems.append('도감 탭이 아홉이 아니다')
        if page.locator('#dex .dex-card').count() != 12: problems.append('도감에 강아지 12칸이 없다')
        page.locator('#dex-tabs button').nth(1).click(); page.wait_for_timeout(100)
        if page.locator('#dex .dex-card').count() != 12: problems.append('도감에 고양이 12칸이 없다')
        page.locator('#dex-tabs button').nth(2).click(); page.wait_for_timeout(100)
        if page.locator('#dex .dex-card').count() != 15 or page.locator('#dex .dex-card svg rect').count() < 200: problems.append('도감에 좀비 15칸이 없다')
        page.locator('#dex-tabs button').nth(3).click(); page.wait_for_timeout(100)
        if page.locator('#dex .dex-card').count() != 12: problems.append('도감에 단골 12칸이 없다')
        page.locator('#dex-tabs button').nth(4).click(); page.wait_for_timeout(100)
        if page.locator('#dex .dex-card').count() != 12: problems.append('도감에 거래처 12칸이 없다')
        page.locator('#dex-tabs button').nth(5).click(); page.wait_for_timeout(100)
        if page.locator('#dex .dex-card').count() != 12: problems.append('도감에 화물 12칸이 없다')
        page.locator('#dex-tabs button').nth(6).click(); page.wait_for_timeout(100)
        if page.locator('#dex .dex-card').count() != 12: problems.append('도감에 서류 12칸이 없다')
        tap('[data-rtab-set=notes]')
        if page.locator('#notes .note.open').count() != 1 or page.locator('#notes .note-new').count() != 1: problems.append('패치노트는 최신 버전만 펼쳐져 있어야 한다')
        page.locator('#notes .note-head').nth(2).click(); page.wait_for_timeout(100)
        if page.locator('#notes .note.open').count() != 2: problems.append('패치노트 줄을 눌러도 펼쳐지지 않는다')
        # 0.8.8 성별: 일행 칸에서 '여'를 고르면 일지의 호칭이 바뀐다(기관사 → 기관사 언니는 4구역 일지라 여기서는 단추만 본다)
        tap('[data-mview-set=exped]')
        tap('[data-gender=f]')
        if page.get_attribute('[data-gender=f]', 'aria-pressed') != 'true': problems.append('성별 단추가 눌린 표시가 안 된다')
        tap('[data-gender=none]')
        # 0.8.3 자동화 설명: 영구 특성 '자동화' 줄에 전력 투입 대기 시간(초)이 나온다
        tap('[data-mview-set=exped]')
        if '조립공' not in text('row-auto') or '초' not in text('row-auto'): problems.append('자동화 설명에 초가 없다: ' + text('row-auto'))
        tap('[data-mview-set=record]')
        # 0.8.0 기록 화면: 일지의 장 탭과 소설 본문, 도움말 탭, 지난 구역, 설정 단추
        tap('[data-rtab-set=journal]')
        if page.locator('#journal-tabs button').count() < 5: problems.append('일지에 장 탭이 없다')
        if page.locator('#journal li p').count() < 4: problems.append('일지 본문에 문단이 없다')
        tap('[data-rtab-set=help]')
        n = page.locator('#help-tabs button').count()
        if n < 10: problems.append('도움말 탭이 없다')
        page.locator('#help-tabs button').nth(n - 1).click(); page.wait_for_timeout(80)
        if page.locator('#help .note').count() != 1: problems.append('도움말은 한 번에 한 항목만 보여야 한다')
        if not page.locator('#help .note li').first.is_visible(): problems.append('도움말 내용이 보이지 않는다')
        tap('[data-rtab-set=stats]')
        if page.locator('#stats-zones li').count() < 1 or page.locator('#stats-grid dd').count() != 16: problems.append('통계에 지난 구역이 없다')
        tap('[data-rtab-set=save]')
        page.click('[data-pref=notation][data-value=sci]'); page.wait_for_timeout(300)
        big = any(c in text('supplies') for c in '만억조경해e')
        page.click('[data-pref=notation][data-value=kr]'); page.wait_for_timeout(300); kr = text('supplies')
        page.click('[data-pref=notation][data-value=sci]'); page.wait_for_timeout(300)
        if big and 'e' not in page.inner_text('#supplies'): problems.append('숫자 표기를 바꿨는데 물자 표시가 그대로다: ' + page.inner_text('#supplies'))
        page.click('[data-pref=notation][data-value=kr]'); page.click('[data-pref=vibrate][data-value=off]'); page.click('[data-pref=shake][data-value=off]')
        if page.get_attribute('[data-pref=shake][data-value=off]', 'aria-pressed') != 'true': problems.append('설정 단추가 눌린 표시가 안 된다')
        # 의견 보내기: 빈 글로는 못 보내고, 글을 쓰면 단추가 켜지고, 복사하면 안내가 뜨고, 닫힌다
        if not tap('#feedback-open'): problems.append('의견 보내기 단추를 누를 수 없다')
        if not page.locator('#feedback').is_visible(): problems.append('의견 창이 뜨지 않았다')
        if not page.is_disabled('#feedback-copy'): problems.append('빈 글인데 복사 단추가 켜져 있다')
        if '현재: 1구역 주택가' not in text('feedback-info'): problems.append('붙는 정보 미리 보기가 없다: ' + text('feedback-info')[:60])
        page.fill('#feedback-text', '시험 의견입니다')
        if page.is_disabled('#feedback-copy') or page.is_disabled('#feedback-issue'): problems.append('글을 썼는데 단추가 꺼져 있다')
        page.click('#feedback-copy'); page.wait_for_timeout(300)
        if not text('feedback-msg'): problems.append('복사한 뒤 안내가 없다')
        if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"): problems.append('의견 창이 옆으로 넘친다')
        page.click('#feedback-close'); page.wait_for_timeout(150)
        if page.locator('#feedback').is_visible(): problems.append('의견 창이 닫히지 않았다')
        tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
        if '[object' in page.inner_text('body'): problems.append('화면에 [object …] 가 찍혀 있다')
        # 화면 키우기 막기(3.8.2): viewport 와 touch-action 이 벌리기를 막고 있어야 하고, 두 손가락 밀기는 게임이 막아야 한다
        vp = page.evaluate("document.querySelector('meta[name=viewport]').content")
        if 'user-scalable=no' not in vp or 'maximum-scale=1' not in vp: problems.append('viewport 가 화면 키우기를 막지 않는다: ' + vp)
        ta = page.evaluate("[getComputedStyle(document.documentElement).touchAction, getComputedStyle(document.body).touchAction]")
        if any('pinch' in t or t in ('auto', 'manipulation') for t in ta): problems.append('touch-action 이 벌리기를 허락한다: %s' % ta)
        pinch = page.evaluate("""() => { const el = document.body, mk = (id, x) => new Touch({ identifier: id, target: el, clientX: x, clientY: 300 });
          const a = mk(1, 100), b = mk(2, 200), ev = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [a, b], targetTouches: [a, b], changedTouches: [a, b] });
          el.dispatchEvent(ev); return ev.defaultPrevented; }""")
        if not pinch: problems.append('두 손가락으로 미는 몸짓을 막지 않는다')
        # '+0.5', '+0.6' 처럼 소수로 시작하는 값은 0 이 아니다(0.6 을 0 으로 잘못 읽던 것을 고침)
        if text('pps').strip().endswith('초당 +0'): problems.append('수색조를 샀는데 생산이 0이다: ' + text('pps'))
        page.wait_for_timeout(6000)
    elif mode == 'line':
        # 3구역: 기계가 없을 때의 안내 → 병목 올리기 → 직접 사서 병목이 바뀌는지 → 한 화면에 들어오는지
        tap('[data-mview-set=manage]'); tap('[data-tab=z2]')
        if not page.locator('#line').is_visible(): problems.append('3구역 탭에 생산 라인 칸이 없다')
        # 3.5.0 3구역: 판(30칸 가운데 20칸이 보인다) → 상자가 들어오고 → 눌러 합치면 덤 → 줄 셋을 사면 판에서 바로 보인다
        if page.locator('#mboard button').count() != 30: problems.append('합치기 판의 칸이 서른 개가 아니다')
        if page.locator('#mboard button:visible').count() != 20: problems.append('보이는 칸이 스무 개가 아니다: %d' % page.locator('#mboard button:visible').count())
        for gone in ['#recipes', '#jam-fix', '#surge', '#belt', '#tune', '#rebalance', '#truck']:
            if page.locator(gone).count() and page.locator(gone).is_visible(): problems.append('없앤 것이 보인다: ' + gone)
        page.wait_for_timeout(7500)      # 상자 둘 이상이 들어올 시간
        boxes = page.evaluate("[...document.querySelectorAll('#mboard button small')].filter(b => b.textContent).length")
        if boxes < 3: problems.append('상자가 들어오지 않는다: %d개' % boxes)
        if page.locator('#mboard button.pair').count() < 2: problems.append('합칠 수 있는 짝이 없다')
        if '합쳐져요' not in text('line-note'): problems.append('합치기 안내가 없다: ' + text('line-note'))
        page.locator('#mboard button.pair').first.click(); page.wait_for_timeout(200)
        if not page.evaluate("(() => { const c = document.querySelector('#mboard button.pair canvas, #mboard button canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]); return seen.size >= 3; })()"): problems.append('상자 그림이 그려지지 않았다')
        # 합친 뒤에도(움직임이 끝난 뒤) 상자가 든 칸은 모두 눈에 보여야 한다. 3.5.0 에서는 합쳐진 칸이 통째로 투명해져 판이 빈 것처럼 보였다
        page.wait_for_timeout(1300)
        ghost = page.evaluate("(() => { const m = document.getElementById('mboard').getBoundingClientRect(); return [...document.querySelectorAll('#mboard button')].filter(b => !b.hidden && b.querySelector('small') && b.querySelector('small').textContent).filter(b => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return cs.opacity !== '1' || cs.position !== 'relative' || r.top < m.top - 1 || r.bottom > m.bottom + 1; }).length; })()")
        if ghost: problems.append('상자가 있는데 안 보이는 칸이 %d개 있다' % ghost)
        if int(page.get_attribute('#line', 'data-merges') or 0) < 1: problems.append('합친 횟수가 안 오른다')
        if '합침' in text('line-note') or '도와요' in text('line-note'): problems.append('3.8.4 에서 뺀 글이 남아 있다: ' + text('line-note'))
        if page.locator('#mboard button i').count() < 1: problems.append('합쳤는데 덤(+물자) 표시가 없다')
        close_story()
        # 줄 셋: 도장 라인은 값이 바로 오르고, 단조기는 판의 상자가 모두 오르고, 투입구는 간격이 줄어든다
        load0 = text('line-load')
        if not tap('#row-paint'): problems.append('도장 라인을 살 수 없다')
        if text('line-load') == load0: problems.append('도장 라인을 샀는데 판이 버는 양이 그대로다: ' + load0)
        best0 = text('line-mile'); load0 = text('line-load')
        if not tap('#row-forge'): problems.append('단조기를 살 수 없다')
        if text('line-mile') == best0 or text('line-load') == load0: problems.append('단조기를 샀는데 판이 그대로다: ' + best0 + ' / ' + load0)
        if '볼트' not in text('row-forge') : problems.append('단조기 줄에 들어오는 상자가 안 적혀 있다: ' + text('row-forge'))
        feed0 = text('row-feed')
        if not tap('#row-feed'): problems.append('투입구를 살 수 없다')
        if text('row-feed') == feed0 or '초마다' not in text('row-feed'): problems.append('투입구를 샀는데 간격이 그대로다: ' + text('row-feed'))
        tap('[data-qty="max"]'); tap('#row-paint'); tap('[data-qty="1"]')
        for up in ['#row-bonus', '#row-lucky', '#row-manual']:
            if not page.locator(up).count(): problems.append('새 개조가 없다: ' + up)
        for old in ['#row-lube', '#row-belt', '#row-spare', '#row-sorter']:
            if page.locator(old).count(): problems.append('옛 줄이나 개조가 남아 있다: ' + old)
        if not fits(): problems.append('한 화면에 들어오지 않는다(3구역)')
        if text('line-load').strip().endswith('초당 0'): problems.append('판에 상자가 있는데 버는 양이 0이다: ' + text('line-load'))
        tap('[data-tab=z3]')
        if '아직 열지 않은' not in text('soon'): problems.append('잠긴 4구역 탭에 안내가 없다: ' + text('soon'))
        if page.locator('[data-tab=z4]').is_visible(): problems.append('아직 먼 5구역 탭이 보인다')
        tap('[data-mview-set=record]'); tap('[data-rtab-set=help]'); tap('[data-rtab-set=journal]'); tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
    elif mode == 'tower':
        # 7구역: 안테나를 사면 생존자가 모이고 → 혈청 세 단계를 끝내고 목표를 채우면 → 일지 뒤에 끝 화면이 뜨고 → 닫으면 게임이 이어진다
        tap('[data-mview-set=manage]'); tap('[data-tab=z6]')
        if not page.locator('#tower').is_visible(): problems.append('7구역 탭에 송신탑 칸이 없다')
        # 3.1.0: 주파수 맞추기와 정착지
        if not page.locator('#t7-dial').is_visible() or not page.locator('#t7-tune').is_visible(): problems.append('주파수 맞추기가 보이지 않는다')
        tap('#zone-panes [data-pane=up]'); page.wait_for_timeout(1500)      # 남은 1초짜리 공사(학교)가 끝난다
        cells = page.evaluate("[...document.querySelectorAll('#settle-grid button')].map(b => b.className.split(' ')[0])")
        if len(cells) != 9 or cells.count('done') != 9: problems.append('정착지 아홉 채가 다 서지 않았다: ' + ','.join(cells))
        for _ in range(3):      # 혈청부터(안테나를 한꺼번에 사면 물자가 바닥난다)
            if not tap('#serum'): break
            page.wait_for_timeout(150)
        if '완성' not in text('serum'): problems.append('혈청 세 단계를 끝내지 못했다: ' + text('serum'))
        tap('#zone-panes [data-pane=play]')
        tap('[data-qty="10"]')
        for _ in range(4): tap('#row-antenna'); page.wait_for_timeout(120)
        if text('row-antenna').find('40 / 500') < 0: problems.append('안테나를 40기 사지 못했다: ' + text('row-antenna')[:40].replace(chr(10), ' '))
        if not fits(): problems.append('한 화면에 들어오지 않는다(7구역)')
        # 생존자 목표(10만 명)를 채워서 끝을 본다
        ended = False
        for _ in range(60):
            close_story()
            for b2 in page.locator('#perk-list button').all()[:1]:
                try:
                    if b2.is_visible():
                        b2.click(); page.wait_for_timeout(560)
                        if page.locator('#confirm-yes').is_visible(): page.locator('#confirm-yes').click()
                except Exception: pass
            if page.locator('#ending').is_visible(): ended = True; break
            page.wait_for_timeout(500)
        if not ended: problems.append('목표를 채웠는데 끝 화면이 뜨지 않았다(안테나 %s, 생존자 %s)' % (text('row-antenna')[:30].replace(chr(10), ' '), text('tower-people')))
        else:
            if '철수' not in text('ending-stats'): problems.append('끝 화면에 기록이 없다: ' + text('ending-stats'))
            if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"): problems.append('끝 화면이 옆으로 넘친다')
            page.click('#ending-ok'); page.wait_for_timeout(200)
            if page.locator('#ending').is_visible(): problems.append('끝 화면이 닫히지 않는다')
    elif mode == 'guard':
        # 6구역: 안전도 칸이 보이고 → 초소를 사면 통행 물자가 들어오고 → 한 화면에 들어온다(긴 구역 이름이 머리띠를 밀어내지 않는다)
        tap('[data-mview-set=manage]'); tap('[data-tab=z5]')
        if not page.locator('#guard').is_visible(): problems.append('6구역 탭에 다리 안전도 칸이 없다')
        if '×' not in text('guard-safety'): problems.append('다리 안전도가 없다: ' + text('guard-safety'))
        if not tap('#row-post'): problems.append('초소를 살 수 없다')
        page.wait_for_timeout(300)
        if not text('row-post').strip().startswith('초소') or '1 / 500' not in text('row-post'): problems.append('초소를 샀는데 수가 그대로다: ' + text('row-post')[:40])
        if '초당 +0' in text('guard-rate'): problems.append('초소가 있는데 통행 물자가 0이다: ' + text('guard-rate'))
        if not fits(): problems.append('한 화면에 들어오지 않는다(6구역)')
        tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다(6구역 상황)')
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
        if '아직 열지 않은' not in text('soon'): problems.append('아직 열지 않은 6구역 탭에 안내가 없다: ' + text('soon'))
        tap('[data-mview-set=record]'); tap('[data-rtab-set=help]'); tap('[data-rtab-set=radio]'); tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
    elif mode == 'rail':
        # 4구역: 열차가 없을 때의 안내 → 열차와 순환선 → 운행이 시작되고 → 30초 뒤 화물이 들어오는지
        tap('[data-mview-set=manage]'); tap('[data-tab=z3]')
        if not page.locator('#rail').is_visible(): problems.append('4구역 탭에 노선 칸이 없다')
        # 3.4.0 승강장의 열차: 열차가 없을 때의 안내 → 사면 화물칸이 붙고 → 눌러서 보내면 물자가 한꺼번에 들어온다
        if '승강장에 열차가 서요' not in text('plat-note'): problems.append('열차가 없을 때의 안내가 없다: ' + text('plat-note'))
        if not page.is_disabled('#train-go'): problems.append('열차가 없는데 출발 단추가 눌린다')
        for gone in ['#green', '#railmap', '#rail-list']:
            if page.locator(gone).count() and page.locator(gone).is_visible(): problems.append('없앤 것이 보인다: ' + gone)
        if not tap('#row-train'): problems.append('열차를 살 수 없다')
        pps0 = text('pps')
        if not tap('#row-route-grade'): problems.append('화물 등급을 살 수 없다')
        if text('pps') == pps0: problems.append('화물 등급을 샀는데 초당이 그대로다: ' + pps0)
        crew0 = text('row-route-crew')
        if not tap('#row-route-crew'): problems.append('연결 작업반을 살 수 없다')
        if text('row-route-crew') == crew0 or '초마다' not in text('row-route-crew'): problems.append('연결 작업반을 샀는데 간격이 그대로다: ' + text('row-route-crew'))
        tap('#row-train'); tap('#row-train')
        for old in ['#row-route-loop', '#row-route-express', '#row-signal', '#row-timetable']:
            if page.locator(old).count(): problems.append('옛 줄이나 개조가 남아 있다: ' + old)
        if page.locator('#plat-pips i').count() != 8: problems.append('화물칸 눈금이 여덟 개가 아니다: %d' % page.locator('#plat-pips i').count())
        if not page.evaluate("(() => { const c = document.getElementById('platform'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]); return seen.size >= 20; })()"): problems.append('승강장 그림이 그려지지 않았다')
        if not fits(): problems.append('한 화면에 들어오지 않는다(4구역)')
        page.wait_for_timeout(11500); clear(); tap('[data-mview-set=manage]'); tap('[data-tab=z3]')      # 화물칸 두 개가 붙을 시간
        cars = text('plat-cars')
        if '화물칸 2 / 8' not in cars and '화물칸 3 / 8' not in cars: problems.append('화물칸이 붙지 않는다: ' + cars)
        if page.locator('#plat-pips i.on').count() < 2: problems.append('눈금이 켜지지 않는다')
        left = text('plat-horde-left')
        if left not in ('멀어요', '다가와요', '코앞이에요'): problems.append('무리와의 거리 글이 이상하다: ' + left)
        if '초' in left: problems.append('무리가 닿는 시간이 숫자로 보인다: ' + left)
        bar = page.evaluate("parseFloat(document.getElementById('plat-horde-bar').style.width)")
        if not (0 <= bar <= 100): problems.append('무리와의 거리 막대가 이상하다: %s' % bar)
        if page.is_disabled('#train-go') or '+' not in text('train-go'): problems.append('출발 단추에 받을 물자가 없다: ' + text('train-go'))
        # 손이 할 일: 그림을 누르면 칸이 빨리 붙고, 경적은 열차마다 한 번
        c0 = int(text('plat-cars').split('화물칸 ')[1].split(' /')[0])
        tap('#platform')      # 운영 쪽으로 넘어가서 한 번 누른다
        # 손가락으로 빠르게 두드려도 한 번 한 번이 다 먹어야 한다(3.8.0 에서는 첫 번째만 먹었다).
        #   손가락 누르기(touchstart → touchend)를 60ms 간격으로 열두 번 만들어 보낸다. 빠른 누르기는 게임이 직접 처리하므로, 처음 하나를 뺀 열한 번이 당겨져야 한다
        page.evaluate("""() => new Promise((done) => { const el = document.getElementById('platform'), r = el.getBoundingClientRect(); let k = 0;
          const one = () => { const x = r.left + 30 + (k % 4) * 40, y = r.top + r.height * 0.6, t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
            el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
            if (++k < 12) setTimeout(one, 60); else done(); };
          one(); })""")
        page.wait_for_timeout(200)
        c1 = int(text('plat-cars').split('화물칸 ')[1].split(' /')[0])
        if c1 <= c0: problems.append('그림을 열두 번 눌렀는데 칸이 안 늘었다: %d → %d' % (c0, c1))
        import re as _re2
        page.wait_for_timeout(300); pulled = int(page.get_attribute('#platform', 'data-pulls') or 0)
        if pulled < 12: problems.append('빠르게 열두 번 두드렸는데 %d번만 당겨졌다' % pulled)
        if text('train-horn').strip() != '경적 1' or page.is_disabled('#train-horn'): problems.append('경적 단추가 이상하다: ' + text('train-horn'))
        bar0 = page.evaluate("parseFloat(document.getElementById('plat-horde-bar').style.width)")
        tap('#train-horn'); page.wait_for_timeout(150)
        if page.evaluate("parseFloat(document.getElementById('plat-horde-bar').style.width)") <= bar0 and bar0 < 99: problems.append('경적을 울렸는데 무리가 그대로다')
        if not page.is_disabled('#train-horn'): problems.append('경적을 다 썼는데 또 눌린다')
        tap('#train-go'); page.wait_for_timeout(1200)
        if page.get_attribute('#platform', 'data-sent') != '1': problems.append('보냈는데 횟수가 안 오른다: ' + str(page.get_attribute('#platform', 'data-sent')))
        if text('plat-note').count('\n') > 0 or len(text('plat-note')) > 40: problems.append('승강장 안내가 길다: ' + text('plat-note'))
        if '화물칸 0 / 8' not in text('plat-cars'): problems.append('보낸 뒤 새 열차가 서지 않는다: ' + text('plat-cars'))
        if page.is_disabled('#train-horn'): problems.append('새 열차인데 경적이 돌아오지 않았다')
        for up in ['#row-longplat', '#row-fence', '#row-horn', '#row-coupler', '#row-yard']:
            if not page.locator(up).count(): problems.append('새 개조가 없다: ' + up)
        if not page.is_disabled('#train-go'): problems.append('빈 열차인데 출발 단추가 눌린다')
        tap('[data-tab=z4]')
        if '아직 열지 않은' not in text('soon'): problems.append('잠긴 5구역 탭에 안내가 없다: ' + text('soon'))
        if page.locator('[data-tab=z5]').is_visible(): problems.append('아직 먼 6구역 탭이 보인다')
        tap('[data-mview-set=record]'); tap('[data-rtab-set=help]'); tap('[data-rtab-set=journal]'); tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
    else:
        # 시세판: 막대가 보이고(지금 시세 하나는 반드시), 연속 호가 칸이 다섯 개다
        tap('[data-mview-set=manage]'); tap('[data-tab=z1]')
        if page.locator('#board-bars i.now').count() != 1: problems.append('시세판에 지금 시세 막대가 없다')
        if page.locator('#streak-pips i').count() != 5: problems.append('연속 호가 칸이 다섯 개가 아니다')
        if not text('streak-note'): problems.append('연속 호가 안내가 없다')
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
        if '사용 0' not in text('trait-points'): problems.append('특성을 되돌렸는데 쓴 샘플이 남았다: ' + text('trait-points'))
        tap('#row-immune'); tap('#row-bulwark')
        tap('[data-mview-set=record]')
        for t in ['radio', 'stats', 'notes', 'help', 'save', 'journal']: tap('[data-rtab-set=%s]' % t)
        tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
        if '[object' in page.inner_text('body'): problems.append('화면에 [object …] 가 찍혀 있다')
        page.wait_for_timeout(5000)
        tap('#signal')
        page.wait_for_timeout(65000)     # 무리 도착(50초)과 밤 결과(60초)를 지나간다
        close_story()
        logs = page.evaluate("[...document.querySelectorAll('#log li .log-text')].map(e => e.textContent).join(' / ')")
        # 막아낸 밤은 변이체와 10번째마다만 로그에 남는다(0.8.0). 그 밖의 밤은 통계의 '막아낸 밤'이 늘었는지로 본다
        waves = page.evaluate("JSON.parse(localStorage.getItem('%s') || '{}').wavesCleared || 0" % SAVE_KEY)      # 10초마다 자동 저장된 값
        if not any(k in logs for k in ['막아냈다', '뚫렸다', '버티기만']) and waves <= (state or {}).get('wavesCleared', 0): problems.append('밤이 지났는데 결과가 남지 않았다')
        if name.startswith('폰') and '무리가 도착했다' not in logs: problems.append('도착 경보가 무전 로그에 없다')
        # 철수: 누르면 확인 창이 뜨고, 거기서 한 번 더 골라야 한다
        zone_before = text('base-no')
        if not tap('#retreat'): problems.append('철수 단추를 누를 수 없다')
        page.wait_for_timeout(200)
        if not page.locator('#confirm').is_visible(): problems.append('철수 확인 창이 뜨지 않았다')
        if text('base-no') != zone_before: problems.append('확인도 하기 전에 철수됐다')
        tap('#confirm-yes'); page.wait_for_timeout(400); close_story()
        if text('base-no') != '1구역 주택가': problems.append('철수했는데 1구역이 아니다: ' + zone_before + ' → ' + text('base-no'))
        if text('supplies') != '0': problems.append('철수했는데 물자가 남았다: ' + text('supplies'))
        page.wait_for_timeout(1500)
    note = page.evaluate("document.getElementById('notice').hidden ? '' : document.getElementById('notice-text').textContent")
    if '문제가 생겼' in note: problems.append('화면의 오류 안내: ' + note)
    # 끝 검수(1.0.2): 어떤 경우든 마지막에 모든 화면을 돌며 "예전 것이 꼬였는지"를 본다. 새 기능을 넣다가 다른 곳이 망가지는 일을 잡으려는 것이다
    try:
        if os.environ.get('SELFTEST'): page.evaluate("document.querySelector('.mast, header, body').insertAdjacentHTML('beforeend', '<span>[object 시험]</span>')")      # 검수가 정말 잡아내는지 확인할 때만 쓴다
        views = ['base', 'manage', 'exped', 'record'] if page.locator('.mnav').first.is_visible() else [None]
        for v in views:
            if v: page.evaluate("document.querySelector('[data-mview-set=%s]').click()" % v); page.wait_for_timeout(250)
            where = v or '넓은 화면'
            found = page.evaluate("""() => {
              const out = [], vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
              const txt = document.body.innerText;
              for (const w of ['[object', 'undefined', 'NaN', 'Infinity']) if (txt.includes(w)) out.push('화면에 "' + w + '" 가 찍혀 있다');
              if (document.documentElement.scrollWidth > window.innerWidth) out.push('옆으로 넘친다');
              if (vis(document.getElementById('story')) && vis(document.getElementById('perk'))) out.push('일지 창과 특전 창이 겹쳐 떠 있다');
              document.querySelectorAll('.row-mile').forEach((e) => { if (vis(e) && !e.children.length) out.push('빈 2배 딱지가 보인다: ' + (e.parentElement.textContent || '').slice(0, 12)); });
              document.querySelectorAll('.row.nope, .row.pressed').forEach((e) => out.push('누름/부족 표시가 남아 있다: ' + e.id));
              document.querySelectorAll('button').forEach((e) => { if (vis(e) && !e.textContent.trim() && !e.querySelector('svg, img, i') && !e.getAttribute('aria-label')) out.push('글자 없는 단추: ' + (e.id || e.className)); });
              document.querySelectorAll('[id]').forEach((e) => { if (vis(e) && e.children.length === 0 && !e.textContent.trim().replace(/[·/]/g, '') && e.matches('p, span.label, .hint') && e.offsetHeight > 4) out.push('빈 글 칸: ' + e.id); });
              return out;
            }""")
            for f in found: problems.append('끝 검수(%s): %s' % (where, f))
    except Exception as e:
        problems.append('끝 검수를 돌리지 못했다: %s' % str(e)[:120])
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
