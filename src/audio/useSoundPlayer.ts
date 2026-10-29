import { useSyncExternalStore } from 'react';

import { AudioSettings, useStore } from '../state/store';
import { PlaybackState, soundPlayer } from './player';
import { SoundId } from './sounds';

export interface SoundControls {
  playback: PlaybackState;
  /** The remembered choices (Settings → wind-down sounds); the live session follows them. */
  settings: AudioSettings;
  playing: boolean;
  /** Starts the remembered sound, or `sound` if given (and remembers it). */
  play(sound?: SoundId): void;
  stop(): void;
  toggle(sound?: SoundId): void;
  setSound(sound: SoundId): void;
  setVolume(volume: number): void;
  setTimer(timerMin: number): void;
}

/** Live playback state of the shared sleep-sound player. */
export function usePlayback(): PlaybackState {
  return useSyncExternalStore(soundPlayer.subscribe, soundPlayer.getState, soundPlayer.getState);
}

/**
 * Sleep-sound controls that remember every choice via `setAudioSettings` and apply it to the
 * running session (switching sound crossfades, a new timer re-arms from now).
 */
export function useSoundPlayer(): SoundControls {
  const playback = usePlayback();
  const settings = useStore((s) => s.settings.audio);
  const setAudioSettings = useStore((s) => s.setAudioSettings);
  const playing = playback.status === 'playing';

  const current = () => useStore.getState().settings.audio;

  return {
    playback,
    settings,
    playing,
    play(sound) {
      if (sound && sound !== current().sound) setAudioSettings({ sound });
      void soundPlayer.play(current());
    },
    stop() {
      soundPlayer.stop();
    },
    toggle(sound) {
      if (soundPlayer.getState().status === 'playing') soundPlayer.stop();
      else {
        if (sound && sound !== current().sound) setAudioSettings({ sound });
        void soundPlayer.play(current());
      }
    },
    setSound(sound) {
      setAudioSettings({ sound });
      if (soundPlayer.isActive) soundPlayer.switchSound(sound);
    },
    setVolume(volume) {
      const v = Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100;
      setAudioSettings({ volume: v });
      soundPlayer.setVolume(v);
    },
    setTimer(timerMin) {
      setAudioSettings({ timerMin });
      if (soundPlayer.isActive) soundPlayer.setTimer(timerMin);
    },
  };
}
