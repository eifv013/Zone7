"""7구역 앱 아이콘 최종안: '표지판과 탑'(combo-b) + 위아래 경고 테이프.

구조
  icon_grid(margin)  순수 함수. 문자 격자((24+2*margin)칸 정사각형)를 돌려준다. 그림 파일을 만지지 않는다.
  export(out_dir)    격자를 PNG 로 그려 게임 프로젝트가 쓰는 파일 이름으로 저장한다.
  preview(path)      네모, 둥근 네모, 원 마스크로 잘랐을 때의 모습을 한 장에 모은다.

margin 을 둔 이유
  안드로이드의 maskable 아이콘은 가장자리 10% 가량이 잘려 나간다. 예전에는 그림을 줄이고 남는 곳을
  밤하늘 색으로 채웠지만, 그러면 맨 위와 맨 아래에 있는 테이프가 잘려 사라진다. 그래서 여백 칸에도
  같은 사선 무늬를 이어 그려, 어떤 모양으로 잘려도 테이프가 남도록 했다.
"""
import os
import sys
from PIL import Image, ImageDraw

from icons import PAL
from combo import HERO, TOWER, PLATE, put, rect, body_to

CORE = 24          # 그림 본체의 한 변(칸)
TAPE = 2           # 본체 안에서 테이프가 차지하는 줄 수(위, 아래 각각)
STRIPE = 2         # 사선 줄무늬 한 줄의 굵기(칸)
STARS = [(13, 3), (22, 4), (1, 16), (3, 19)]   # 본체 좌표 기준 별의 위치


def tape_color(col, row):
    """사선 줄무늬에서 (col, row) 칸의 색. 좌표가 음수여도 무늬가 끊기지 않게 나머지 연산만 쓴다."""
    return 'K' if ((col + row) // STRIPE) % 2 == 0 else 'Y'


def icon_grid(margin=0):
    """아이콘 격자를 만든다. margin 은 본체 바깥에 덧붙이는 칸 수(maskable 용)."""
    if not isinstance(margin, int) or margin < 0:
        raise ValueError('margin 은 0 이상의 정수여야 한다: %r' % (margin,))
    size = CORE + 2 * margin

    # 1) 본체를 24칸 격자에 먼저 그린다. combo.py 의 조각 함수가 24칸을 전제로 하기 때문이다.
    core = [['N'] * CORE for _ in range(CORE)]
    for x, y in STARS:
        core[y][x] = 'P'
    put(core, TOWER, 12, 5)                       # 송신탑: 테이프 두 줄만큼 아래로 내렸다
    rect(core, 0, TAPE, 11, 11, 'K')              # 표지판 테두리: 위 테이프에 매달린 모양
    put(core, PLATE, 1, TAPE + 1)                 # 7 표지판
    body_to(core, HERO, 6, 12, CORE - 1)          # 주인공: 표지판 테두리 바로 아래에서 시작해 두 그림이 붙지 않는다

    # 2) 바깥 격자에 본체를 옮기고, 여백은 밤하늘로 둔다.
    grid = [['N'] * size for _ in range(size)]
    for r in range(CORE):
        for c in range(CORE):
            grid[margin + r][margin + c] = core[r][c]

    # 3) 테이프는 맨 마지막에, 격자 전체 폭으로 그린다. 주인공이 통제선 뒤에 서 있는 모양이 된다.
    band = margin + TAPE
    for r in list(range(band)) + list(range(size - band, size)):
        for c in range(size):
            grid[r][c] = tape_color(c - margin, r - margin)
    return grid


def render(grid, size):
    """격자를 size 픽셀 정사각형 그림으로. 칸 경계는 반올림해 틈이 생기지 않게 한다."""
    n = len(grid)
    if size < n:
        raise ValueError('그림 크기(%d)가 격자 칸 수(%d)보다 작다' % (size, n))
    im = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(im)
    cell = size / n
    for r in range(n):
        for c in range(n):
            d.rectangle([round(c * cell), round(r * cell), round((c + 1) * cell) - 1, round((r + 1) * cell) - 1], fill=PAL[grid[r][c]])
    return im


# 파일 이름 -> (픽셀 크기, 여백 칸 수). 여백 3칸이면 본체가 전체의 80% 를 차지한다(maskable 안전 영역).
OUTPUTS = {
    'icon-192.png': (192, 0),
    'icon-512.png': (512, 0),
    'apple-touch-icon.png': (180, 0),
    'icon-maskable-512.png': (512, 3),
}


def export(out_dir):
    """OUTPUTS 의 파일을 out_dir 에 쓴다. 폴더가 없으면 조용히 만들지 않고 알린다(오타로 엉뚱한 곳에 쓰는 일을 막는다)."""
    if not os.path.isdir(out_dir):
        raise FileNotFoundError('아이콘을 쓸 폴더가 없다: ' + out_dir)
    written = []
    for name, (size, margin) in OUTPUTS.items():
        path = os.path.join(out_dir, name)
        render(icon_grid(margin), size).save(path)
        written.append(path)
    return written


def preview(path, size=200):
    """네모 / 둥근 네모 / 원(안드로이드 maskable) 세 가지로 잘랐을 때의 모습과 작은 크기를 한 장에."""
    gap = 20
    sheet = Image.new('RGB', (gap + 3 * (size + gap) + 96 + gap, size + 2 * gap), '#cfcfc4')
    big = size * 4
    plain = render(icon_grid(0), big)
    mask_src = render(icon_grid(3), big)

    def pasted(src, x, shape):
        mask = Image.new('L', (big, big), 0)
        md = ImageDraw.Draw(mask)
        if shape == 'square': md.rectangle([0, 0, big - 1, big - 1], fill=255)
        elif shape == 'round': md.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=255)
        else: md.ellipse([0, 0, big - 1, big - 1], fill=255)
        sheet.paste(src.resize((size, size), Image.LANCZOS), (x, gap), mask.resize((size, size), Image.LANCZOS))

    pasted(plain, gap, 'square')
    pasted(plain, gap + (size + gap), 'round')
    pasted(mask_src, gap + 2 * (size + gap), 'circle')
    x = gap + 3 * (size + gap)
    for s, y in ((96, gap), (48, gap + 96 + 16)):      # 홈 화면에서 실제로 보이는 크기
        sheet.paste(plain.resize((s, s), Image.LANCZOS), (x, y))
    sheet.save(path)
    return path


if __name__ == '__main__':
    targets = sys.argv[1:]
    if not targets:
        print('사용법: python3 final.py <아이콘을 쓸 폴더> [...]'); sys.exit(2)
    try:
        for t in targets:
            for p in export(t): print('wrote', p)
        print('wrote', preview(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'final.png')))
    except (OSError, ValueError) as e:
        print('아이콘 생성 실패:', e); sys.exit(1)
