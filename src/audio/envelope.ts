/**
 * Pure gain envelopes for the sound player: per-voice fade-in/out (used when starting, stopping
 * and switching sounds) and the sleep timer's long, gentle fade at the end.
 * All times are epoch ms; all gains are 0–1 multipliers of the user's volume.
 */

const MINUTE = 60_000;

/** Fade a newly started sound in over this long. */
export const FADE_IN_MS = 2500;
/** Crossfade length when switching sounds, and the fade on a manual stop. */
export const SWITCH_FADE_MS = 1500;
/** Longest sleep-timer fade-out. */
export const MAX_TIMER_FADE_MS = 3 * MINUTE;

export interface VoiceEnvelope {
  startedAt: number;
  fadeInMs: number;
  /** When set, the voice fades out over `fadeOutMs` ending at `stopAt`. */
  stopAt?: number;
  fadeOutMs: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Equal-power fades: a crossfade between two uncorrelated noises keeps the level steady. */
export function voiceGain(env: VoiceEnvelope, now: number): number {
  const pIn = env.fadeInMs > 0 ? clamp01((now - env.startedAt) / env.fadeInMs) : 1;
  let g = Math.sin((pIn * Math.PI) / 2);
  if (env.stopAt !== undefined) {
    const pOut = env.fadeOutMs > 0 ? clamp01(1 - (env.stopAt - now) / env.fadeOutMs) : now >= env.stopAt ? 1 : 0;
    g *= Math.cos((pOut * Math.PI) / 2);
  }
  return clamp01(g);
}

export function voiceFinished(env: VoiceEnvelope, now: number): boolean {
  return env.stopAt !== undefined && now >= env.stopAt;
}

/** How long the sleep timer fades for: the last 3 minutes, or the last quarter of a short timer. */
export function timerFadeMs(timerMs: number): number {
  return Math.min(MAX_TIMER_FADE_MS, Math.max(0, timerMs) / 4);
}

/**
 * Sleep-timer gain at `now` for a timer that runs from `startedAt` to `endsAt`.
 * Full volume until the fade, then (1-p)² — loudness falls roughly evenly instead of
 * seeming to hold and then vanish, which is what a linear amplitude fade sounds like.
 */
export function sleepTimerGain(startedAt: number, endsAt: number | undefined, now: number): number {
  if (endsAt === undefined) return 1;
  if (now >= endsAt) return 0;
  const fade = timerFadeMs(endsAt - startedAt);
  const remaining = endsAt - now;
  if (fade <= 0 || remaining >= fade) return 1;
  const p = 1 - remaining / fade;
  return (1 - p) * (1 - p);
}

/** Whether the sleep timer is currently fading out. */
export function isTimerFading(startedAt: number, endsAt: number | undefined, now: number): boolean {
  if (endsAt === undefined || now >= endsAt) return false;
  return endsAt - now < timerFadeMs(endsAt - startedAt);
}

/** The volume to send to a voice: user volume × voice fades × sleep timer. */
export function effectiveVolume(volume: number, env: VoiceEnvelope, timer: { startedAt: number; endsAt?: number }, now: number): number {
  return clamp01(volume) * voiceGain(env, now) * sleepTimerGain(timer.startedAt, timer.endsAt, now);
}

/** "12:05" / "1:02:30" for a remaining duration. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
