/* Feedback(의견 보내기) 단위 테스트. 실행: node --test test/feedback.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/feedback.js');
const C = require('../src/core.js');

const base = () => ({
  text: '3구역이 너무 빨리 끝나요', version: '0.6.4', zone: '3구역 공단',
  stats: { retreats: 2, bestZone: 2, antibodyTotal: 120, wavesCleared: 31, breaches: 1, play: 7500, away: 18000, run: 2400, days: 3,
    runs: [{ zone: 1, seconds: 2100, antibodies: 12 }, { zone: 2, seconds: 3000, antibodies: 40 }] },
  screen: { w: 390, h: 760 }, ua: 'Mozilla/5.0 (Linux; Android 14; SM-S911N Build/UP1A; wv) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36',
  duration: C.formatDuration, zoneName: i => (i + 1) + '구역 ' + C.ZONES[i].name
});

test('의견: 쓴 글과 판 정보가 한 덩어리로 묶인다', () => {
  const out = F.compose(base());
  assert.ok(out.startsWith('[7구역 의견] 알파 0.6.4\n'));
  assert.ok(out.includes('\n3구역이 너무 빨리 끝나요\n'));
  assert.ok(out.includes('현재: 3구역 공단 · 가장 멀리: 3구역 공단'));
  assert.ok(out.includes('철수 2번 · 항체 누적 120 · 막아낸 밤 31 · 뚫린 밤 1'));
  assert.ok(out.includes('플레이 2시간 5분 · 자리 비움 5시간 0분 · 이번 회차 40분 0초 · 3일째'));
  assert.ok(out.includes('지난 회차: 2구역 재래시장 35분 0초 (+12) / 3구역 공단 50분 0초 (+40)'));
  assert.ok(out.includes('기기: 안드로이드 · 앱 · 화면 390×760'));
});

test('의견: 사람을 알아볼 수 있는 정보와 긴 원문은 붙지 않는다', () => {
  const out = F.compose(base());
  assert.ok(!out.includes('SM-S911N'), '기기 모델명');
  assert.ok(!out.includes('Mozilla'), '브라우저 이름표 원문');
  assert.ok(!/@/.test(out), '이메일 같은 것');
});

test('의견: 빈 글은 보내지 않는다', () => {
  for (const t of ['', '   ', '\n\n', null, undefined, 42, {}]) {
    assert.equal(F.valid(t), false);
    assert.equal(F.compose(Object.assign(base(), { text: t })), '');
  }
  assert.equal(F.valid(' 좋아요 '), true);
});

test('의견: 글을 다듬는다(줄바꿈 정리, 길이 제한)', () => {
  assert.equal(F.clean('  가\r\n나\r다\n\n\n\n라  '), '가\n나\n다\n\n라');
  assert.equal(F.clean('가'.repeat(F.MAX_TEXT + 500)).length, F.MAX_TEXT);
});

test('의견: 빠지거나 깨진 값이 있어도 죽지 않는다', () => {
  for (const input of [null, undefined, 42, 'x', {}, { text: '글' }, { text: '글', stats: null, screen: 'x', ua: 7, duration: () => { throw new Error('x'); }, zoneName: () => { throw new Error('x'); } },
    { text: '글', stats: { runs: [null, 'x', { zone: NaN, seconds: -1, antibodies: 'x' }], bestZone: -3, play: Infinity } }]) {
    let out;
    assert.doesNotThrow(() => { out = F.compose(input); });
    assert.ok(!/undefined|NaN|null|\[object|Infinity/.test(out), out);
  }
  const out = F.compose({ text: '글' });
  assert.ok(out.includes('알파 ?') && out.includes('현재: ?') && out.includes('화면 0×0'));
  assert.ok(!out.includes('지난 회차'), '기록이 없으면 그 줄은 없다');
});

test('의견: 지난 판은 최근 것 몇 개만 붙인다', () => {
  const input = base();
  input.stats.runs = Array.from({ length: 10 }, (_, i) => ({ zone: 0, seconds: 60 * (i + 1), antibodies: i }));
  const line = F.compose(input).split('\n').find(l => l.startsWith('지난 회차'));
  assert.equal(line.split(' / ').length, F.MAX_RUNS);
});

test('의견: 기기 종류를 가린다', () => {
  assert.equal(F.device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari'), '아이폰·아이패드 · 브라우저');
  assert.equal(F.device('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile'), '안드로이드 · 브라우저');
  assert.equal(F.device('Mozilla/5.0 (Windows NT 10.0) Electron/30'), '윈도우 · PC 앱');
  assert.equal(F.device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari'), '맥 · 브라우저');
  assert.equal(F.device(''), '알 수 없음 · 브라우저');
  assert.equal(F.device(null), '알 수 없음 · 브라우저');
});

test('의견: GitHub 주소를 만든다', () => {
  const report = F.compose(base());
  const url = F.issueUrl('https://github.com/eifv013/Zone7', report, base().text);
  assert.ok(url.startsWith('https://github.com/eifv013/Zone7/issues/new?title='));
  const q = new URL(url).searchParams;
  assert.equal(q.get('title'), '[의견] 3구역이 너무 빨리 끝나요');
  assert.equal(q.get('body'), report);
  assert.equal(F.issueUrl('https://github.com/eifv013/Zone7/', report, 'x'), F.issueUrl('https://github.com/eifv013/Zone7', report, 'x'));
});

test('의견: 이상한 저장소 주소나 빈 글에는 주소를 만들지 않는다', () => {
  for (const repo of ['', null, 'http://github.com/a/b', 'https://evil.com/a/b', 'https://github.com/a', 'https://github.com/a/b/c', 'javascript:alert(1)']) {
    assert.equal(F.issueUrl(repo, '글', '글'), '', String(repo));
  }
  assert.equal(F.issueUrl('https://github.com/a/b', '', '글'), '');
});

test('의견: 주소가 너무 길면 본문을 잘라 맞춘다', () => {
  const long = F.compose(Object.assign(base(), { text: '가나다라마바사 '.repeat(400) }));
  const url = F.issueUrl('https://github.com/eifv013/Zone7', long, '가나다라마바사');
  assert.ok(url.length <= F.MAX_URL + 200, String(url.length));
  assert.ok(new URL(url).searchParams.get('body').endsWith('…(길어서 잘림)'));
  assert.doesNotThrow(() => decodeURIComponent(url.split('&body=')[1]), '한글이 중간에 잘려 깨지지 않는다');
});
