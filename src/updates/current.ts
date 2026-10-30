/**
 * Facts about the running app that update checks need. CI writes
 * `expo.android.versionCode = <run number>` into app.json before building the APK (see
 * .github/workflows/android-apk.yml), and expo-constants embeds that config in the APK.
 * Development builds, web and Jest have no real build number.
 */
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { resolveInstalledBuild } from './releases';

export interface InstalledBuild {
  /** App version from app.json ("0.2.0"). */
  version: string;
  /** CI build number; undefined in development / web / Jest builds. */
  build?: number;
}

let cached: InstalledBuild | undefined;

export function installedBuild(): InstalledBuild {
  cached ??= {
    version: Constants.expoConfig?.version ?? '',
    build: resolveInstalledBuild({ os: Platform.OS, dev: __DEV__, versionCode: Constants.expoConfig?.android?.versionCode }),
  };
  return cached;
}

/** Android package name, for the "Install unknown apps" settings page. */
export function appPackageName(): string {
  return Constants.expoConfig?.android?.package ?? 'com.j0vanni.eepy';
}

/**
 * The eepy GitHub App's client ID (public, from app.json `expo.extra.githubClientId`). Undefined
 * until the owner creates the app and fills it in: "Sign in with GitHub" is hidden until then.
 */
export function githubClientId(): string | undefined {
  const id = (Constants.expoConfig?.extra as { githubClientId?: unknown } | undefined)?.githubClientId;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

/** eepy is on screen right now. */
export function appInForeground(): boolean {
  return AppState.currentState === 'active';
}
