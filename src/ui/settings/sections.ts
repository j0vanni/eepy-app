/**
 * The Settings pages (Settings → /settings/<id>). Pure data, shared by the Settings index, the
 * page screen and the feature search (src/ui/featureIndex.ts). Other screens link to these ids.
 */
export type SettingsSectionId = 'you' | 'alarms' | 'notifications' | 'winddown' | 'caffeine' | 'data' | 'updates' | 'about';

export interface SettingsSectionInfo {
  id: SettingsSectionId;
  title: string;
  icon: string;
  /** One line saying what's on the page. */
  sub: string;
  /** Group caption on the Settings index. */
  group: 'You' | 'App';
  /** What's on the page, for search. */
  keywords: string[];
}

export const SETTINGS_GROUPS: SettingsSectionInfo['group'][] = ['You', 'App'];

export const SETTINGS_SECTIONS: SettingsSectionInfo[] = [
  {
    id: 'you',
    title: 'You & schedule',
    icon: 'account-outline',
    sub: 'Age, sleep need, time format, your calendar',
    group: 'You',
    keywords: ['birth year', 'age', 'sleep need', 'manual', 'time format', '12-hour', '24-hour', 'clock', 'calendar', 'events', 'insomnia mode', 'cbt-i', 'self-checks', 'quiz', 'programme', 'workdays', 'wake-up'],
  },
  {
    id: 'alarms',
    title: 'Alarms & watch',
    icon: 'alarm',
    sub: 'Wake alarm, full-screen alarm, buzzes on your wrist',
    group: 'You',
    keywords: ['alarm', 'wake alarm', 'smart alarm', 'cycle-timed', 'full-screen', 'lock screen', 'snooze', 'watch first', 'wrist', 'buzz', 'vibrate', 'backup', 'nap alarm', 'nothing x', 'test buzz', 'cmf'],
  },
  {
    id: 'notifications',
    title: 'Notifications & shortcuts',
    icon: 'bell-outline',
    sub: 'Reminders, check-in reminders, background sync',
    group: 'You',
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
      'check-in reminders',
      'natural wake',
      'adaptive',
      'shortcuts',
      'quick settings',
      'tile',
      'app icon',
      'long-press',
      'learning',
      'energy',
      'body clock',
    ],
  },
  {
    id: 'winddown',
    title: 'Wind-down & phone light',
    icon: 'weather-night',
    sub: 'Your bedtime rundown, sleep sounds, screens, sleep mode',
    group: 'You',
    keywords: ['wind-down', 'routine', 'length', 'sleep sounds', 'white noise', 'brown noise', 'rain', 'volume', 'sleep timer', 'screens off', 'dim', 'warm', 'bedtime autopilot', 'sleep mode', 'do not disturb', 'dnd', 'modes', 'phone light', 'e-reader', 'e-ink', 'kindle', 'bedtime rundown', 'phone down', 'reading time'],
  },
  {
    id: 'caffeine',
    title: 'Caffeine & drinks',
    icon: 'coffee-outline',
    sub: 'How fast caffeine wears off, your limit, your own drinks',
    group: 'You',
    keywords: ['caffeine', 'coffee', 'half-life', 'bedtime limit', 'cut-off', 'drinks', 'tea', 'energy drink', 'custom drink'],
  },
  {
    id: 'data',
    title: 'Watch and data',
    icon: 'watch-variant',
    sub: 'Sync, which app to trust, backup, demo data',
    group: 'App',
    keywords: ['health connect', 'sync', 'connect', 'watch', 'nothing x', 'permissions', 'auto sync', 'history', 'import', 're-read', 'detect', 'actually up', 'which app', 'source', 'backup', 'restore', 'export', 'save', 'folder', 'demo', 'erase', 'delete', 'reset'],
  },
  {
    id: 'updates',
    title: 'App updates',
    icon: 'cellphone-arrow-down',
    sub: 'Get the newest version of eepy',
    group: 'App',
    keywords: ['update', 'new version', 'install', 'apk', 'github', 'sign in', 'build', 'changelog'],
  },
  {
    id: 'about',
    title: 'About',
    icon: 'information-outline',
    sub: "Version, what's new, the science behind eepy",
    group: 'App',
    keywords: ['about', 'version', "what's new", 'science', 'disclaimer', 'medical'],
  },
];

export const SETTINGS_SECTION_BY_ID = Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s])) as Record<SettingsSectionId, SettingsSectionInfo>;

export function isSettingsSection(id: string | undefined): id is SettingsSectionId {
  return !!id && id in SETTINGS_SECTION_BY_ID;
}
