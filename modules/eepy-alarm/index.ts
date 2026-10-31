/**
 * eepy's native Android bits (native code in ./android): the full-screen lock-screen alarm, the
 * app-icon shortcuts and "Log coffee" Quick Settings tile, and bedtime autopilot's sleep mode.
 *
 * `undefined` on iOS, web, Jest, Expo Go and APKs built before this module existed — callers fall
 * back to an expo-notifications alarm (and hide shortcuts / sleep mode).
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

  // ---- One-tap shortcuts ----

  /**
   * Replaces eepy's long-press app-icon shortcuts (ShortcutManager dynamic shortcuts) with `json`:
   * a JSON array of { id, shortLabel, longLabel, link, icon } (icon: 'coffee' | 'nap' | 'late' | 'checkin').
   * Resolves false if Android refused (e.g. rate-limited while in the background).
   */
  setShortcuts(json: string): Promise<boolean>;
  /** Android 13+: asks to add the "Log coffee" Quick Settings tile. False below 13 (add it by editing Quick Settings). */
  requestAddCoffeeTile(): Promise<boolean>;

  // ---- Bedtime autopilot ("eepy sleep" mode, an AutomaticZenRule) ----

  getSleepModeStatus(): Promise<NativeSleepModeStatus>;
  /**
   * Plans one night: exact alarms switch the mode on at `onAtMs` and off at `offAtMs`, also while eepy
   * is closed. Replaces the plan for any night that hasn't started; a night in progress keeps its own
   * "off". Inside the window already, it switches on now (once per night, unless stopped that night).
   * `sounds` (e.g. "Brown noise · 45 min") posts "Sleep mode on — play sleep sounds?" when it turns on.
   */
  scheduleSleepMode(night: string, onAtMs: number, offAtMs: number, sounds: string | null): Promise<NativeSleepModeStatus>;
  /** Drops every plan, and switches the mode off if eepy switched it on. */
  cancelSleepMode(): Promise<void>;
  /** On now, until `offAtMs`. False if Android didn't allow it (see status.lastError). */
  startSleepModeNow(night: string, offAtMs: number): Promise<boolean>;
  /** Off now, and it stays off for the rest of `night`. */
  stopSleepModeNow(night: string): Promise<boolean>;
  dismissSleepModePrompt(): Promise<void>;
  /** The system list where the user allows eepy to control Do Not Disturb / Modes. */
  openSleepModeAccessSettings(): Promise<boolean>;
  /** Android 15+: the mode's own settings page (what it lets through, its effects); else Do Not Disturb settings. */
  openSleepModeSettings(): Promise<boolean>;
}

export interface NativeSleepModeWindow {
  night: string;
  onAt: number;
  offAt: number;
  sounds: string | null;
}

export interface NativeSleepModeStatus {
  /** Build.VERSION.SDK_INT */
  sdk: number;
  /** Android 10+ (setAutomaticZenRuleState). */
  supported: boolean;
  /** Android 15+: grayscale, dimmed wallpaper, dark theme, no always-on display while on. */
  deviceEffects: boolean;
  /** Do Not Disturb / Modes access granted. */
  access: boolean;
  ruleId: string | null;
  /** On right now (Android 15+ reads the mode; older: what eepy last asked for). Null when unknown. */
  active: boolean | null;
  /** Android 15+ "Modes" settings UI is available (the mode can be customised there). */
  userManaged: boolean;
  exactAlarms: boolean;
  windows: NativeSleepModeWindow[];
  /** Night eepy switched the mode on for / the user stopped it for. */
  appliedNight: string | null;
  stoppedNight: string | null;
  lastError: string | null;
}

const EepyAlarm: EepyAlarmModule | undefined =
  Platform.OS === 'android' ? (requireOptionalNativeModule<EepyAlarmModule>('EepyAlarm') ?? undefined) : undefined;

export default EepyAlarm;
