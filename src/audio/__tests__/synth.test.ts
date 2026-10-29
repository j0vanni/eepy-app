import * as synth from '../synth';

// Node built-ins, typed locally: the app's tsconfig deliberately has no Node globals.
declare const __dirname: string;
const fs: { readFileSync(p: string): Uint8Array } = require('fs');
const path: { join(...parts: string[]): string } = require('path');

const SR = synth.SAMPLE_RATE;

function lag1(x: Float64Array): number {
  let num = 0;
  let den = 0;
  for (let i = 1; i < x.length; i++) {
    num += x[i] * x[i - 1];
    den += x[i] * x[i];
  }
  return num / den;
}

function meanStep(x: Float64Array): number {
  let d = 0;
  for (let i = 1; i < x.length; i++) d += Math.abs(x[i] - x[i - 1]);
  return d / (x.length - 1);
}

describe('noise colours', () => {
  const n = 3 * SR;
  const make = (seed: number) => synth.createGaussian(synth.createRandom(seed));

  it('is deterministic for a seed', () => {
    expect(Array.from(synth.pinkNoise(64, make(5)))).toEqual(Array.from(synth.pinkNoise(64, make(5))));
    expect(Array.from(synth.pinkNoise(64, make(5)))).not.toEqual(Array.from(synth.pinkNoise(64, make(6))));
  });

  it('gets smoother from white to pink to brown', () => {
    const white = lag1(synth.whiteNoise(n, make(1)));
    const pink = lag1(synth.pinkNoise(n, make(1)));
    const brown = lag1(synth.brownNoise(n, make(1)));
    expect(Math.abs(white)).toBeLessThan(0.02);
    expect(pink).toBeGreaterThan(0.5);
    expect(pink).toBeLessThan(0.95);
    expect(brown).toBeGreaterThan(0.97);
  });

  it('keeps brown noise free of DC drift', () => {
    const b = synth.brownNoise(n, make(2));
    const mean = b.reduce((s, v) => s + v, 0) / b.length;
    expect(Math.abs(mean)).toBeLessThan(0.1 * synth.rms(b));
  });
});

describe('seamless loops', () => {
  it('joins the end back onto the start without a jump (brown noise, where a hard cut clicks)', () => {
    const len = 2 * SR;
    const fade = SR / 2;
    const raw = synth.brownNoise(len + fade, synth.createGaussian(synth.createRandom(9)));
    const loop = synth.makeSeamlessLoop(raw, len, fade);
    const step = meanStep(loop);
    // Played as a loop, the last sample flows into the first like any other neighbouring pair…
    expect(Math.abs(loop[0] - loop[len - 1])).toBeLessThan(5 * step);
    // …whereas simply cutting the render at `len` would wrap from raw[len - 1] to raw[0].
    expect(Math.abs(raw[0] - raw[len - 1])).toBeGreaterThan(5 * step);
  });

  it('keeps the level steady through the crossfade', () => {
    const len = 4 * SR;
    const fade = SR;
    const raw = synth.pinkNoise(len + fade, synth.createGaussian(synth.createRandom(3)));
    const loop = synth.makeSeamlessLoop(raw, len, fade);
    const ratio = synth.rms(loop.subarray(0, fade)) / synth.rms(loop.subarray(fade));
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it('needs enough samples', () => {
    expect(() => synth.makeSeamlessLoop(new Float64Array(10), 8, 4)).toThrow();
  });
});

describe('loudness', () => {
  it('normalises every sound to the same K-weighted loudness with headroom', () => {
    for (const kind of ['white', 'pink', 'brown', 'rain'] as const) {
      const loop = synth.renderLoop(kind, { seconds: 3, fadeSeconds: 0.5, seed: 4, targetLufs: -20 });
      expect(loop.length).toBe(3 * SR);
      expect(synth.loudnessLufs(loop)).toBeCloseTo(-20, 0);
      expect(synth.peak(loop)).toBeLessThan(0.95);
    }
  });

  it('weights hiss above rumble, so equal loudness means less RMS for white than brown', () => {
    const white = synth.renderLoop('white', { seconds: 2, fadeSeconds: 0.5, targetLufs: -20 });
    const brown = synth.renderLoop('brown', { seconds: 2, fadeSeconds: 0.5, targetLufs: -20 });
    expect(synth.rms(white)).toBeLessThan(synth.rms(brown));
  });

  it('soft-limits only above the threshold', () => {
    const out = synth.softLimit(Float64Array.from([0.5, -0.7, 0.9, 3, -3]), 0.8);
    expect(out[0]).toBe(0.5);
    expect(out[1]).toBe(-0.7);
    expect(out[2]).toBeGreaterThan(0.8);
    expect(out[2]).toBeLessThan(0.9);
    expect(out[3]).toBeLessThanOrEqual(1);
    expect(out[4]).toBeGreaterThanOrEqual(-1);
  });
});

describe('wake chime', () => {
  it('rises in loudness and ends in silence', () => {
    const c = synth.wakeChime();
    const third = Math.floor(c.length / 3);
    expect(synth.rms(c.subarray(third, 2 * third))).toBeGreaterThan(synth.rms(c.subarray(0, third)));
    expect(synth.peak(c)).toBeLessThanOrEqual(1);
    expect(Math.abs(c[c.length - 1])).toBeLessThan(1e-3);
  });
});

describe('WAV encoding', () => {
  it('writes a valid 16-bit mono PCM file that round-trips', () => {
    const samples = Float64Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.5);
    const bytes = synth.encodeWav16(samples, SR);
    const text = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    expect(bytes.length).toBe(44 + 2000);
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(36, 4)).toBe('data');
    const { sampleRate, samples: back } = synth.decodeWav16(bytes);
    expect(sampleRate).toBe(SR);
    expect(back.length).toBe(1000);
    for (let i = 0; i < 1000; i += 97) expect(back[i]).toBeCloseTo(samples[i], 3);
  });

  it('ships committed assets that match the generator (20 s loops, under 4 MB in total)', () => {
    const dir = path.join(__dirname, '..', '..', '..', 'assets', 'audio');
    let total = 0;
    for (const name of ['white', 'pink', 'brown', 'rain', 'wake']) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(dir, `${name}.wav`)));
      total += bytes.length;
      const { sampleRate, samples } = synth.decodeWav16(bytes);
      expect(sampleRate).toBe(SR);
      if (name !== 'wake') {
        expect(samples.length).toBe(20 * SR);
        expect(synth.loudnessLufs(samples)).toBeCloseTo(-20, 0);
      }
    }
    expect(total).toBeLessThan(4 * 1024 * 1024);
  });
});
