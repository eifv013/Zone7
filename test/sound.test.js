/*
 * Sound 단위 테스트 — 소리 정의가 올바른지와, 오디오가 없는 환경에서 안전한지를 본다.
 * 실제로 스피커에서 나는 소리는 여기서 검증할 수 없다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Sound = require('../src/sound.js');

test('모든 소리는 유한한 길이와 상한 이하의 음량을 가진다', () => {
  const names = Object.keys(Sound.SOUNDS);
  assert.ok(names.length >= 8);
  for (const name of names) {
    const notes = Sound.SOUNDS[name];
    assert.ok(Array.isArray(notes) && notes.length > 0, name);
    for (const n of notes) {
      assert.ok(n.d > 0 && n.d <= 1, `${name}: 길이 ${n.d}`);
      assert.ok((n.at || 0) >= 0, name);
      assert.ok((n.g || 0.05) <= Sound.MAX_GAIN, `${name}: 음량 ${n.g}`);
      if (n.noise) assert.ok(n.cut > 0, `${name}: 소음에는 차단 주파수가 필요하다`);
      else assert.ok(n.f >= 40 && n.f <= 4000, `${name}: 주파수 ${n.f}`);
    }
    assert.ok(Sound.duration(name) > 0 && Sound.duration(name) <= 1.5, `${name}: 전체 ${Sound.duration(name)}초`);
  }
});

test('화면에서 쓰는 소리 이름이 모두 정의되어 있다', () => {
  for (const name of ['click', 'buy', 'dusk', 'defended', 'breached', 'signal', 'expedition', 'story', 'type', 'relocate']) {
    assert.ok(Sound.SOUNDS[name], name);
  }
});

test('오디오가 없는 환경에서도 오류 없이 false 를 돌려준다', () => {
  assert.equal(Sound.unlock(), false);
  assert.equal(Sound.play('click'), false);
  assert.equal(Sound.play('없는소리'), false);
  assert.equal(Sound.duration('없는소리'), 0);
});

test('켜고 끄기는 불리언 true 만 켜짐으로 인정한다', () => {
  assert.equal(Sound.isEnabled(), true, '기본은 켜짐');
  assert.equal(Sound.setEnabled(false), false);
  assert.equal(Sound.setEnabled('yes'), false);
  assert.equal(Sound.setEnabled(true), true);
});
