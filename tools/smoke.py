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

# (이름, 화면 크기, 저장, 할 일)
CASES = [
    ('폰 · 2구역, 못 막는 밤', (390, 760), market(), 'full'),
    ('PC · 2구역, 막는 밤', (1280, 900), market(defenses={"wire": 60, "tower": 40, "turret": 30, "flame": 10}, autoSell=True), 'full'),
    ('폰 · 새 게임', (390, 760), None, 'new'),
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
    page.wait_for_timeout(1000)

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
        for t in ['radio', 'stats', 'notes', 'help', 'save', 'journal']: tap('[data-rtab-set=%s]' % t)
        tap('[data-mview-set=base]')
        if not fits(): problems.append('한 화면에 들어오지 않는다')
        if '초당 +0' in text('pps') and '0.5' not in text('pps'): problems.append('수색조를 샀는데 생산이 0이다: ' + text('pps'))
        page.wait_for_timeout(6000)
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
        if '다음 버전' not in text('soon'): problems.append('3구역 탭에 준비 중 안내가 없다: ' + text('soon'))
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
