/**
 * eepy's full-screen lock-screen alarm (Android only; native code in ./android).
 *
 * `undefined` on iOS, web, Jest, Expo Go and APKs built before this module existed — callers fall
 * back to an expo-notifications alarm.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface EepyAlarmModule {
  /**
   * Schedules (or replaces) the exact alarm `id` (AlarmManager.setAlarmClock). When it fires, a
   * full-screen notification takes over the lock screen with "I'm up" / "Snooze 9 min"; "I'm up"
   * opens `link` (default `eepy://checkin`). Resolves false if Android refused to schedule it.
   */
  scheduleAlarm(id: string, triggerAtMs: number, title: string, body: string, link?: string | null): Promise<boolean>;
  /** Cancels the alarm `id` and its snooze, and stops it if it's ringing. */
  cancelAlarm(id: string): Promise<void>;
  /** Android 14+ lets the user block full-screen alarms per app; always true below 14. */
  canUseFullScreenIntent(): Promise<boolean>;
  /** Opens the system screen where the user allows full-screen alarms for eepy. */
  openFullScreenIntentSettings(): Promise<void>;
}

const EepyAlarm: EepyAlarmModule | undefined =
  Platform.OS === 'android' ? (requireOptionalNativeModule<EepyAlarmModule>('EepyAlarm') ?? undefined) : undefined;

export default EepyAlarm;
