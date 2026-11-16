"""final.py(앱 아이콘) 단위 테스트. 실행: python3 -m unittest test_final -v"""
import os
import tempfile
import unittest

from PIL import Image

import final
from icons import PAL


class TapeTest(unittest.TestCase):
    def test_top_and_bottom_rows_are_tape_only(self):
        g = final.icon_grid(0)
        for r in (0, 1, final.CORE - 2, final.CORE - 1):
            self.assertTrue(set(g[r]) <= {'K', 'Y'}, '테이프 줄 %d 에 다른 색이 섞였다' % r)
            self.assertEqual(set(g[r]), {'K', 'Y'}, '테이프 줄 %d 이 한 색으로만 칠해졌다' % r)

    def test_stripes_are_diagonal(self):
        # 한 줄 내려가면 무늬가 한 칸 왼쪽으로 밀려야 사선이다.
        g = final.icon_grid(0)
        self.assertEqual(g[1][:-1], g[0][1:])

    def test_tape_pattern_continues_into_margin(self):
        # 여백이 있는 격자의 가운데 24칸은 테이프 줄에서 여백 없는 격자와 같아야 한다(무늬가 어긋나지 않는다).
        m = 3
        plain, wide = final.icon_grid(0), final.icon_grid(m)
        for r in (0, 1, final.CORE - 2, final.CORE - 1):
            self.assertEqual(wide[m + r][m:m + final.CORE], plain[r])

    def test_margin_rows_are_tape_too(self):
        m = 3
        wide = final.icon_grid(m)
        for r in list(range(m)) + list(range(len(wide) - m, len(wide))):
            self.assertTrue(set(wide[r]) <= {'K', 'Y'})


class GridTest(unittest.TestCase):
    def test_sizes(self):
        self.assertEqual(len(final.icon_grid(0)), 24)
        g = final.icon_grid(3)
        self.assertEqual(len(g), 30)
        self.assertTrue(all(len(row) == 30 for row in g))

    def test_every_cell_has_a_palette_color(self):
        for m in (0, 3):
            for row in final.icon_grid(m):
                for ch in row:
                    self.assertIn(ch, PAL)

    def test_content_is_identical_inside_margin(self):
        m = 3
        plain, wide = final.icon_grid(0), final.icon_grid(m)
        for r in range(final.TAPE, final.CORE - final.TAPE):
            self.assertEqual(wide[m + r][m:m + final.CORE], plain[r])

    def test_side_margin_is_night_sky(self):
        m = 3
        wide = final.icon_grid(m)
        for r in range(m + final.TAPE, len(wide) - m - final.TAPE):
            self.assertEqual(set(wide[r][:m]) | set(wide[r][-m:]), {'N'})

    def test_sign_tower_and_hero_survive(self):
        g = final.icon_grid(0)
        flat = ''.join(''.join(r) for r in g)
        self.assertIn('R', flat)          # 송신탑의 붉은 등
        self.assertIn('S', flat)          # 주인공의 얼굴
        self.assertEqual(''.join(g[4][2:9]), 'KKKKKKK')   # 7 의 윗획

    def test_bad_margin_is_rejected(self):
        for bad in (-1, 1.5, '3', None):
            with self.assertRaises(ValueError):
                final.icon_grid(bad)


class ExportTest(unittest.TestCase):
    def test_render_rejects_too_small(self):
        with self.assertRaises(ValueError):
            final.render(final.icon_grid(0), 10)

    def test_export_writes_all_files_with_right_sizes(self):
        with tempfile.TemporaryDirectory() as d:
            written = final.export(d)
            self.assertEqual(sorted(os.path.basename(p) for p in written), sorted(final.OUTPUTS))
            for name, (size, _) in final.OUTPUTS.items():
                with Image.open(os.path.join(d, name)) as im:
                    self.assertEqual(im.size, (size, size))

    def test_export_to_missing_folder_fails_loudly(self):
        with self.assertRaises(FileNotFoundError):
            final.export('/nonexistent/zone7-icons')

    def test_maskable_safe_zone_keeps_tape(self):
        # 원으로 잘려도 남는 가운데 80% 원 안에 테이프 색(노랑)이 위아래 모두 있어야 한다.
        size = 500
        im = final.render(final.icon_grid(3), size)
        yellow = tuple(int(PAL['Y'][i:i + 2], 16) for i in (1, 3, 5))
        cx = size // 2
        top = [im.getpixel((x, int(size * 0.16))) for x in range(cx - 60, cx + 60)]
        bottom = [im.getpixel((x, int(size * 0.84))) for x in range(cx - 60, cx + 60)]
        self.assertIn(yellow, top)
        self.assertIn(yellow, bottom)


if __name__ == '__main__':
    unittest.main()
