/*
 * Sound — 효과음
 * ------------------------------------------------------------
 * 음원 파일 없이 Web Audio 로 짧은 소리를 합성한다(파일 하나짜리 게임을 유지하기 위함).
 * 소리 하나는 음표 목록이다. { f: 주파수(Hz), d: 길이(초), at: 시작 시점(초), type: 파형, g: 음량 }
 * noise: true 인 항목은 주파수 대신 백색 소음을 cut(Hz) 아래로 걸러 낸다(둔탁한 충격음용).
 *
 * 브라우저는 사용자가 한 번 누르기 전에는 소리를 내지 못하게 막는다. 그래서 첫 입력 때
 * unlock() 으로 오디오를 깨우고, 그 전의 play() 는 조용히 무시한다.
 * 오디오를 쓸 수 없는 환경(Node, 구형 브라우저)에서도 play() 는 오류 없이 false 를 돌려준다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_GAIN = 0.15; // 어떤 소리도 이보다 크게 내지 않는다(방치해 두는 게임이라 작게)

  var SOUNDS = {
    click:      [{ f: 520, d: 0.04, type: 'square', g: 0.035 }],
    buy:        [{ f: 660, d: 0.05, g: 0.05 }, { f: 880, d: 0.07, at: 0.05, g: 0.05 }],
    dusk:       [{ f: 392, d: 0.28, type: 'sawtooth', g: 0.03 }, { f: 311, d: 0.4, at: 0.3, type: 'sawtooth', g: 0.03 }],
    defended:   [{ f: 523, d: 0.08, g: 0.06 }, { f: 659, d: 0.08, at: 0.09, g: 0.06 }, { f: 784, d: 0.18, at: 0.18, g: 0.06 }],
    breached:   [{ noise: true, cut: 320, d: 0.5, g: 0.14 }, { f: 98, d: 0.5, type: 'sawtooth', g: 0.06 }],
    signal:     [{ f: 1200, d: 0.04, g: 0.04 }, { f: 1500, d: 0.04, at: 0.08, g: 0.04 }, { f: 1200, d: 0.04, at: 0.16, g: 0.04 }],
    expedition: [{ f: 440, d: 0.08, g: 0.05 }, { f: 587, d: 0.14, at: 0.1, g: 0.05 }],
    story:      [{ f: 330, d: 0.5, type: 'sine', g: 0.06 }, { f: 247, d: 0.8, at: 0.3, type: 'sine', g: 0.05 }],
    type:       [{ f: 1700, d: 0.012, type: 'square', g: 0.012 }],
    relocate:   [{ f: 294, d: 0.12, g: 0.05 }, { f: 370, d: 0.12, at: 0.13, g: 0.05 }, { f: 440, d: 0.12, at: 0.26, g: 0.05 }, { f: 587, d: 0.3, at: 0.39, g: 0.05 }]
  };

  var enabled = true, ctx = null, unlocked = false;

  function hasAudio() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }
  /** 첫 사용자 입력에서 호출한다. 여러 번 불러도 한 번만 만든다. */
  function unlock() {
    if (unlocked || !hasAudio()) return unlocked;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      unlocked = true;
    } catch (e) { ctx = null; }
    return unlocked;
  }
  function setEnabled(on) { enabled = on === true; return enabled; }
  function isEnabled() { return enabled; }

  /** 소리 하나의 전체 길이(초). 정의에 없는 이름이면 0. */
  function duration(name) {
    var notes = SOUNDS[name] || [], end = 0;
    notes.forEach(function (n) { end = Math.max(end, (n.at || 0) + n.d); });
    return end;
  }

  function playNote(n, t0) {
    var start = t0 + (n.at || 0), gain = ctx.createGain(), peak = Math.min(MAX_GAIN, n.g || 0.05), src;
    // 딸깍거리는 잡음을 막으려고 음량을 짧게 올렸다가 서서히 내린다
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    if (n.noise) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * n.d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource(); src.buffer = buf;
      var filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = n.cut || 400;
      src.connect(filter); filter.connect(gain);
    } else {
      src = ctx.createOscillator(); src.type = n.type || 'triangle'; src.frequency.setValueAtTime(n.f, start);
      src.connect(gain);
    }
    gain.connect(ctx.destination);
    src.start(start); src.stop(start + n.d + 0.02);
  }

  /**
   * 이름으로 소리를 낸다. 실제로 냈으면 true.
   * 꺼져 있거나, 아직 깨우지 못했거나, 탭이 가려져 있거나, 모르는 이름이면 아무것도 하지 않고 false.
   */
  function play(name) {
    var notes = SOUNDS[name];
    if (!notes || !enabled || !unlocked || !ctx) return false;
    if (typeof document !== 'undefined' && document.hidden) return false; // 안 보는 탭에서 혼자 울리지 않는다
    try {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var t0 = ctx.currentTime + 0.01;
      notes.forEach(function (n) { playNote(n, t0); });
      return true;
    } catch (e) { return false; }
  }

  return { SOUNDS: SOUNDS, MAX_GAIN: MAX_GAIN, unlock: unlock, setEnabled: setEnabled, isEnabled: isEnabled, duration: duration, play: play };
});
