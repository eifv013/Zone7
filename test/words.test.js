'use strict';
/* 낱말 검수(3.9.0): 화면 글에 쓰지 않기로 한 낱말이 다시 들어오면 여기서 막는다. 목록과 까닭은 tools/wordlint.js 에 있다. */
const test = require('node:test'), assert = require('node:assert'), path = require('path');
const lint = require('../tools/wordlint.js');
test('화면 글에 쓰지 않기로 한 낱말이 없다(지금 · 문 값 · 판 · 자동 합치기)', () => {
  const hits = lint.scan(path.join(__dirname, '..'));
  assert.deepEqual(hits, [], '\n' + hits.join('\n'));
});
test('낱말 검수기가 실제로 잡아낸다', () => {
  for (const [bad] of [['지금 철수'], ['문 값 ×2'], ['이번 판'], ['자동 합치기']]) assert.ok(lint.BANNED.some((b) => b.re.test(bad)), bad);
  assert.ok(!lint.BANNED.slice(0, 4).some((b) => b.re.test('판이 가득 찼어요 · 현재 회차')), '합치기 판은 괜찮다');
});
