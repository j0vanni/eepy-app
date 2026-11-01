/**
 * The Settings pages (Settings home → /settings/<id>). Pure data, shared by the Settings home,
 * the page screen and the feature search (src/ui/featureIndex.ts).
 */
export type SettingsSectionId = 'you' | 'alarms' | 'notifications' | 'winddown' | 'caffeine' | 'data' | 'updates' | 'about';

export interface SettingsSectionInfo {
  id: SettingsSectionId;
  title: string;
  icon: string;
  /** One line saying what's on the page. */
  sub: string;
  /** Group heading on the Settings home. */
  group: 'You' | 'Your nights' | 'App & data';
  /** What's on the page, for search. */
  keywords: string[];
}

export const SETTINGS_SECTIONS: SettingsSectionInfo[] = [
  {
    id: 'you',
    title: 'You & schedule',
    icon: 'account-outline',
    sub: 'Age, sleep need, time format, your calendar, self-checks',
    group: 'You',
    keywords: ['birth year', 'age', 'sleep need', 'manual', 'time format', '12-hour', '24-hour', 'clock', 'calendar', 'events', 'insomnia mode', 'cbt-i', 'self-checks', 'quiz', 'programme', 'workdays', 'wake-up'],
  },
  {
    id: 'alarms',
    title: 'Alarms & watch',
    icon: 'alarm',
    sub: 'Wake alarm, full-screen alarm, buzzes on your CMF Watch',
    group: 'Your nights',
    keywords: ['alarm', 'wake alarm', 'smart alarm', 'cycle-timed', 'full-screen', 'lock screen', 'snooze', 'watch first', 'wrist', 'buzz', 'vibrate', 'backup', 'nap alarm', 'nothing x', 'test buzz', 'cmf'],
  },
  {
    id: 'notifications',
    title: 'Notifications & shortcuts',
    icon: 'bell-outline',
    sub: 'Reminders, check-in pings, app-icon shortcuts',
    group: 'Your nights',
    keywords: [
      'notifications',
      'reminders',
      'wind-down reminder',
      'bedtime reminder',
      'caffeine cut-off',
      'morning check-in',
      'morning report',
      'missing night',
      'background sync',
      'pings',
      'alertness',
      'natural wake',
      'adaptive',
      'shortcuts',
      'quick settings',
      'tile',
      'app icon',
      'long-press',
      'learning',
      'body clock',
    ],
  },
  {
    id: 'winddown',
    title: 'Wind-down & phone light',
    icon: 'weather-night',
    sub: 'Wind-down length, sleep sounds, screens off, bedtime sleep mode',
    group: 'Your nights',
    keywords: ['wind-down', 'routine', 'length', 'sleep sounds', 'white noise', 'brown noise', 'rain', 'volume', 'sleep timer', 'screens off', 'dim', 'warm', 'bedtime autopilot', 'sleep mode', 'do not disturb', 'dnd', 'modes', 'phone light'],
  },
  {
    id: 'caffeine',
    title: 'Caffeine & drinks',
    icon: 'coffee-outline',
    sub: 'How fast caffeine wears off, your bedtime limit, your own drinks',
    group: 'Your nights',
    keywords: ['caffeine', 'coffee', 'half-life', 'bedtime limit', 'cut-off', 'drinks', 'tea', 'energy drink', 'custom drink'],
  },
  {
    id: 'data',
    title: 'Health Connect & data',
    icon: 'watch-variant',
    sub: 'Sync your watch, which app to trust, backup, demo data',
    group: 'App & data',
    keywords: ['health connect', 'sync', 'connect', 'watch', 'nothing x', 'permissions', 'auto sync', 'history', 'import', 'detect', 'actually up', 'which app', 'source', 'backup', 'restore', 'export', 'demo', 'erase', 'delete', 'reset'],
  },
  {
    id: 'updates',
    title: 'App updates',
    icon: 'cellphone-arrow-down',
    sub: 'Get the newest version of eepy',
    group: 'App & data',
    keywords: ['update', 'new version', 'install', 'apk', 'github', 'sign in', 'build', 'changelog'],
  },
  {
    id: 'about',
    title: 'About',
    icon: 'information-outline',
    sub: "Version, what's new, the science behind eepy",
    group: 'App & data',
    keywords: ['about', 'version', "what's new", 'science', 'disclaimer', 'medical'],
  },
];

export const SETTINGS_SECTION_BY_ID = Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s])) as Record<SettingsSectionId, SettingsSectionInfo>;

export function isSettingsSection(id: string | undefined): id is SettingsSectionId {
  return !!id && id in SETTINGS_SECTION_BY_ID;
}
