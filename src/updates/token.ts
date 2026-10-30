/**
 * The GitHub token for update checks, kept in expo-secure-store (Android Keystore-backed), never in
 * the zustand store or AsyncStorage. SecureStore only needs the React context, not an Activity,
 * so the headless background task can read it too. The expo-secure-store config plugin keeps it
 * out of Android Auto Backup (a restored copy couldn't be decrypted on another phone anyway).
 *
 * Web has no secure storage: there, eepy is always signed out.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'eepy.github.token';

// undefined = not read yet; null = no token.
let cached: string | null | undefined;

export function tokenStorageSupported(): boolean {
  return Platform.OS !== 'web';
}

/**
 * The stored token, or undefined when signed out. Throws when secure storage can't be read (e.g.
 * the keystore key was invalidated), so callers don't mistake that for being signed out.
 */
export async function getGithubToken(): Promise<string | undefined> {
  if (!tokenStorageSupported()) return undefined;
  cached ??= (await SecureStore.getItemAsync(KEY)) || null;
  return cached ?? undefined;
}

export const TOKEN_UNREADABLE = 'Couldn’t read your GitHub sign-in from this phone’s secure storage. Try again, or sign out and sign in again.';

export async function setGithubToken(token: string): Promise<void> {
  if (!tokenStorageSupported()) throw new Error('Signing in works in the Android app.');
  await SecureStore.setItemAsync(KEY, token);
  cached = token;
}

export async function clearGithubToken(): Promise<void> {
  cached = null;
  if (!tokenStorageSupported()) return;
  await SecureStore.deleteItemAsync(KEY).catch((e) => console.warn('deleting the GitHub token failed', e));
}
