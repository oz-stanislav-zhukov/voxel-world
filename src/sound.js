// Procedural game sounds via WebAudio (no audio files).
let ctx = null;
let master = null;
let enabled = true;
let volume = 0.5;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Must be called from a user gesture (browser autoplay policy).
export function unlock() { ensure(); }
export function setEnabled(on) { enabled = !!on; }
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

function noiseBurst({ dur = 0.1, freq = 800, q = 1, gain = 0.3, type = 'lowpass', when = 0 }) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + when;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

function tone({ freq = 200, end = freq, dur = 0.15, gain = 0.2, type = 'sine', when = 0 }) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, end), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// Per-block scrape frequency (softer for soft blocks, brighter for ores)
const MINE_FREQ = { 3: 500, 13: 620, 14: 620, 15: 660, 16: 720, 5: 300, 10: 350, 12: 350, 1: 420, 2: 420, 4: 300, 6: 520, 7: 520, 11: 900, 17: 350 };

export function mine(blockId) {
  noiseBurst({ dur: 0.07, freq: MINE_FREQ[blockId] ?? 500, gain: 0.16 });
}
export function breakBlock(blockId) {
  noiseBurst({ dur: 0.25, freq: (MINE_FREQ[blockId] ?? 500) * 0.8, gain: 0.4 });
  noiseBurst({ dur: 0.15, freq: 2200, gain: 0.1, type: 'highpass', when: 0.02 });
}
export function place() { noiseBurst({ dur: 0.06, freq: 900, gain: 0.25 }); }
export function hitMob() {
  tone({ freq: 220, end: 90, dur: 0.12, gain: 0.3, type: 'triangle' });
  noiseBurst({ dur: 0.08, freq: 600, gain: 0.2 });
}
export function hurt() {
  tone({ freq: 160, end: 60, dur: 0.25, gain: 0.35, type: 'sawtooth' });
}
export function mobDeath() {
  tone({ freq: 300, end: 50, dur: 0.5, gain: 0.25, type: 'triangle' });
  noiseBurst({ dur: 0.3, freq: 400, gain: 0.15, when: 0.05 });
}
export function dropItem() { tone({ freq: 500, end: 900, dur: 0.08, gain: 0.12 }); }
export function pickup() {
  tone({ freq: 600, end: 1200, dur: 0.07, gain: 0.14 });
  tone({ freq: 900, end: 1600, dur: 0.06, gain: 0.1, when: 0.05 });
}
export function uiClick() { tone({ freq: 700, end: 500, dur: 0.05, gain: 0.08, type: 'square' }); }
