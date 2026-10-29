import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Android's view haptics need no VIBRATE permission; the segment ticks need Android 14+.
let segmentTicks = true;
let lastTick = 0;

/** A light tick for scrubbing a chart or stepping through choices (rate-limited). */
export function selectionTick() {
  if (Platform.OS === 'web') return;
  const t = Date.now();
  if (t - lastTick < 30) return;
  lastTick = t;
  if (Platform.OS === 'android') {
    const fallback = () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(() => undefined);
    if (!segmentTicks) {
      fallback();
      return;
    }
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick).catch(() => {
      segmentTicks = false;
      fallback();
    });
    return;
  }
  Haptics.selectionAsync().catch(() => undefined);
}

/** A firmer confirmation when something was logged. */
export function confirmHaptic() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm).catch(() =>
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => undefined),
    );
    return;
  }
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
