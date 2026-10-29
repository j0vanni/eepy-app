'use strict';
/**
 * Pure DSP for eepy's generated sleep sounds (white / pink / brown noise, rain, wake chime).
 *
 * Plain CommonJS + JSDoc so `scripts/generate-sounds.js` can run it with bare Node (no build step,
 * no dependencies) and Jest can test it. Nothing here touches the file system or React Native.
 * Everything is seeded, so regenerating produces byte-identical WAVs.
 */

const SAMPLE_RATE = 22050;
const TWO_PI = 2 * Math.PI;

/**
 * Small, fast seeded PRNG (mulberry32). Returns uniform numbers in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal deviates (Box–Muller).
 * @param {() => number} rand
 * @returns {() => number}
 */
function createGaussian(rand) {
  let spare = NaN;
  return () => {
    if (!Number.isNaN(spare)) {
      const s = spare;
      spare = NaN;
      return s;
    }
    const u = 1 - rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(TWO_PI * v);
    return r * Math.cos(TWO_PI * v);
  };
}

/**
 * @param {number} n
 * @param {() => number} gauss
 * @returns {Float64Array}
 */
function whiteNoise(n, gauss) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = gauss();
  return out;
}

/**
 * Pink (1/f) noise with Paul Kellet's refined filter: six one-pole sections summed, ±0.05 dB of a
 * true -3 dB/octave slope over the audible band.
 * @param {number} n
 * @param {() => number} gauss
 * @returns {Float64Array}
 */
function pinkNoise(n, gauss) {
  const out = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = gauss();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/**
 * Brown (red, 1/f²) noise: white noise through a leaky integrator, -6 dB/octave above `cornerHz`.
 * A gentle high-pass removes the inaudible sub-bass that would only eat headroom.
 * @param {number} n
 * @param {() => number} gauss
 * @param {number} [sampleRate]
 * @param {number} [cornerHz]
 * @returns {Float64Array}
 */
function brownNoise(n, gauss, sampleRate = SAMPLE_RATE, cornerHz = 40) {
  const leak = Math.exp((-TWO_PI * cornerHz) / sampleRate);
  const hp = biquad(highPassCoeffs(20, 0.707, sampleRate));
  const out = new Float64Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = leak * y + (1 - leak) * gauss();
    out[i] = hp(y);
  }
  return out;
}

/**
 * @typedef {{ b0: number, b1: number, b2: number, a1: number, a2: number }} BiquadCoeffs
 */

/**
 * RBJ cookbook low-pass.
 * @param {number} f0 @param {number} q @param {number} [sampleRate]
 * @returns {BiquadCoeffs}
 */
function lowPassCoeffs(f0, q, sampleRate = SAMPLE_RATE) {
  const w0 = (TWO_PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/**
 * RBJ cookbook high-pass.
 * @param {number} f0 @param {number} q @param {number} [sampleRate]
 * @returns {BiquadCoeffs}
 */
function highPassCoeffs(f0, q, sampleRate = SAMPLE_RATE) {
  const w0 = (TWO_PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/**
 * RBJ cookbook high shelf (used for the K-weighting pre-filter).
 * @param {number} f0 @param {number} q @param {number} gainDb @param {number} [sampleRate]
 * @returns {BiquadCoeffs}
 */
function highShelfCoeffs(f0, q, gainDb, sampleRate = SAMPLE_RATE) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const sq = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 - (A - 1) * cos + sq;
  return {
    b0: (A * (A + 1 + (A - 1) * cos + sq)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
    b2: (A * (A + 1 + (A - 1) * cos - sq)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
    a2: (A + 1 - (A - 1) * cos - sq) / a0,
  };
}

/**
 * A stateful biquad (direct form I) as a per-sample function.
 * @param {BiquadCoeffs} c
 * @returns {(x: number) => number}
 */
function biquad(c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/**
 * Runs a signal through a chain of biquads.
 * @param {Float64Array} x @param {BiquadCoeffs[]} chain
 * @returns {Float64Array}
 */
function filter(x, chain) {
  const stages = chain.map(biquad);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let v = x[i];
    for (const s of stages) v = s(v);
    out[i] = v;
  }
  return out;
}

/** @param {ArrayLike<number>} x */
function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** @param {ArrayLike<number>} x */
function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/**
 * Scales a copy of `x` so its RMS is `target`.
 * @param {Float64Array} x @param {number} [target]
 */
function toRms(x, target = 1) {
  const g = target / (rms(x) || 1);
  return x.map((v) => v * g);
}

/**
 * Loudness in LUFS (ITU-R BS.1770 K-weighting, ungated — fine for steady noise). Matching this
 * instead of plain RMS keeps hissy white noise from sounding far louder than brown noise.
 * @param {Float64Array} x @param {number} [sampleRate]
 * @returns {number}
 */
function loudnessLufs(x, sampleRate = SAMPLE_RATE) {
  const k = filter(x, [
    highShelfCoeffs(1681.974450955533, 0.7071752369554196, 3.999843853973347, sampleRate),
    highPassCoeffs(38.13547087602444, 0.5003270373238773, sampleRate),
  ]);
  let s = 0;
  for (let i = 0; i < k.length; i++) s += k[i] * k[i];
  return -0.691 + 10 * Math.log10(s / k.length || 1e-20);
}

/**
 * Gain that brings `x` to `targetLufs`.
 * @param {Float64Array} x @param {number} targetLufs @param {number} [sampleRate]
 */
function loudnessGain(x, targetLufs, sampleRate = SAMPLE_RATE) {
  return Math.pow(10, (targetLufs - loudnessLufs(x, sampleRate)) / 20);
}

/**
 * Soft knee limiter: transparent below `threshold`, smoothly saturating to ±1 above it.
 * @param {Float64Array} x @param {number} [threshold]
 */
function softLimit(x, threshold = 0.8) {
  const room = 1 - threshold;
  return x.map((v) => {
    const a = Math.abs(v);
    if (a <= threshold) return v;
    return Math.sign(v) * (threshold + room * Math.tanh((a - threshold) / room));
  });
}

/**
 * Makes a seamless loop of `length` samples from a longer render (`x.length >= length + fade`).
 * The first `fade` samples are an equal-power crossfade between the start and the audio that
 * naturally followed the loop's end, so sample `length - 1` flows straight into sample 0 with no
 * click and no dip in level (the two noise segments are uncorrelated, so sin/cos keeps power flat).
 * @param {Float64Array} x @param {number} length @param {number} fade
 * @returns {Float64Array}
 */
function makeSeamlessLoop(x, length, fade) {
  if (x.length < length + fade) throw new Error(`need ${length + fade} samples to loop, got ${x.length}`);
  const out = x.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const p = (i + 0.5) / fade;
    const fadeIn = Math.sin((p * Math.PI) / 2);
    const fadeOut = Math.cos((p * Math.PI) / 2);
    out[i] = x[i] * fadeIn + x[length + i] * fadeOut;
  }
  return out;
}

/**
 * Adds a decaying sinusoid "grain" (a droplet) into `out`, optionally gliding in pitch.
 * @param {Float64Array} out @param {number} start sample index @param {number} freq Hz
 * @param {number} decayS e-folding time @param {number} amp @param {number} glide fractional pitch rise over the grain
 * @param {number} sampleRate
 */
function addDroplet(out, start, freq, decayS, amp, glide, sampleRate) {
  const len = Math.min(out.length - start, Math.ceil(decayS * 6 * sampleRate));
  const attack = Math.max(2, Math.round(0.0006 * sampleRate));
  let phase = 0;
  for (let j = 0; j < len; j++) {
    const t = j / sampleRate;
    const f = freq * (1 + glide * Math.min(1, t / (decayS * 3)));
    phase += (TWO_PI * f) / sampleRate;
    const env = Math.exp(-t / decayS) * Math.min(1, j / attack);
    out[start + j] += amp * env * Math.sin(phase);
  }
}

/**
 * Rain: a band-limited pink "shhh", a soft low body, a dense crackle of tiny drops and a few
 * larger plinks, all swelling with slow gusts. The gust LFOs complete whole cycles over
 * `loopLength`, so the loop crossfade lines up.
 * @param {number} n samples to render (loop length + crossfade)
 * @param {number} loopLength
 * @param {() => number} rand
 * @param {() => number} gauss
 * @param {number} [sampleRate]
 * @returns {Float64Array}
 */
function rain(n, loopLength, rand, gauss, sampleRate = SAMPLE_RATE) {
  const gust = (/** @type {number} */ i) => {
    const t = (i % loopLength) / loopLength;
    return 1 + 0.16 * Math.sin(TWO_PI * 2 * t) + 0.08 * Math.sin(TWO_PI * 5 * t + 1.3);
  };

  const bed = toRms(filter(pinkNoise(n, gauss), [highPassCoeffs(450, 0.6, sampleRate), lowPassCoeffs(5200, 0.6, sampleRate)]));
  const body = toRms(filter(brownNoise(n, gauss, sampleRate, 60), [lowPassCoeffs(320, 0.7, sampleRate)]));

  // Dense crackle: Poisson-timed tiny drops with heavy-tailed loudness (most faint, a few crisp).
  const crackle = new Float64Array(n);
  const crackleRate = 220; // drops per second
  for (let i = 0; i < n; ) {
    i += Math.max(1, Math.round((-Math.log(1 - rand()) / (crackleRate * gust(i))) * sampleRate));
    if (i >= n) break;
    const freq = 1800 * Math.pow(4.5, rand()); // 1.8–8 kHz, log-uniform
    const amp = Math.pow(rand(), 3);
    addDroplet(crackle, i, freq, 0.0008 + rand() * 0.002, amp, 0, sampleRate);
  }

  // A few larger drops: a short upward "plink" (bubble resonance rises as it closes).
  const plinks = new Float64Array(n);
  const plinkRate = 2.2;
  for (let i = 0; i < n; ) {
    i += Math.max(1, Math.round((-Math.log(1 - rand()) / plinkRate) * sampleRate));
    if (i >= n) break;
    const freq = 1100 * Math.pow(2.4, rand()); // 1.1–2.6 kHz
    addDroplet(plinks, i, freq, 0.006 + rand() * 0.008, 0.4 + 0.6 * rand(), 0.25 + rand() * 0.35, sampleRate);
  }

  const crackleN = toRms(crackle);
  const plinksN = toRms(plinks);
  const out = new Float64Array(n);
  const dB = (/** @type {number} */ d) => Math.pow(10, d / 20);
  for (let i = 0; i < n; i++) {
    const g = gust(i);
    out[i] = g * bed[i] + dB(-9) * body[i] + g * dB(-5) * crackleN[i] + dB(-17) * plinksN[i];
  }
  return out;
}

/**
 * Gentle wake chime: a soft bell arpeggio that rises in pitch and loudness, then rings out.
 * @param {number} [sampleRate]
 * @returns {Float64Array}
 */
function wakeChime(sampleRate = SAMPLE_RATE) {
  // Rounds of a G–C–E–G motif climbing an octave overall, each round louder (-18 → -2 dB).
  const motif = [392.0, 523.25, 659.25, 783.99];
  const rounds = [
    { shift: 1, gainDb: -18 },
    { shift: 1.3348, gainDb: -10 }, // up a fourth
    { shift: 2, gainDb: -3 }, // up an octave
  ];
  const step = 0.42; // seconds between notes
  const tail = 2.4;
  const notes = [];
  let t = 0.05;
  for (const r of rounds) {
    for (const f of motif) {
      notes.push({ t, f: f * r.shift, amp: Math.pow(10, r.gainDb / 20) });
      t += step;
    }
  }
  const n = Math.ceil((t + tail) * sampleRate);
  const out = new Float64Array(n);
  // Soft bell: fundamental plus a quiet octave and a faint inharmonic partial; highs decay faster.
  const partials = [
    { ratio: 1, amp: 1, decay: 1.4 },
    { ratio: 2, amp: 0.28, decay: 0.7 },
    { ratio: 2.76, amp: 0.1, decay: 0.45 },
    { ratio: 4.07, amp: 0.04, decay: 0.25 },
  ];
  for (const note of notes) {
    const start = Math.round(note.t * sampleRate);
    const len = Math.min(n - start, Math.round(4 * sampleRate));
    for (const p of partials) {
      const f = note.f * p.ratio;
      if (f >= sampleRate / 2.2) continue;
      for (let j = 0; j < len; j++) {
        const tt = j / sampleRate;
        const env = Math.exp(-tt / p.decay) * Math.min(1, tt / 0.006);
        out[start + j] += note.amp * p.amp * env * Math.sin((TWO_PI * f * j) / sampleRate);
      }
    }
  }
  // Fade the last 0.3 s so the file ends in silence.
  const fadeLen = Math.round(0.3 * sampleRate);
  for (let i = 0; i < fadeLen; i++) out[n - 1 - i] *= i / fadeLen;
  const g = Math.pow(10, -1 / 20) / (peak(out) || 1);
  return out.map((v) => v * g);
}

/**
 * Encodes mono samples in [-1, 1] as a 16-bit PCM WAV file (with TPDF dither).
 * @param {ArrayLike<number>} samples @param {number} [sampleRate] @param {number} [seed]
 * @returns {Uint8Array}
 */
function encodeWav16(samples, sampleRate = SAMPLE_RATE, seed = 1) {
  const rand = createRandom(seed);
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const text = (/** @type {number} */ offset, /** @type {string} */ s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const dither = (rand() - rand()) / 32768;
    const v = Math.max(-1, Math.min(1, samples[i] + dither));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return new Uint8Array(buf);
}

/**
 * Decodes the 16-bit mono WAVs written by `encodeWav16` (used by tests and the generator's report).
 * @param {Uint8Array} bytes
 * @returns {{ sampleRate: number, samples: Float64Array }}
 */
function decodeWav16(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  const dataBytes = view.getUint32(40, true);
  const samples = new Float64Array(dataBytes / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32767;
  return { sampleRate, samples };
}

/** @typedef {'white' | 'pink' | 'brown' | 'rain'} NoiseKind */

/**
 * Renders one seamless, loudness-normalised loop.
 * @param {NoiseKind} kind
 * @param {{ seconds?: number, fadeSeconds?: number, sampleRate?: number, seed?: number, targetLufs?: number }} [opts]
 * @returns {Float64Array}
 */
function renderLoop(kind, opts = {}) {
  const sampleRate = opts.sampleRate ?? SAMPLE_RATE;
  const length = Math.round((opts.seconds ?? 20) * sampleRate);
  const fade = Math.round((opts.fadeSeconds ?? 2) * sampleRate);
  const n = length + fade;
  const rand = createRandom(opts.seed ?? 7);
  const gauss = createGaussian(rand);
  let raw;
  if (kind === 'white') {
    // A touch of top-end softening: true white at 22 kHz is piercing on phone speakers.
    raw = filter(whiteNoise(n, gauss), [lowPassCoeffs(9000, 0.6, sampleRate)]);
  } else if (kind === 'pink') raw = pinkNoise(n, gauss);
  else if (kind === 'brown') raw = brownNoise(n, gauss, sampleRate);
  else raw = rain(n, length, rand, gauss, sampleRate);
  const loop = makeSeamlessLoop(raw, length, fade);
  const g = loudnessGain(loop, opts.targetLufs ?? -20, sampleRate);
  return softLimit(loop.map((v) => v * g), 0.85);
}

module.exports = {
  SAMPLE_RATE,
  createRandom,
  createGaussian,
  whiteNoise,
  pinkNoise,
  brownNoise,
  rain,
  wakeChime,
  lowPassCoeffs,
  highPassCoeffs,
  highShelfCoeffs,
  biquad,
  filter,
  rms,
  peak,
  toRms,
  loudnessLufs,
  loudnessGain,
  softLimit,
  makeSeamlessLoop,
  encodeWav16,
  decodeWav16,
  renderLoop,
};
