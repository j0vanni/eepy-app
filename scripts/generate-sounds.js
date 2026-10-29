#!/usr/bin/env node
/**
 * Writes eepy's wind-down sounds to assets/audio/ (no dependencies, deterministic output):
 *
 *   white.wav, pink.wav, brown.wav, rain.wav — 20 s seamless loops, 22 050 Hz, 16-bit mono,
 *       all matched to the same K-weighted loudness so switching sounds doesn't jump in level.
 *   wake.wav — a ~8 s rising bell chime for gentle alarms (Android notification sound).
 *
 * Usage: node scripts/generate-sounds.js
 * The DSP lives in src/audio/synth.js (tested in src/audio/__tests__/synth.test.ts).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const synth = require('../src/audio/synth.js');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'audio');
const LOOP_SECONDS = 20;
const TARGET_LUFS = -20;
const SEEDS = { white: 11, pink: 23, brown: 37, rain: 41 };

function describe(name, samples, bytes) {
  const lufs = synth.loudnessLufs(samples);
  const peakDb = 20 * Math.log10(synth.peak(samples) || 1e-9);
  const rmsDb = 20 * Math.log10(synth.rms(samples) || 1e-9);
  const seconds = samples.length / synth.SAMPLE_RATE;
  console.log(
    `${name.padEnd(10)} ${seconds.toFixed(1).padStart(5)} s  ${(bytes / 1024).toFixed(0).padStart(5)} KB  ` +
      `${lufs.toFixed(1).padStart(6)} LUFS  rms ${rmsDb.toFixed(1).padStart(6)} dBFS  peak ${peakDb.toFixed(1).padStart(5)} dBFS`,
  );
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  for (const kind of /** @type {const} */ (['white', 'pink', 'brown', 'rain'])) {
    const loop = synth.renderLoop(kind, { seconds: LOOP_SECONDS, fadeSeconds: 2, seed: SEEDS[kind], targetLufs: TARGET_LUFS });
    const wav = synth.encodeWav16(loop, synth.SAMPLE_RATE, SEEDS[kind]);
    fs.writeFileSync(path.join(OUT_DIR, `${kind}.wav`), wav);
    total += wav.length;
    describe(`${kind}.wav`, loop, wav.length);
  }
  const chime = synth.wakeChime();
  const wav = synth.encodeWav16(chime, synth.SAMPLE_RATE, 5);
  fs.writeFileSync(path.join(OUT_DIR, 'wake.wav'), wav);
  total += wav.length;
  describe('wake.wav', chime, wav.length);
  console.log(`total      ${(total / 1024 / 1024).toFixed(2)} MB → ${path.relative(process.cwd(), OUT_DIR)}`);
}

if (require.main === module) main();
