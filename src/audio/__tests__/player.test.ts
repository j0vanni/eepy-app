import type { AudioStatus } from 'expo-audio';

type Listener = (s: Partial<AudioStatus>) => void;

interface FakePlayer {
  source: unknown;
  loop: boolean;
  volume: number;
  playing: boolean;
  removed: boolean;
  lockScreen: boolean;
  listener?: Listener;
  play(): void;
  pause(): void;
  remove(): void;
  addListener(name: string, l: Listener): { remove(): void };
  setActiveForLockScreen(active: boolean): void;
  clearLockScreenControls(): void;
  updateLockScreenMetadata(): void;
  emit(s?: Partial<AudioStatus>): void;
}

const mockPlayers: FakePlayer[] = [];
const mockSetAudioMode = jest.fn(async (_mode: object) => undefined);

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (mode: object) => mockSetAudioMode(mode),
  createAudioPlayer: (source: unknown) => {
    const p: FakePlayer = {
      source,
      loop: false,
      volume: 1,
      playing: false,
      removed: false,
      lockScreen: false,
      play() {
        this.playing = true;
      },
      pause() {
        this.playing = false;
      },
      remove() {
        this.removed = true;
      },
      addListener(_name, l) {
        this.listener = l;
        return { remove: () => (this.listener = undefined) };
      },
      setActiveForLockScreen(active) {
        this.lockScreen = active;
      },
      clearLockScreenControls() {
        this.lockScreen = false;
      },
      updateLockScreenMetadata() {},
      emit(s = {}) {
        this.listener?.({ isLoaded: true, playing: this.playing, isBuffering: false, error: null, ...s });
      },
    };
    mockPlayers.push(p);
    return p;
  },
}));

// eslint-disable-next-line import/first
import { SoundController } from '../player';

const MIN = 60_000;
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('SoundController', () => {
  beforeEach(() => {
    mockPlayers.length = 0;
    mockSetAudioMode.mockClear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T22:00:00'));
  });
  afterEach(() => jest.useRealTimers());

  it('sets up background audio once, loops, and fades in to the chosen volume', async () => {
    const c = new SoundController({ lockScreen: true, configureAudioMode: true });
    await c.play({ sound: 'brown', volume: 0.6, timerMin: 0 });
    await c.play({ sound: 'brown', volume: 0.5, timerMin: 0 });
    expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
    expect(mockSetAudioMode.mock.calls[0][0]).toMatchObject({ shouldPlayInBackground: true, playsInSilentMode: true, interruptionMode: 'doNotMix' });
    expect(mockPlayers).toHaveLength(1);
    const [p] = mockPlayers;
    expect(p.loop).toBe(true);
    expect(p.playing).toBe(true);
    expect(p.lockScreen).toBe(true);
    expect(p.volume).toBe(0);
    jest.advanceTimersByTime(1200);
    expect(p.volume).toBeGreaterThan(0.2);
    expect(p.volume).toBeLessThan(0.5);
    jest.advanceTimersByTime(3000);
    expect(p.volume).toBeCloseTo(0.5, 3);
    expect(c.getState()).toMatchObject({ status: 'playing', sound: 'brown', endsAt: undefined });
  });

  it('runs the sleep timer from native status events while JS timers are paused (screen off)', async () => {
    const c = new SoundController({ lockScreen: true });
    await c.play({ sound: 'pink', volume: 0.8, timerMin: 30 });
    jest.advanceTimersByTime(5000);
    const [p] = mockPlayers;
    expect(p.volume).toBeCloseTo(0.8, 3);
    const endsAt = c.getState().endsAt!;
    expect(endsAt - Date.now()).toBe(30 * MIN - 5000);

    // Screen off: no JS interval ticks, but the native player keeps reporting status.
    jest.setSystemTime(endsAt - 1.5 * MIN);
    p.emit();
    expect(c.getState().fading).toBe(true);
    expect(p.volume).toBeCloseTo(0.8 * 0.25, 3);

    jest.setSystemTime(endsAt + 500);
    p.emit();
    expect(p.playing).toBe(false);
    expect(p.removed).toBe(true);
    expect(p.lockScreen).toBe(false);
    expect(c.getState()).toMatchObject({ status: 'idle', endsAt: undefined, fading: false });
  });

  it('crossfades when switching sounds and releases the old player', async () => {
    const c = new SoundController();
    await c.play({ sound: 'brown', volume: 1, timerMin: 0 });
    jest.advanceTimersByTime(5000);
    c.switchSound('rain');
    expect(mockPlayers).toHaveLength(2);
    const [oldP, newP] = mockPlayers;
    jest.advanceTimersByTime(750);
    expect(oldP.volume ** 2 + newP.volume ** 2).toBeCloseTo(1, 1);
    jest.advanceTimersByTime(1000);
    expect(oldP.removed).toBe(true);
    expect(newP.volume).toBeCloseTo(1, 3);
    expect(c.getState().sound).toBe('rain');
  });

  it('fades out on stop, then goes idle', async () => {
    const c = new SoundController();
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.getState().status));
    await c.play({ sound: 'white', volume: 0.5, timerMin: 15 });
    jest.advanceTimersByTime(4000);
    c.stop();
    expect(c.getState().status).toBe('stopping');
    jest.advanceTimersByTime(700);
    const [p] = mockPlayers;
    expect(p.volume).toBeGreaterThan(0);
    expect(p.volume).toBeLessThan(0.5);
    jest.advanceTimersByTime(1000);
    expect(p.removed).toBe(true);
    expect(c.getState().status).toBe('idle');
    expect(seen).toContain('stopping');
    expect(seen[seen.length - 1]).toBe('idle');
    // Nothing keeps ticking once idle.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('re-arms the timer from now and reflects system pauses', async () => {
    const c = new SoundController();
    await c.play({ sound: 'brown', volume: 0.6, timerMin: 15 });
    jest.advanceTimersByTime(10 * MIN);
    c.setTimer(45);
    expect(c.getState().endsAt! - Date.now()).toBe(45 * MIN);
    c.setTimer(0);
    expect(c.getState().endsAt).toBeUndefined();
    const [p] = mockPlayers;
    p.playing = false;
    p.emit();
    expect(c.getState().paused).toBe(true);
    p.playing = true;
    p.emit();
    expect(c.getState().paused).toBe(false);
  });

  it('honours a stop pressed while the audio session is still being set up', async () => {
    const c = new SoundController({ configureAudioMode: true });
    const pending = c.play({ sound: 'brown', volume: 0.6, timerMin: 0 });
    c.stop();
    await pending;
    await flush();
    expect(mockPlayers).toHaveLength(0);
    expect(c.getState().status).toBe('idle');
  });
});
