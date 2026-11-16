"""7구역 앱 아이콘 조합안: 위험 표지(1) + 송신탑(2) + 노란 우비(3). 24×24 도트.
손으로 문자열을 치는 대신, 작은 조각(주인공, 탑, 숫자 7, 테이프)을 격자에 찍어 조립한다."""
from PIL import Image, ImageDraw
import json
from icons import PAL, ICONS

N = 24
def grid(bg): return [[bg] * N for _ in range(N)]
def put(g, rows, x, y, skip='.'):
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != skip and 0 <= y + r < N and 0 <= x + c < N: g[y + r][x + c] = ch
def rect(g, x, y, w, h, ch):
    for r in range(y, y + h):
        for c in range(x, x + w):
            if 0 <= r < N and 0 <= c < N: g[r][c] = ch
def tape(g, y, h, phase=0):
    """노랑·검정 사선 테이프 띠."""
    for r in range(y, y + h):
        for c in range(N): g[r][c] = 'K' if ((c + r + phase) // 2) % 2 == 0 else 'Y'
def stars(g, pts):
    for x, y in pts:
        if g[y][x] == 'N': g[y][x] = 'P'

# 조각들 ---------------------------------------------------------------
HERO = [row[1:15].replace('N', '.') for row in ICONS['coat']['rows'][1:16]]          # 14×15 상반신
HERO[11] = HERO[11][:6] + 'YY' + HERO[11][8:]; HERO[12] = HERO[12][:6] + 'YY' + HERO[12][8:]   # 지퍼를 지우고
HERO[13] = HERO[13][:6] + 'YY' + HERO[13][8:]; HERO[14] = HERO[14][:6] + 'YY' + HERO[14][8:]
SEVEN_S = ["KKKK", "..KK", ".KK.", ".KK."]                                              # 가슴에 다는 작은 7
TOWER = [row[2:14].replace('N', '.') for row in ICONS['tower']['rows'][0:14]]           # 12×14, 전파 포함
TOWER_TOP = TOWER[:6]

def seven_big(ch, t=4):
    """굵은 7 (16×17). ch 로 칠한다."""
    rows = [['.'] * 16 for _ in range(17)]
    for r in range(t):
        for c in range(16): rows[r][c] = ch
    for r in range(t, 17):
        x = 12 - (r - t) * 8 // 13          # 오른쪽 위에서 왼쪽 아래로 내려오는 획
        for c in range(x, x + t + 1):
            if 0 <= c < 16: rows[r][c] = ch
    return [''.join(r) for r in rows]

def with_chest7(hero):
    h = [list(r) for r in hero]
    for r, row in enumerate(SEVEN_S):
        for c, ch in enumerate(row):
            if ch != '.': h[10 + r + 1][5 + c] = ch
    return [''.join(r) for r in h]

# 조합안 ---------------------------------------------------------------
def body_to(g, hero, x, y, last_row):
    """주인공을 찍고, 상반신 아래를 last_row 까지 같은 폭의 우비로 이어 붙인다(아래 띠와 사이가 뜨지 않게)."""
    put(g, hero, x, y)
    for r in range(y + len(hero), last_row + 1): put(g, [hero[-1].replace('K', 'Y')], x, r)

PLATE = ["YYYYYYYYY", "YKKKKKKKY", "YKKKKKKKY", "YYYYYKKKY", "YYYYKKKYY", "YYYKKKYYY", "YYYKKKYYY", "YYYKKKYYY", "YYYYYYYYY"]  # 9×9 표지판: 아이콘 1의 축소판

def combo_a():
    """밤의 거점: 위아래 위험 테이프, 뒤에 송신탑, 앞에 가슴에 7을 단 주인공."""
    g = grid('N')
    stars(g, [(2, 4), (8, 3), (21, 4), (3, 9), (22, 12)])
    put(g, TOWER, 11, 6)
    rect(g, 0, 20, N, 2, 'K')
    body_to(g, with_chest7(HERO), 1, 5, 21)
    tape(g, 0, 2); tape(g, 22, 2, 2)
    return g

def combo_b():
    """표지판과 탑: 왼쪽 위에 7 표지판(검은 테두리로 주인공과 구분), 오른쪽에 송신탑, 아래에 주인공."""
    g = grid('N')
    stars(g, [(13, 1), (22, 2), (1, 15), (2, 19)])
    put(g, TOWER, 12, 3)
    rect(g, 0, 22, N, 2, 'K')
    rect(g, 0, 0, 11, 12, 'K')                                         # 표지판 테두리
    put(g, PLATE, 1, 1)
    for c in range(1, 10): g[10][c] = 'K' if (c // 2) % 2 else 'Y'   # 표지판 아래의 테이프 한 줄
    body_to(g, HERO, 6, 10, 23)
    return g

def combo_c():
    """가장 단순한 안: 크게 잡은 주인공, 가슴의 7, 어깨 너머 탑 꼭대기, 아래 테이프 한 줄."""
    g = grid('N')
    stars(g, [(2, 2), (6, 4), (21, 10), (1, 9), (22, 17)])
    put(g, TOWER, 12, 1)
    body_to(g, with_chest7(HERO), 4, 5, 21)
    tape(g, 21, 3)
    return g

COMBOS = {
 'combo-a': ('밤의 거점', '위아래 테이프, 뒤의 송신탑, 가슴에 7을 단 주인공.', combo_a),
 'combo-b': ('표지판과 탑', '왼쪽 위에 7 표지판, 오른쪽에 송신탑, 아래에 주인공.', combo_b),
 'combo-c': ('주인공 중심', '주인공을 가운데 크게, 어깨 너머 탑, 아래에 테이프 한 줄.', combo_c),
}

def render(g, size, pad=0.0):
    im = Image.new('RGB', (size, size), PAL[g[0][0]]); d = ImageDraw.Draw(im)
    inner = size * (1 - 2 * pad); cell = inner / N; off = size * pad
    if pad:
        for r in range(N):
            for c in range(N):
                if r in (0, N - 1) or c in (0, N - 1):
                    x0 = 0 if c == 0 else off + c * cell; x1 = size if c == N - 1 else off + (c + 1) * cell
                    y0 = 0 if r == 0 else off + r * cell; y1 = size if r == N - 1 else off + (r + 1) * cell
                    d.rectangle([round(x0), round(y0), round(x1) - 1, round(y1) - 1], fill=PAL[g[r][c]])
    for r in range(N):
        for c in range(N):
            d.rectangle([round(off + c * cell), round(off + r * cell), round(off + (c + 1) * cell) - 1, round(off + (r + 1) * cell) - 1], fill=PAL[g[r][c]])
    return im

def svg(g):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">' % (N, N)]
    for r in range(N):
        c = 0
        while c < N:
            e = c
            while e + 1 < N and g[r][e + 1] == g[r][c]: e += 1
            out.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>' % (c, r, e - c + 1, PAL[g[r][c]]))
            c = e + 1
    return ''.join(out) + '</svg>'

if __name__ == '__main__':
    sheet = Image.new('RGB', (len(COMBOS) * 300 + 20, 430), '#cfcfc4'); data = {}
    for i, (k, (name, why, fn)) in enumerate(COMBOS.items()):
        g = fn(); x = 20 + i * 300
        assert all(ch in PAL for row in g for ch in row), k
        sheet.paste(render(g, 264), (x, 20))
        for j, s in enumerate((96, 48)):
            small = render(g, s * 4).resize((s, s), Image.LANCZOS)
            mask = Image.new('L', (s * 4, s * 4), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, s * 4 - 1, s * 4 - 1], radius=int(s * 4 * 0.22), fill=255)
            sheet.paste(small, (x + j * 116, 304), mask.resize((s, s), Image.LANCZOS))
        data[k] = {'name': name, 'why': why, 'svg': svg(g)}
    sheet.save('combo.png'); json.dump(data, open('combo.json', 'w'), ensure_ascii=False); print('ok')
