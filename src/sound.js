/*
 * Sound — 효과음
 * ------------------------------------------------------------
 * 음원 파일 없이 Web Audio 로 짧은 소리를 합성한다(파일 하나짜리 게임을 유지하기 위함).
 * 소리 하나는 음표 목록이다. { f: 주파수(Hz), to: 끝 주파수(있으면 그쪽으로 미끄러진다), d: 길이(초), at: 시작 시점(초), type: 파형, g: 음량 }
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

  var MAX_GAIN = 0.95;  // 어떤 소리도 이보다 크게 내지 않는다(음량 100 에서도)
  var VOLUME = 5.2;    /* 0.9.23: 음량 100 에서도 작다는 의견에 따라 두 배로 키웠다. 겹쳐서 터지지 않게 끝에 누름막(compressor)을 둔다 */ var VOLUME_OLD = 2.6;    // 전체 음량 배수(0.8.6: 소리가 작다는 의견에 따라 전체를 키웠다). 소리마다의 g 에 곱한다

  /*
   * 0.8.5: 소리를 부드럽게 다듬었다. 날카롭게 들리던 네모파·톱니파를 빼고 사인파·세모파만 쓴다.
   *   높은 음(1200Hz 이상)은 한 옥타브쯤 내렸고, 모든 소리는 SOFT_CUT 아래만 남기는 거름막을 거친다.
   */
  var SOFT_CUT = 2400;   // 이 주파수(Hz) 위의 소리는 걸러 낸다(쇳소리 제거)
  var ATTACK = 0.02;     // 소리가 올라오는 시간(초). 짧을수록 딱딱하게 들린다
  var SOUNDS = {
    // 누르는 소리: 음이 위로 미끄러져 올라가는 '뽁' 소리(to 는 끝날 때의 주파수)
    click:      [{ f: 520, to: 840, d: 0.09, type: 'sine', g: 0.05 }],
    buy:        [{ f: 523, d: 0.07, type: 'sine', g: 0.045 }, { f: 659, d: 0.1, at: 0.06, type: 'sine', g: 0.045 }],
    // 0.8.10: 하는 일마다 소리가 다르다
    sell:       [{ f: 784, d: 0.05, type: 'sine', g: 0.045 }, { f: 988, d: 0.13, at: 0.05, type: 'sine', g: 0.045 }],                                   // 동전 소리
    peak:       [{ f: 784, d: 0.05, type: 'sine', g: 0.045 }, { f: 988, d: 0.08, at: 0.05, type: 'sine', g: 0.045 }, { f: 880, to: 1175, d: 0.2, at: 0.13, type: 'sine', g: 0.045 }],
    surge:      [{ f: 196, to: 392, d: 0.18, type: 'triangle', g: 0.05 }, { f: 392, to: 784, d: 0.22, at: 0.14, type: 'sine', g: 0.04 }],                // 전력이 차오르는 소리
    green:      [{ f: 880, d: 0.28, type: 'sine', g: 0.045 }, { f: 660, d: 0.34, at: 0.14, type: 'sine', g: 0.035 }],                                    // 역의 종소리
    answer:     [{ f: 659, d: 0.08, type: 'sine', g: 0.045 }, { f: 784, d: 0.16, at: 0.08, type: 'sine', g: 0.045 }],                                    // 무전 응답
    fortify:    [{ noise: true, cut: 300, d: 0.12, g: 0.07 }, { f: 147, d: 0.16, type: 'triangle', g: 0.06 }],                                           // 망치질
    goal:       [{ f: 523, d: 0.09, type: 'sine', g: 0.05 }, { f: 659, d: 0.09, at: 0.09, type: 'sine', g: 0.05 }, { f: 784, d: 0.09, at: 0.18, type: 'sine', g: 0.05 }, { f: 988, d: 0.3, at: 0.27, type: 'sine', g: 0.05 }],
    feed:       [{ f: 440, to: 660, d: 0.08, type: 'sine', g: 0.045 }, { f: 520, to: 780, d: 0.08, at: 0.09, type: 'sine', g: 0.045 }, { f: 660, to: 990, d: 0.13, at: 0.18, type: 'sine', g: 0.045 }],  // 냠냠
    tab:        [{ f: 330, to: 440, d: 0.05, type: 'sine', g: 0.025 }],
    dusk:       [{ f: 294, d: 0.35, type: 'triangle', g: 0.03 }, { f: 233, d: 0.5, at: 0.3, type: 'triangle', g: 0.03 }],
    defended:   [{ f: 392, d: 0.1, type: 'sine', g: 0.05 }, { f: 494, d: 0.1, at: 0.1, type: 'sine', g: 0.05 }, { f: 587, d: 0.24, at: 0.2, type: 'sine', g: 0.05 }],
    breached:   [{ noise: true, cut: 260, d: 0.55, g: 0.12 }, { f: 82, d: 0.55, type: 'triangle', g: 0.07 }],
    signal:     [{ f: 784, d: 0.07, type: 'sine', g: 0.035 }, { f: 988, d: 0.07, at: 0.1, type: 'sine', g: 0.035 }, { f: 784, d: 0.09, at: 0.2, type: 'sine', g: 0.035 }],
    expedition: [{ f: 349, d: 0.1, type: 'sine', g: 0.045 }, { f: 466, d: 0.16, at: 0.1, type: 'sine', g: 0.045 }],
    story:      [{ f: 294, d: 0.55, type: 'sine', g: 0.05 }, { f: 220, d: 0.85, at: 0.3, type: 'sine', g: 0.045 }],
    type:       [{ f: 620, d: 0.025, type: 'sine', g: 0.009 }],
    relocate:   [{ f: 262, d: 0.14, type: 'sine', g: 0.045 }, { f: 330, d: 0.14, at: 0.13, type: 'sine', g: 0.045 }, { f: 392, d: 0.14, at: 0.26, type: 'sine', g: 0.045 }, { f: 523, d: 0.32, at: 0.39, type: 'sine', g: 0.045 }]
  };

  var enabled = true, ctx = null, unlocked = false;
  /*
   * 음량: 0 ~ 100, 기본 50. 50 이 기준 크기이고 100 이면 두 배, 0 이면 소리가 나지 않는다. 잘못된 값은 기본으로 본다.
   */
  var VOLUME_DEFAULT = 50, volume = VOLUME_DEFAULT;
  function setVolume(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    volume = typeof n === 'number' && isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : VOLUME_DEFAULT;
    return volume;
  }
  function getVolume() { return volume; }

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
    var start = t0 + (n.at || 0), gain = ctx.createGain(), peak = Math.max(0.0002, Math.min(MAX_GAIN, (n.g || 0.05) * VOLUME * volume / VOLUME_DEFAULT)), src;
    // 딸깍거리는 잡음을 막으려고 음량을 짧게 올렸다가 서서히 내린다
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(ATTACK, n.d / 2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    if (n.noise) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * n.d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource(); src.buffer = buf;
      var filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = n.cut || 400;
      src.connect(filter); filter.connect(gain);
    } else {
      src = ctx.createOscillator(); src.type = n.type || 'triangle'; src.frequency.setValueAtTime(n.f, start);
      if (n.to > 0) src.frequency.exponentialRampToValueAtTime(n.to, start + n.d * 0.7);      // 음이 미끄러지는 소리
      src.connect(gain);
    }
    // 마지막에 높은 소리를 한 번 더 걸러서 부드럽게 한다
    var soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = SOFT_CUT;
    gain.connect(soft);
    // 누름막: 여러 소리가 겹쳐 커질 때만 눌러서 찢어지는 소리를 막는다. 기기가 지원하지 않으면 그냥 내보낸다
    var out = ctx.destination;
    try {
      if (!ctx.__zone7Comp && ctx.createDynamicsCompressor) {
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
        comp.connect(ctx.destination); ctx.__zone7Comp = comp;
      }
      if (ctx.__zone7Comp) out = ctx.__zone7Comp;
    } catch (e) { out = ctx.destination; }
    soft.connect(out);
    src.start(start); src.stop(start + n.d + 0.02);
  }

  /**
   * 이름으로 소리를 낸다. 실제로 냈으면 true.
   * 꺼져 있거나, 아직 깨우지 못했거나, 탭이 가려져 있거나, 모르는 이름이면 아무것도 하지 않고 false.
   */
  function play(name) {
    var notes = SOUNDS[name];
    if (!notes || !enabled || !unlocked || !ctx || volume <= 0) return false;
    if (typeof document !== 'undefined' && document.hidden) return false; // 안 보는 탭에서 혼자 울리지 않는다
    try {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var t0 = ctx.currentTime + 0.01;
      notes.forEach(function (n) { playNote(n, t0); });
      return true;
    } catch (e) { return false; }
  }

  return { SOUNDS: SOUNDS, MAX_GAIN: MAX_GAIN, VOLUME: VOLUME, VOLUME_DEFAULT: VOLUME_DEFAULT, setVolume: setVolume, getVolume: getVolume, SOFT_CUT: SOFT_CUT, unlock: unlock, setEnabled: setEnabled, isEnabled: isEnabled, duration: duration, play: play };
});
