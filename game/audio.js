// audio.js — semua bunyi disintesis WebAudio, tanpa file suara.
// Dipanggil hanya setelah interaksi pertama (autoplay policy).

let ctx = null;
let muted = false;
let ambienceNodes = null;

export function initAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch (_e) {
    return null;
  }
}

// Satu nada oscillator sederhana dengan envelope.
function tone(freq, dur, type, vol, slideTo) {
  if (!ctx || muted) return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (_e) { /* audio opsional */ }
}

// Desis noise pendek (untuk splash / hujan / pintu).
function noiseBurst(dur, vol, filterFreq) {
  if (!ctx || muted) return;
  try {
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq || 1200;
    const gain = ctx.createGain();
    gain.gain.value = vol || 0.1;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  } catch (_e) { /* audio opsional */ }
}

export function sfx(name) {
  try {
    initAudio();
    if (!ctx || muted) return;
    switch (name) {
      case 'place':   tone(520, 0.09, 'triangle', 0.12, 760); break;
      case 'gate':    tone(180, 0.14, 'square', 0.08, 90); noiseBurst(0.08, 0.05, 700); break;
      case 'mill':    tone(220, 0.25, 'sine', 0.06, 330); break;
      case 'alarm':   tone(440, 0.22, 'sawtooth', 0.1, 440); setTimeout(() => tone(440, 0.22, 'sawtooth', 0.1), 260); break;
      case 'bell':    tone(880, 0.5, 'sine', 0.12); tone(1320, 0.4, 'sine', 0.05); break;
      case 'splash':  noiseBurst(0.25, 0.12, 900); break;
      case 'break':   noiseBurst(0.3, 0.16, 400); tone(120, 0.3, 'square', 0.1, 60); break;
      case 'click':   tone(700, 0.05, 'triangle', 0.08); break;
      case 'win':     [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.12), i * 130)); break;
      case 'lose':    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sine', 0.1), i * 160)); break;
      default:        tone(440, 0.08, 'sine', 0.08); break;
    }
  } catch (_e) { /* audio opsional */ }
}

// Loop ambience air: noise putih lewat lowpass, pelan, berulang.
export function startAmbience() {
  try {
    initAudio();
    if (!ctx || ambienceNodes || muted) return;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    ambienceNodes = { src, gain };
  } catch (_e) { /* audio opsional */ }
}

export function setMuted(m) {
  muted = !!m;
  try {
    if (ambienceNodes) ambienceNodes.gain.gain.value = muted ? 0 : 0.035;
    if (ctx) void ctx.resume();
  } catch (_e) { /* abaikan */ }
}
