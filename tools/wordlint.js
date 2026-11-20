/*
 * 낱말 검수: 화면에 나오는 글에서 쓰지 않기로 한 낱말을 찾는다(test/words.test.js 가 부른다).
 *   왜: 같은 지적("지금" 말고 "현재", 뜻을 알 수 없는 "문 값" 등)이 되풀이됐다. 사람이 기억해서 지키는 대신 테스트가 막는다.
 *   방법: 줄 단위로 본다. 주석 줄(// · * · /*)과 줄 끝 주석은 버리고, 따옴표 안의 글만 본다. template.html 은 태그를 지운 글을 본다.
 *   일지·이야기 글(STORY, 따옴표 속 대사)은 문학 글이라 '지금'을 허용한다: core.js 의 이야기 구간은 건너뛴다(allow 로 표시한 줄 포함).
 */
'use strict';
var fs = require('fs'), path = require('path');
var BANNED = [
  { re: /지금/, why: '"지금" 대신 "현재"' },
  { re: /문 값/, why: '"문 값"은 뜻을 알 수 없다 → "다음 구역을 여는 값"' },
  { re: /(이번|다음|한|지난) 판|판마다/, why: '회차를 "판"이라고 부르지 않는다 → "회차"' },
  { re: /(^|[^가-힣])판(이|의|에|을|은|도|과|으로|에서|이에요)?(?![가-힣])/, why: '"판"이라는 말을 쓰지 않는다(합치기 판도) → 칸 · 상자' },
  { re: /자동 합치기/, why: '3구역 자동의 이름은 "조립공"' },
  { re: /돌진을? ?끊|돌진이 끊/, why: '돌진은 "막는다"고 쓴다' },
  { re: /연구 성과|연구 점수|연구 속도/, why: '없앤 것(4.0.5). 5구역의 덤은 "병원 서류 · 혈청 값"' },
  { re: /갈림길/, why: '5구역에서 고르는 것은 "연구 성과"' },
  { re: /밤샘 연구|다른 과제 보기/, why: '없앤 기능의 이름' },
  { re: /떼가 몰려|떼를 막|떼 ·|다음 떼/, why: '6구역에서 몰려오는 것은 "무리 습격"' }
];
function quoted(line) { var out = [], m, re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g; while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]); return out; }
function scan(root) {
  var hits = [];
  ['src/ui.js', 'src/core.js', 'src/help.js'].forEach(function (f) {
    var story = false;
    fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach(function (raw, i) {
      var line = raw.trim();
      if (/^(\/\/|\*|\/\*)/.test(line)) return;
      if (/words-allow/.test(raw)) return;
      if (f === 'src/core.js' && /var (STORY|JOURNAL|NOTES_TEXT|LETTERS|ENDING_PAGES|RECORDS|TAPES)\b/.test(line)) story = true;      // 이야기 글 구간
      if (story) { if (/^\];?$/.test(line) || /^\};?$/.test(line)) story = false; return; }
      line = line.replace(/\s\/\/ .*$/, '').replace(/\/\*.*?\*\//g, '');
      quoted(line).forEach(function (s) { BANNED.forEach(function (b) { if (b === BANNED[0] && f === 'src/core.js' && /다\./.test(s)) return;      /* 일지 글('~다' 말투의 이야기)은 문학 글이라 '지금'을 둔다 */
        if (!b.from && b.re.test(s)) hits.push(f + ':' + (i + 1) + ' ' + b.why + ' — ' + s.slice(0, 80)); }); });
    });
  });
  var t = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, function (m) { return m.replace(/[^\n]/g, ''); }).replace(/<style[\s\S]*?<\/style>/g, function (m) { return m.replace(/[^\n]/g, ''); }).replace(/<script[\s\S]*?<\/script>/g, function (m) { return m.replace(/[^\n]/g, ''); });
  t.split('\n').forEach(function (l, i) { var txt = l.replace(/<[^>]*>/g, ' '); BANNED.forEach(function (b) { if (!b.from && b.re.test(txt)) hits.push('src/template.html:' + (i + 1) + ' ' + b.why + ' — ' + txt.trim().slice(0, 80)); }); });
  return hits;
}
module.exports = { scan: scan, BANNED: BANNED };
if (require.main === module) { var h = scan(path.join(__dirname, '..')); console.log(h.join('\n') || '깨끗하다'); process.exit(h.length ? 1 : 0); }
