#!/usr/bin/env python3
"""
5.1.5 글꼴(SIL OFL 1.1)을 게임에 넣을 만큼만 잘라 assets/fonts/ 에 둔다. 5.2.1 부터 갈무리 대신 주아(jua.woff)를 쓴다: 같은 방법으로 Jua-Regular.ttf 를 잘라 jua.woff 로.
  왜: 통째로 넣으면 글꼴 하나가 500KB 가 넘는다. 게임 글자(src 전체) + 자주 쓰는 한글 2,350자(KS X 1001, 이름 짓기용) + 영문 · 숫자 · 기호만 남긴다.
  쓰는 법: python3 tools/fontsubset.py <갈무리 압축을 푼 폴더>
  남는 것: galmuri11.woff · galmuri11-bold.woff · galmuri-mono11.woff(숫자 · 영문만) · OFL.txt
  빠진 글자(드문 한글 등)는 CSS 의 다음 글꼴로 그려진다.
"""
import sys, os, glob
from fontTools import subset
src_dir = sys.argv[1] if len(sys.argv) > 1 else None
if not src_dir or not os.path.isdir(src_dir): sys.exit('갈무리 폴더를 주세요')
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'assets', 'fonts'); os.makedirs(out, exist_ok=True)
chars = set()
for f in glob.glob(os.path.join(root, 'src', '*')):
    try: chars |= set(open(f, encoding='utf8').read())
    except Exception: pass
for hi in range(0xB0, 0xC9):      # KS X 1001 한글 2,350자
    for lo in range(0xA1, 0xFF):
        try: chars.add(bytes([hi, lo]).decode('euc-kr'))
        except Exception: pass
chars |= set(chr(c) for c in range(0x20, 0x7F))
chars |= set('·…—–―‘’“”「」『』《》〈〉×÷±→←↑↓★☆♥♡●○■□▲△▼▽◆◇♪✓✗%₩')
chars = {c for c in chars if c.isprintable() and ord(c) >= 0x20}
mono = set(chr(c) for c in range(0x20, 0x7F)) | set('·×%₩+−-:./,')
def cut(name, keep, dest):
    o = subset.Options(); o.flavor = 'woff'      # woff2 는 brotli 가 있어야 해서 woff(zlib)로; o.layout_features = ['*']; o.name_IDs = ['*']; o.notdef_outline = True
    f = subset.load_font(os.path.join(src_dir, name), o)
    s = subset.Subsetter(o); s.populate(text=''.join(sorted(keep))); s.subset(f)
    subset.save_font(f, os.path.join(out, dest), o)
    print(dest, os.path.getsize(os.path.join(out, dest)), 'bytes')
cut('Galmuri11.ttf', chars, 'galmuri11.woff')
cut('Galmuri11-Bold.ttf', chars, 'galmuri11-bold.woff')
cut('GalmuriMono11.ttf', mono, 'galmuri-mono11.woff')
lic = os.path.join(src_dir, 'LICENSE.txt')
if os.path.exists(lic): open(os.path.join(out, 'OFL.txt'), 'w', encoding='utf8').write(open(lic, encoding='utf8').read())
