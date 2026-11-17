"""7구역 앱 아이콘 시안. 16×16 도트 지도(한 글자 = 한 칸)를 PNG 와 SVG 로 내보낸다."""
from PIL import Image, ImageDraw
import json, sys

PAL = {'Y':'#f0b400','K':'#17180f','N':'#3f74c0','P':'#e6e5db','R':'#e0392b','T':'#7d8c90','S':'#e2b48c','H':'#3a2a1e',
       'M':'#8b8f8a','D':'#6b6f6a','L':'#a3a7a1','y':'#c99600','G':'#7da35a','g':'#4a6a36','n':'#232a40','O':'#f08a3c'}

ICONS = {
 'sign': {'name': '위험 표지 7', 'why': '게임 화면의 위험 테이프와 같은 노랑·검정. 가장 작게 줄여도 7이 읽힌다.', 'rows': [
  "KKYYKKYYKKYYKKYY","KYYKKYYKKYYKKYYK","YYYYYYYYYYYYYYYY","YYYYKKKKKKKKYYYY","YYYYKKKKKKKKYYYY","YYYYYYYYYKKKYYYY","YYYYYYYYKKKYYYYY","YYYYYYYKKKYYYYYY",
  "YYYYYYKKKYYYYYYY","YYYYYYKKKYYYYYYY","YYYYYYKKKYYYYYYY","YYYYYYKKKYYYYYYY","YYYYYYYYYYYYYYYY","YYYYYYYYYYYYYYYY","YKKYYKKYYKKYYKKY","KKYYKKYYKKYYKKYY"]},
 'tower': {'name': '송신탑', 'why': '"생존자는 7구역으로 오라"를 내보내는 탑. 밤하늘, 붉은 불, 퍼져 나가는 전파.', 'rows': [
  "NNNYNNNNNNNNYNNN","NNYNNYNRRNYNNYNN","NNYNYNNRRNNYNYNN","NNYNNYNTTNYNNYNN","NNNYNNNTTNNNYNNN","NPNNNNNTTNNNNNPN","NNNNNNTTTTNNNNNN","NNNNNNTNNTNNNNNN",
  "NNNNNNTTTTNNNNNN","NNNNNTTNNTTNNNNN","NNNNNTNTTNTNNNNN","NNNNTTTNNTTTNNNN","NNNNTNNTTNNTNNNN","NNNTTTTTTTTTTNNN","KKKKKKKKKKKKKKKK","KKKKKKKKKKKKKKKK"]},
 'coat': {'name': '노란 우비', 'why': '도트 화면에서 물자를 나르는 주인공. 게임 아이콘으로 가장 친근하다.', 'rows': [
  "NNNNNNNNNNNNNNNN","NNNNNYYYYYYNNNNN","NNNNYYYYYYYYNNNN","NNNYYYYYYYYYYNNN","NNNYyHHHHHHyYNNN","NNNYySSSSSSyYNNN","NNNYYSKSSKSYYNNN","NNNYYSSSSSSYYNNN",
  "NNNYYSSHHSSYYNNN","NNNNYySSSSyYNNNN","NNNYYYYYYYYYYNNN","NNYYYYYYYYYYYYNN","NYYYYYYyyYYYYYYN","NYYYYYYKKYYYYYYN","NYYYYYYyyYYYYYYN","NYYYYYYKKYYYYYYN"]},
 'wall': {'name': '벽에 칠한 7', 'why': '일지 속 장면: 누군가 지붕에 페인트로 남긴 7과 화살표. 이 게임에만 있는 그림.', 'rows': [
  "MMMMMMMMMMMMLMMM","MMMMMMMMMMMMMMMM","MDMMMMMMMMMMMMMM","MMYYYYYYMMMMMMMM","MMYYYYYYMMMMMMMM","MMMMMMYYMMMMYMMM","MMMMMYYMMMMMYYMM","MMMMMYYMMYYYYYYM",
  "MMMMYYMMMYYYYYYM","MMMMYYMMMMMMYYMM","MMMMYYMMMMMMYMMM","MMMMYYMMMMMMMMDM","MMMMYYMMMMMMMMMM","MMMMyMMMMLMMMMMM","DDDDDDDDDDDDDDDD","KKKKKKKKKKKKKKKK"]},
}
for k, v in ICONS.items():
    assert len(v['rows']) == 16 and all(len(r) == 16 for r in v['rows']), k
    assert all(ch in PAL for r in v['rows'] for ch in r), k

def render(key, size, pad=0.0):
    """size 픽셀 정사각형으로 그린다. pad 는 가장자리 여백 비율(maskable 용): 여백은 모서리 색으로 채운다."""
    rows = ICONS[key]['rows']
    im = Image.new('RGB', (size, size), PAL[rows[0][0]]); d = ImageDraw.Draw(im)
    inner = size * (1 - 2 * pad); cell = inner / 16; off = size * pad
    if pad:  # 여백을 가장자리 칸의 색으로 늘려 채운다(잘려도 빈 띠가 생기지 않게)
        for r in range(16):
            for c in range(16):
                if r in (0, 15) or c in (0, 15):
                    x0 = 0 if c == 0 else off + c * cell; x1 = size if c == 15 else off + (c + 1) * cell
                    y0 = 0 if r == 0 else off + r * cell; y1 = size if r == 15 else off + (r + 1) * cell
                    d.rectangle([round(x0), round(y0), round(x1) - 1, round(y1) - 1], fill=PAL[rows[r][c]])
    for r in range(16):
        for c in range(16):
            d.rectangle([round(off + c * cell), round(off + r * cell), round(off + (c + 1) * cell) - 1, round(off + (r + 1) * cell) - 1], fill=PAL[rows[r][c]])
    return im

def svg(key):
    rows = ICONS[key]['rows']; out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">']
    for r in range(16):
        c = 0
        while c < 16:  # 같은 색이 이어지는 칸은 한 사각형으로 묶는다
            e = c
            while e + 1 < 16 and rows[r][e + 1] == rows[r][c]: e += 1
            out.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>' % (c, r, e - c + 1, PAL[rows[r][c]]))
            c = e + 1
    return ''.join(out) + '</svg>'

if __name__ == '__main__':
    sheet = Image.new('RGB', (4 * 300 + 20, 430), '#cfcfc4')
    for i, k in enumerate(ICONS):
        big = render(k, 256); x = 20 + i * 300
        sheet.paste(big, (x, 20))
        # 홈 화면처럼 둥근 모서리로 잘린 모습(96, 48픽셀)
        for j, s in enumerate((96, 48)):
            small = render(k, s * 4).resize((s, s), Image.LANCZOS)
            mask = Image.new('L', (s * 4, s * 4), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, s * 4 - 1, s * 4 - 1], radius=int(s * 4 * 0.22), fill=255)
            sheet.paste(small, (x + j * 116, 300), mask.resize((s, s), Image.LANCZOS))
        open(k + '.svg', 'w').write(svg(k))
    sheet.save('sheet.png')
    json.dump({k: {'name': v['name'], 'why': v['why'], 'svg': svg(k)} for k, v in ICONS.items()}, open('icons.json', 'w'), ensure_ascii=False)
    print('ok', sheet.size)
