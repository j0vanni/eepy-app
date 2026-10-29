/**
 * App-wide sleep-sound player (expo-audio). One controller is shared by the wind-down screen,
 * the Today card and Settings, so a sound keeps playing while you move around the app.
 *
 * Background playback (Android):
 * - `shouldPlayInBackground` + the expo-audio config plugin's `enableBackgroundPlayback`, and
 *   `setActiveForLockScreen(true)`, which runs a media-playback foreground service (with a media
 *   notification). Without it Android stops background audio after ~3 minutes.
 * - The lock-screen service requires `interruptionMode: 'doNotMix'`: transient audio focus, so a
 *   call or another media app pauses the noise (and it resumes afterwards), and anything we paused
 *   is free to resume when the noise stops.
 * - React Native's JS timers don't fire while the activity is paused (screen off). The native
 *   player's `playbackStatusUpdate` events keep arriving, so they drive the sleep timer and its
 *   fade-out; a JS interval adds smooth ticks while the app is in the foreground (and on web).
 */
import { AudioPlayer, AudioStatus, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

import { effectiveVolume, FADE_IN_MS, isTimerFading, sleepTimerGain, SWITCH_FADE_MS, voiceFinished, VoiceEnvelope } from './envelope';
import { SoundId, soundInfo } from './sounds';

const MINUTE = 60_000;
/** Native status events (and so background timer ticks) arrive this often. */
const STATUS_INTERVAL_MS = 1000;
/** Foreground tick for smooth fades. */
const UI_TICK_MS = 100;

/* eslint-disable @typescript-eslint/no-require-imports */
const SOURCES: Record<SoundId, number> = {
  white: require('../../assets/audio/white.wav'),
  pink: require('../../assets/audio/pink.wav'),
  brown: require('../../assets/audio/brown.wav'),
  rain: require('../../assets/audio/rain.wav'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export interface PlaybackState {
  /** `stopping` while a manual stop fades out. */
  status: 'idle' | 'playing' | 'stopping';
  sound: SoundId;
  volume: number;
  /** Sleep timer length for this session (0 = until stopped). */
  timerMin: number;
  /** When the current timer was armed. */
  startedAt?: number;
  /** When playback stops (undefined = no timer). */
  endsAt?: number;
  /** The sleep timer is in its final fade. */
  fading: boolean;
  /** The system paused us (call, another app, lock-screen pause). */
  paused: boolean;
  error?: string;
}

export interface PlayOptions {
  sound: SoundId;
  volume: number;
  timerMin: number;
}

interface Voice {
  sound: SoundId;
  player: AudioPlayer;
  env: VoiceEnvelope;
  lastVolume: number;
  remove(): void;
}

export interface SoundControllerOptions {
  /** Use Android's media-session foreground service so playback survives the screen turning off. */
  lockScreen?: boolean;
  /** Configure the native audio session before the first play. */
  configureAudioMode?: boolean;
}

function lockScreenTitle(sound: SoundId): string {
  return sound === 'rain' ? 'Rain' : `${soundInfo(sound).label} noise`;
}

function formatClock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export class SoundController {
  private voices: Voice[] = [];
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | undefined;
  private audioMode: Promise<void> | undefined;
  private state: PlaybackState = { status: 'idle', sound: 'brown', volume: 0.6, timerMin: 0, fading: false, paused: false };
  private readonly lockScreen: boolean;
  private readonly configureAudioMode: boolean;
  /** Bumped on every start/stop so a play() that is still awaiting the audio mode can bail out. */
  private generation = 0;

  constructor(opts: SoundControllerOptions = {}) {
    this.lockScreen = opts.lockScreen ?? false;
    this.configureAudioMode = opts.configureAudioMode ?? false;
  }

  getState = (): PlaybackState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get isActive(): boolean {
    return this.state.status !== 'idle';
  }

  /** Starts a session, or updates the running one (switching sound with a crossfade). */
  async play(opts: PlayOptions): Promise<void> {
    if (this.state.status === 'playing') {
      this.setVolume(opts.volume);
      if (opts.sound !== this.state.sound) this.switchSound(opts.sound);
      if (opts.timerMin !== this.state.timerMin) this.setTimer(opts.timerMin);
      return;
    }
    // A play during a stop's fade-out cancels the stop.
    this.disposeAll();
    const gen = ++this.generation;
    this.setState({ status: 'playing', sound: opts.sound, volume: clampVolume(opts.volume), timerMin: opts.timerMin, error: undefined, paused: false });
    await this.ensureAudioMode();
    if (gen !== this.generation) return;
    // Sound and timer may have been changed while the audio session was being set up.
    const now = Date.now();
    this.armTimer(this.state.timerMin, now);
    try {
      this.voices.push(this.createVoice(this.state.sound, now, FADE_IN_MS));
    } catch (e) {
      this.setState({ status: 'idle', error: e instanceof Error ? e.message : String(e) });
      return;
    }
    this.startTicking();
    this.tick();
  }

  /** Fades out over a moment, then releases the players. */
  stop(): void {
    if (this.state.status !== 'playing') return;
    this.generation++;
    const now = Date.now();
    for (const v of this.voices) this.fadeOutVoice(v, now, SWITCH_FADE_MS);
    this.setState({ status: 'stopping' });
    if (this.voices.length === 0) this.finish();
    else this.tick();
  }

  /** Stops immediately. */
  stopNow(): void {
    this.generation++;
    this.finish();
  }

  toggle(opts: PlayOptions): void {
    if (this.state.status === 'playing') this.stop();
    else void this.play(opts);
  }

  setVolume(volume: number): void {
    this.setState({ volume: clampVolume(volume) });
    this.tick();
  }

  /** Re-arms the sleep timer from now (0 = no timer). */
  setTimer(timerMin: number): void {
    if (this.state.status !== 'playing' || this.voices.length === 0) {
      this.setState({ timerMin });
      return;
    }
    this.armTimer(timerMin, Date.now());
    this.updateLockScreen();
    this.tick();
  }

  /** Crossfades to another sound. */
  switchSound(sound: SoundId): void {
    if (this.state.status !== 'playing' || this.voices.length === 0 || sound === this.state.sound) {
      this.setState({ sound });
      return;
    }
    const now = Date.now();
    for (const v of this.voices) this.fadeOutVoice(v, now, SWITCH_FADE_MS);
    try {
      this.voices.push(this.createVoice(sound, now, SWITCH_FADE_MS));
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : String(e) });
    }
    this.setState({ sound });
    this.tick();
  }

  /**
   * Applies fades and the sleep timer. Called from native status events (works with the screen
   * off) and from a foreground interval. Idempotent — everything is computed from the clock.
   */
  tick = (): void => {
    if (this.state.status === 'idle') return;
    const now = Date.now();
    const { startedAt, endsAt, volume } = this.state;
    if (endsAt !== undefined && now >= endsAt) {
      this.finish();
      return;
    }
    const timer = { startedAt: startedAt ?? now, endsAt };
    for (const v of [...this.voices]) {
      if (voiceFinished(v.env, now)) {
        this.disposeVoice(v);
        continue;
      }
      const target = effectiveVolume(volume, v.env, timer, now);
      // Steady playback computes the same value every tick, so this only talks to native during fades.
      if (target !== v.lastVolume) {
        try {
          v.player.volume = target;
        } catch {
          // The player may already be released natively.
        }
        v.lastVolume = target;
      }
    }
    if (this.voices.length === 0) {
      this.finish();
      return;
    }
    const fading = this.state.status === 'playing' && isTimerFading(timer.startedAt, endsAt, now);
    if (fading !== this.state.fading) this.setState({ fading });
  };

  /** Current sleep-timer gain (for UI meters). */
  timerGain(now = Date.now()): number {
    const { startedAt, endsAt } = this.state;
    return startedAt === undefined ? 1 : sleepTimerGain(startedAt, endsAt, now);
  }

  // --- internals ---

  private setState(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private armTimer(timerMin: number, now: number) {
    const endsAt = timerMin > 0 ? now + timerMin * MINUTE : undefined;
    this.setState({ timerMin, startedAt: now, endsAt, fading: false });
  }

  private ensureAudioMode(): Promise<void> {
    if (!this.configureAudioMode) return Promise.resolve();
    this.audioMode ??= setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: this.lockScreen ? 'doNotMix' : 'mixWithOthers',
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // Retry next time; play anyway with the default session.
      this.audioMode = undefined;
    });
    return this.audioMode;
  }

  private createVoice(sound: SoundId, now: number, fadeInMs: number): Voice {
    const player = createAudioPlayer(SOURCES[sound], { updateInterval: STATUS_INTERVAL_MS });
    player.loop = true;
    player.volume = 0;
    const sub = player.addListener('playbackStatusUpdate', (s) => this.onStatus(player, s));
    const voice: Voice = {
      sound,
      player,
      env: { startedAt: now, fadeInMs, fadeOutMs: SWITCH_FADE_MS },
      lastVolume: 0,
      remove: () => sub.remove(),
    };
    player.play();
    if (this.lockScreen) {
      try {
        player.setActiveForLockScreen(true, this.lockScreenMetadata(sound), { isLiveStream: true, showSeekBackward: false, showSeekForward: false });
      } catch {
        // Lock-screen controls are best effort; playback continues in the foreground regardless.
      }
    }
    return voice;
  }

  private lockScreenMetadata(sound: SoundId) {
    const { endsAt } = this.state;
    return { title: lockScreenTitle(sound), artist: endsAt ? `eepy · fades out by ${formatClock(endsAt)}` : 'eepy · wind-down' };
  }

  private updateLockScreen() {
    if (!this.lockScreen) return;
    const current = this.voices.find((v) => v.env.stopAt === undefined);
    if (!current) return;
    try {
      current.player.updateLockScreenMetadata(this.lockScreenMetadata(current.sound));
    } catch {
      // Best effort.
    }
  }

  private onStatus(player: AudioPlayer, status: AudioStatus) {
    const current = this.voices.find((v) => v.player === player && v.env.stopAt === undefined);
    if (current && this.state.status === 'playing') {
      const paused = status.isLoaded && !status.playing && !status.isBuffering;
      if (paused !== this.state.paused) this.setState({ paused });
      if (status.error && status.error !== this.state.error) this.setState({ error: status.error });
    }
    this.tick();
  }

  private fadeOutVoice(v: Voice, now: number, fadeMs: number) {
    if (v.env.stopAt !== undefined && v.env.stopAt <= now + fadeMs) return;
    // Start the fade from wherever the fade-in got to, so a quick stop doesn't jump up first.
    v.env = { ...v.env, stopAt: now + fadeMs, fadeOutMs: fadeMs };
  }

  private disposeVoice(v: Voice) {
    this.voices = this.voices.filter((x) => x !== v);
    v.remove();
    try {
      v.player.pause();
    } catch {
      // Already gone.
    }
    try {
      v.player.remove();
    } catch {
      // Already gone.
    }
  }

  private disposeAll() {
    for (const v of [...this.voices]) {
      if (this.lockScreen) {
        try {
          v.player.clearLockScreenControls();
        } catch {
          // Best effort.
        }
      }
      this.disposeVoice(v);
    }
  }

  private finish() {
    this.disposeAll();
    this.stopTicking();
    this.setState({ status: 'idle', startedAt: undefined, endsAt: undefined, fading: false, paused: false });
  }

  private startTicking() {
    if (this.interval === undefined) this.interval = setInterval(this.tick, UI_TICK_MS);
  }

  private stopTicking() {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
  }
}

function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
}

/** The shared player. Lock-screen service and audio-session setup only exist on native. */
export const soundPlayer = new SoundController({
  lockScreen: Platform.OS === 'android',
  configureAudioMode: Platform.OS !== 'web',
});
