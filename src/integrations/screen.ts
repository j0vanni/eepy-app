/**
 * The phone screen: read and (with permission) set its brightness, dim eepy's own window, and
 * open Android's Night Light (blue-light filter) and Extra dim settings. Apps can't switch Night
 * Light themselves; changing the phone's brightness needs the one-time "Modify system settings"
 * permission (WRITE_SETTINGS). Brightness here is always a position of Android's own slider (0–1),
 * converted to the panel's linear value with the AOSP curve (engine/screenLight.ts).
 * Everything is a safe no-op where unsupported (web, iOS settings intents).
 */
import * as Brightness from 'expo-brightness';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import { linearToSlider, sliderToLinear } from '../engine/screenLight';

/** The phone's brightness as a slider position (0–1), or undefined when unknown. */
export async function getScreenBrightness(): Promise<number | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    return linearToSlider(Platform.OS === 'android' ? await Brightness.getSystemBrightnessAsync() : await Brightness.getBrightnessAsync());
  } catch {
    return undefined;
  }
}

/** Whether eepy may change the phone's brightness (Android "Modify system settings"). */
export async function canSetPhoneBrightness(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return (await Brightness.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Opens Android's "Modify system settings" switch for eepy; resolves with the result when back. */
export async function askPhoneBrightnessPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return (await Brightness.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Sets the phone's own brightness (slider position 0–1). Android switches auto-brightness off. */
export async function setPhoneBrightness(slider: number): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await Brightness.setSystemBrightnessAsync(sliderToLinear(Math.max(0.01, slider)));
    return true;
  } catch {
    return false;
  }
}

/** Adaptive (auto) brightness on the phone, or undefined when it can't be read. */
export async function getAutoBrightness(): Promise<boolean | undefined> {
  if (Platform.OS !== 'android') return undefined;
  try {
    return (await Brightness.getSystemBrightnessModeAsync()) === Brightness.BrightnessMode.AUTOMATIC;
  } catch {
    return undefined;
  }
}

export async function setAutoBrightness(on: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await Brightness.setSystemBrightnessModeAsync(on ? Brightness.BrightnessMode.AUTOMATIC : Brightness.BrightnessMode.MANUAL);
    return true;
  } catch {
    return false;
  }
}

/** Dims only eepy's window (while it's in front) to a slider position; the phone's setting is untouched. */
export async function dimEepy(slider: number): Promise<void> {
  if (Platform.OS === 'web') return;
  await Brightness.setBrightnessAsync(Math.max(0.005, sliderToLinear(Math.min(1, slider)))).catch(() => undefined);
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
