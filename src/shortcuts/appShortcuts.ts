/**
 * Publishes the long-press app-icon shortcuts (Android dynamic shortcuts, via the native module)
 * and asks to add the "Log coffee" Quick Settings tile. No-ops on web / iOS / Expo Go / older APKs.
 */
import { Platform } from 'react-native';

import EepyAlarm from '../../modules/eepy-alarm';
import { APP_SHORTCUTS } from './quickActions';

let published = false;

/** Tests only. */
export function resetShortcutsMemo(): void {
  published = false;
}

export function hasAppShortcuts(): boolean {
  return Platform.OS === 'android' && typeof EepyAlarm?.setShortcuts === 'function';
}

/** Sets the dynamic shortcuts once per app start (cheap; also brings them back after a restore). */
export async function refreshAppShortcuts(): Promise<boolean> {
  if (published || !hasAppShortcuts()) return false;
  try {
    published = (await EepyAlarm?.setShortcuts(JSON.stringify(APP_SHORTCUTS))) === true;
  } catch (e) {
    console.warn('app shortcuts failed', e);
  }
  return published;
}

/** True when Android can offer to add the tile in one tap (Android 13+); otherwise the user edits Quick Settings. */
export function canRequestCoffeeTile(): boolean {
  return hasAppShortcuts() && typeof Platform.Version === 'number' && Platform.Version >= 33 && typeof EepyAlarm?.requestAddCoffeeTile === 'function';
}

/** Android 13+: the system's "Add tile to Quick Settings?" prompt. False when not possible here. */
export async function requestCoffeeTile(): Promise<boolean> {
  if (!canRequestCoffeeTile()) return false;
  try {
    return (await EepyAlarm?.requestAddCoffeeTile()) === true;
  } catch {
    return false;
  }
}
