/**
 * The phone screen: read its brightness, dim eepy's own window, and open Android's Night Light
 * (blue-light filter) and Extra dim settings. Third-party apps can't switch Night Light themselves
 * or change system brightness without a special permission, so eepy guides and links instead.
 * Everything is a safe no-op where unsupported (web, iOS settings intents).
 */
import * as Brightness from 'expo-brightness';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/** System screen brightness 0–1 (what the user set), or undefined when unknown. */
export async function getScreenBrightness(): Promise<number | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    return Platform.OS === 'android' ? await Brightness.getSystemBrightnessAsync() : await Brightness.getBrightnessAsync();
  } catch {
    return undefined;
  }
}

/** Dims only eepy's window (while it's in front); the phone's own setting is untouched. */
export async function dimEepy(level: number): Promise<void> {
  if (Platform.OS === 'web') return;
  await Brightness.setBrightnessAsync(Math.max(0.01, Math.min(1, level))).catch(() => undefined);
}

/** eepy follows the system brightness again. */
export async function undimEepy(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Brightness.restoreSystemBrightnessAsync().catch(() => undefined);
}

async function openFirst(actions: string[]): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  for (const action of actions) {
    try {
      await IntentLauncher.startActivityAsync(action);
      return true;
    } catch {
      // Not on this phone: try the next one.
    }
  }
  return false;
}

/** Android's Night Light (blue-light filter) screen, where its schedule and warmth are set. */
export function openNightLightSettings(): Promise<boolean> {
  return openFirst(['android.settings.NIGHT_DISPLAY_SETTINGS', 'android.settings.DISPLAY_SETTINGS']);
}

/** Android 12+ "Extra dim" (dims below the normal minimum). */
export function openExtraDimSettings(): Promise<boolean> {
  return openFirst(['android.settings.REDUCE_BRIGHT_COLORS_SETTINGS', 'android.settings.ACCESSIBILITY_SETTINGS']);
}

export function screenControlsSupported(): boolean {
  return Platform.OS === 'android';
}
