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

test('소리는 부드러운 파형만 쓰고, 높은 음은 거름막 아래에 있다(0.8.5)', () => {
  const S = require('../src/sound.js');
  for (const [name, notes] of Object.entries(S.SOUNDS)) for (const n of notes) {
    if (n.noise) { assert.ok(n.cut <= 400, name); continue; }
    assert.ok(['sine', 'triangle'].includes(n.type), name + ': ' + n.type);
    assert.ok(n.f <= 1000 && n.f < Sound.SOFT_CUT, name + ': ' + n.f);
    if (n.to !== undefined) assert.ok(n.to > 0 && n.to <= 1200, name + ' to: ' + n.to);
    assert.ok(n.g <= S.MAX_GAIN, name);
  }
});

test('음량: 0 ~ 100 으로 맞추고 기본은 50, 잘못된 값은 기본으로 본다. 0 이면 소리를 내지 않는다', () => {
  const S = require('../src/sound.js');
  assert.equal(S.getVolume(), 50);
  assert.deepEqual([0, 100, 73.4, -5, 250, '30', NaN, null, undefined, 'x', ''].map(S.setVolume), [0, 100, 73, 0, 100, 30, 50, 50, 50, 50, 50]);
  S.setVolume(0); assert.equal(S.play('click'), false);
  S.setVolume(50);
  for (const name of ['sell', 'peak', 'surge', 'green', 'answer', 'fortify', 'goal', 'feed', 'tab']) assert.ok(S.duration(name) > 0, name);
});

/* ================= 배경 음악 ================= */

test('배경 음악: 곡은 셋이고, 곡마다 여덟 마디의 화음과 가락이 있다', () => {
  assert.deepEqual(Object.keys(Sound.MUSIC), ['day', 'night', 'dread']);
  for (const [name, def] of Object.entries(Sound.MUSIC)) {
    assert.ok(def.bpm >= 50 && def.bpm <= 140, name);
    assert.equal(def.chords.length, Sound.MUSIC_BARS, name); assert.equal(def.lead.length, Sound.MUSIC_BARS, name);
    for (const bar of def.lead) for (const [at, m, len] of bar) {
      assert.ok(at >= 0 && at < Sound.MUSIC_STEPS && len >= 1 && at + len <= Sound.MUSIC_STEPS, name + ': 가락은 마디를 넘지 않는다');
      assert.ok(m >= 60 && m <= 88, name + ': 가락의 높이');
    }
  }
  assert.ok(Sound.MUSIC.day.bpm > Sound.MUSIC.night.bpm && Sound.MUSIC.night.bpm > Sound.MUSIC.dread.bpm, '밤일수록, 위험할수록 느리다');
});

test('배경 음악: 칸마다 내는 음은 들을 수 있는 높이이고 작으며, 마디마다 소리가 난다', () => {
  for (const mood of ['day', 'night', 'dread']) {
    let total = 0;
    for (let bar = 0; bar < Sound.MUSIC_BARS; bar++) {
      let inBar = 0;
      for (let st = 0; st < Sound.MUSIC_STEPS; st++) {
        const notes = Sound.musicStep(mood, bar, st);
        assert.ok(notes.length <= 8, '한 칸에 여덟 음을 넘지 않는다');
        for (const n of notes) {
          assert.ok(n.g > 0 && n.g <= 0.09, mood + ': 효과음보다 작다');
          assert.ok(n.d > 0.02 && n.d < 6, mood + ': 길이');
          if (!n.noise) assert.ok(n.f >= 60 && n.f <= 800, mood + ': 높이 ' + n.f + ' (800Hz 를 넘는 음은 귀를 찌른다)');
          if (n.noise) assert.ok(n.cut <= 900 && n.g <= 0.008, mood + ': 잡음 박자는 낮고 작게');
          assert.ok(n.type !== 'square' && n.type !== 'sawtooth', '거친 파형은 쓰지 않는다');
        }
        inBar += notes.length;
      }
      assert.ok(inBar >= 4, mood + ' ' + bar + '마디가 비어 있다'); total += inBar;
    }
    assert.ok(total >= 60, mood);
  }
  assert.ok(Math.abs(Sound.musicStepSeconds('day') - 60 / 92 / 4) < 1e-9);
});

test('배경 음악: 모르는 곡과 범위를 벗어난 마디·칸, 잘못된 값에도 죽지 않는다', () => {
  assert.deepEqual(Sound.musicStep('없는 곡', 0, 0), Sound.musicStep('day', 0, 0));
  assert.deepEqual(Sound.musicStep('night', 8, 16), Sound.musicStep('night', 0, 0));
  assert.deepEqual(Sound.musicStep('dread', -1, -1), Sound.musicStep('dread', 7, 15));
  assert.deepEqual(Sound.musicStep('day', NaN, undefined), Sound.musicStep('day', 0, 0));
  assert.equal(Sound.setMood('night'), 'night'); assert.equal(Sound.setMood('없는 곡'), 'night', '모르는 곡은 그대로 둔다'); Sound.setMood('day');
  assert.equal(Sound.setMusicVolume(250), 100); assert.equal(Sound.setMusicVolume(-5), 0); assert.equal(Sound.setMusicVolume('abc'), Sound.MUSIC_VOLUME_DEFAULT); assert.equal(Sound.setMusicVolume(null), Sound.MUSIC_VOLUME_DEFAULT);
  assert.equal(Sound.setMusicEnabled('yes'), false); assert.equal(Sound.setMusicEnabled(true), true);
  assert.equal(Sound.pump(), 0, '깨우기 전에는 아무것도 예약하지 않는다');
});

test('배경 음악: 효과음보다 낮게 거르고, 음의 머리를 천천히 올린다', () => {
  assert.ok(Sound.MUSIC_CUT < Sound.SOFT_CUT); assert.ok(Sound.MUSIC_ATTACK >= 0.05);
});

test('음원 파일: 등록은 아는 곡 이름의 글만 받고, 없는 곡은 낮의 곡이나 있는 곡으로 대신한다', () => {
  const url = 'data:audio/ogg;base64,' + 'A'.repeat(40);
  assert.equal(Sound.setTracks({ day: url, night: url, boss: url, dread: 123 }), 2);
  assert.equal(Sound.hasTracks(), true);
  assert.equal(Sound.setTracks(null), 0); assert.equal(Sound.hasTracks(), false);
  assert.equal(Sound.setTracks({ day: 'x' }), 0, '너무 짧은 값은 음원이 아니다');
  assert.equal(Sound.pickTrack('night', { day: true, night: true }), 'night');
  assert.equal(Sound.pickTrack('dread', { day: true, night: true }), 'day');
  assert.equal(Sound.pickTrack('day', { night: true }), 'night');
  assert.equal(Sound.pickTrack('day', {}), ''); assert.equal(Sound.pickTrack('day', null), '');
  assert.equal(Sound.pump(), 0, '깨우기 전에는 음원도 틀지 않는다');
});
