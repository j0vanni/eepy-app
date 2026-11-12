/**
 * Search (the box on More and Settings): a small index of every screen, tool and Settings page,
 * with the words people might use for them and where each one lives. Pure (no React) and
 * unit-tested: src/ui/__tests__/featureIndex.test.ts checks every route file and Settings page is
 * covered, and that every entry points at a route that exists.
 *
 * The app's shape: tabs Today · Sleep · Plan · More. More groups everything else under Energy,
 * Sleep, Coach, Self-checks and App.
 */
import type { Href } from 'expo-router';

import { SETTINGS_SECTIONS, SettingsSectionId } from './settings/sections';

export interface Feature {
  id: string;
  title: string;
  /** Where it lives, in plain words: "Plan › Your usual week". */
  where: string;
  icon: string;
  keywords: string[];
  href: Href;
}

const settingsPage = (section: SettingsSectionId): Href => ({ pathname: '/settings/[section]', params: { section } });
/** The Plan tab, scrolled to a part of it (and with that tool opened). */
const plan = (show?: 'tonight' | 'week' | 'calculator' | 'shift' | 'caffeine' | 'light'): Href => (show ? { pathname: '/planner', params: { show } } : '/planner');
const sleep = (view: 'trends' | 'nights'): Href => ({ pathname: '/sleep', params: { view } });
const quiz = (id: 'rmeq' | 'ess' | 'isi' | 'stopbang'): Href => ({ pathname: '/quiz/[id]', params: { id } });

const settingsTitle = (id: SettingsSectionId) => SETTINGS_SECTIONS.find((s) => s.id === id)!.title;
const inSettings = (id: SettingsSectionId) => `Settings › ${settingsTitle(id)}`;

const TODAY_BUTTONS = "Today's buttons";

const SCREENS: Feature[] = [
  // Tabs
  { id: 'today', title: 'Today', where: 'Tab', icon: 'white-balance-sunny', href: '/', keywords: ['home', 'last night', 'energy now', 'countdown', 'lights out', 'what is next', 'morning check-in'] },
  { id: 'sleep', title: 'Sleep', where: 'Tab', icon: 'moon-waning-crescent', href: '/sleep', keywords: ['history', 'last night', 'nights', 'trends', 'need', 'debt', 'average', 'past'] },
  { id: 'planner', title: 'Plan', where: 'Tab', icon: 'calendar-clock-outline', href: '/planner', keywords: ['planner', 'week', 'bedtime', 'lights out', 'alarm', 'wake-up', 'schedule', 'tonight'] },
  { id: 'more', title: 'More', where: 'Tab', icon: 'menu', href: '/more', keywords: ['tools', 'all features', 'menu'] },

  // Today
  { id: 'in-bed', title: "I'm in bed (start the sleep session)", where: 'Today › evening and night', icon: 'bed', href: '/', keywords: ['in bed', 'going to bed', 'sleep session', 'sleep sesh', 'start sleep', 'lights out now', 'bedtime now', "i'm up", 'end session', 'good night', 'save last night', 'up early', 'woke up early', 'awake before alarm', 'up before alarm', 'wake up time', 'woke up earlier', 'change wake time', 'correct wake up'] },

  // More › Energy
  {
    id: 'energy',
    title: 'Energy',
    where: 'More › Energy, or tap the energy number on Today',
    icon: 'lightning-bolt-outline',
    href: '/energy',
    keywords: ['why the number', 'what the watch adds', 'watch signals', 'hrv', 'heart rate', 'breathing', 'deep sleep', 'accuracy', 'check-ins', 'body clock', 'circadian', 'rhythm', 'energy forecast', 'learning', 'chronotype', 'alertness'],
  },
  { id: 'reaction', title: 'Reaction test', where: 'More › Energy', icon: 'gesture-tap', href: '/reaction', keywords: ['reaction time', 'one minute', 'objective', 'alertness', 'tap test', 'pvt', 'how sharp', 'reflexes'] },
  { id: 'checkin', title: 'Check in', where: `${TODAY_BUTTONS} · More › Energy`, icon: 'emoticon-happy-outline', href: '/checkin', keywords: ['quick check-in', 'how do you feel', 'how alert', 'sleepiness', 'energy', 'log', 'tag', 'rate'] },
  { id: 'nap', title: 'Nap', where: `${TODAY_BUTTONS} · More › Energy`, icon: 'sleep', href: '/nap', keywords: ['nap coach', 'power nap', 'nap timer', 'sleepy', 'afternoon', 'should i nap'] },
  { id: 'log-nap', title: 'Log a nap you took', where: 'Nap, and Check in', icon: 'sleep', href: '/nap', keywords: ['log nap', 'took a nap', 'unplanned nap', 'add nap', 'napped', 'dozed off'] },
  { id: 'log-drink', title: 'Log a drink', where: `${TODAY_BUTTONS} · More › Energy › Caffeine`, icon: 'coffee', href: '/caffeine', keywords: ['coffee', 'tea', 'caffeine', 'espresso', 'energy drink', 'add drink'] },

  // Plan
  { id: 'tonight-plan', title: "Tonight's plan", where: 'Plan › Tonight', icon: 'moon-waning-crescent', href: plan('tonight'), keywords: ['tonight', 'bedtime', 'lights out', 'wind down', 'why these times'] },
  {
    id: 'plan-options',
    title: 'Options for tonight (and "Still up?")',
    where: 'Plan › Options for tonight',
    icon: 'source-branch',
    href: plan('tonight'),
    keywords: ['options', 'possibilities', 'alternatives', 'best plan', 'how eepy decided', 'thinking', 'reasoning', 'still up', 're-plan', 'replan', 'skip routine tonight', 'catch up tonight', 'nap tomorrow', 'sleep in a little', 'going to bed late', 'bedtime slipping'],
  },
  { id: 'adjust-tonight', title: 'Adjust tonight', where: `Plan › Tonight · ${TODAY_BUTTONS}`, icon: 'clock-edit-outline', href: '/tonight', keywords: ["can't make it", 'running late', 'later bedtime', 'stay up', 'change tonight', 'late night'] },
  { id: 'plan-morning', title: 'Plan a single morning', where: 'Plan › The week ahead › tap a day', icon: 'calendar-edit', href: '/planner', keywords: ['set a time', 'free day', 'day off', 'no alarm', 'holiday', 'flight', 'appointment', 'early start', 'sleep in'] },
  { id: 'skip-alarm', title: "Skip tomorrow's alarm", where: 'Plan › Tonight in detail', icon: 'alarm-off', href: plan('tonight'), keywords: ['skip alarm', 'day off', 'sleep in', 'turn off alarm', 'no alarm'] },
  { id: 'usual-week', title: 'Workdays & wake-up times', where: 'Plan › Your usual week', icon: 'calendar-week', href: plan('week'), keywords: ['workdays', 'wake time', 'wake-up time', 'wakeup', 'weekend', 'free day wake-up', 'usual week', 'alarm time', 'work schedule'] },
  { id: 'day-wake', title: 'Different wake-up times on different days', where: 'Plan › Your usual week', icon: 'calendar-clock-outline', href: plan('week'), keywords: ['different wake times', 'each day', 'per day', 'tuesday', 'shift', 'varying schedule', 'irregular schedule', 'wake time per day'] },
  { id: 'two-step-morning', title: 'Two-step morning (routine, then back to sleep)', where: 'Plan › Your usual week', icon: 'weather-sunset-up', href: plan('week'), keywords: ['morning routine', 'routine alarm', 'two alarms', 'back to sleep', 'face routine', 'skin care', 'wake up twice', 'second alarm', '5am', 'skip routine', 'routine one day', 'no routine tomorrow', 'skipped my routine', 'did my routine', 'slept through routine'] },
  { id: 'month-view', title: 'Month view (calendar)', where: 'Plan › The week ahead › Month view', icon: 'calendar-month-outline', href: '/calendar', keywords: ['calendar', 'month', 'plan ahead', 'future', 'weeks'] },
  { id: 'recovery', title: 'Getting back on track (sleep debt)', where: 'Plan › Tonight in detail', icon: 'battery-charging-medium', href: plan('tonight'), keywords: ['sleep debt', 'catch up', 'recovery', 'pay back', 'tired'] },
  { id: 'calculator', title: 'Bedtime calculator', where: 'Plan › Tools', icon: 'calculator-variant-outline', href: plan('calculator'), keywords: ['when to sleep', 'sleep cycles', 'what time to go to bed', 'wake up at', 'sleep now'] },
  { id: 'shift', title: 'Move your schedule', where: 'Plan › Tools', icon: 'arrow-left-right', href: plan('shift'), keywords: ['shift schedule', 'wake earlier', 'wake later', 'new routine', 'light'] },
  { id: 'caffeine-curve', title: 'Caffeine in your system', where: 'Plan › Tools', icon: 'coffee-outline', href: plan('caffeine'), keywords: ['caffeine', 'coffee', 'cut-off', 'last coffee', 'mg', 'curve'] },
  { id: 'phone-light', title: 'Phone light', where: 'Plan › Tools', icon: 'brightness-6', href: plan('light'), keywords: ['brightness', 'screen', 'night light', 'blue light', 'extra dim', 'too dark', 'cant see', 'dim', 'brighter'] },
  { id: 'body-clock-tonight', title: 'Your body clock tonight', where: 'Plan › Tools', icon: 'clock-outline', href: '/planner', keywords: ['melatonin', 'ready for sleep', 'circadian', 'sleep gate', 'second wind'] },
  { id: 'simulate', title: 'What if?', where: 'Plan › Tools · More › Sleep', icon: 'tune-variant', href: '/simulate', keywords: ['simulator', 'try', 'tomorrow', 'experiment with bedtime', 'forecast'] },
  { id: 'jetlag', title: 'Jet lag', where: 'Plan › Tools · More › Coach', icon: 'airplane-clock', href: '/jetlag', keywords: ['travel', 'time zone', 'flight', 'planner'] },

  // Sleep
  { id: 'last-night', title: 'Last night', where: 'Sleep', icon: 'bed-outline', href: '/sleep', keywords: ['how did i sleep', 'score', 'hypnogram', 'stages', 'night details'] },
  { id: 'nights', title: 'All nights', where: 'Sleep › Nights', icon: 'format-list-bulleted', href: sleep('nights'), keywords: ['list', 'night details', 'report', 'hypnogram', 'stages'] },
  { id: 'trends', title: 'Trends', where: 'Sleep › Trends', icon: 'chart-line', href: sleep('trends'), keywords: ['charts', 'average', 'sleep debt', 'score', 'regularity', 'chronotype', 'hrv', 'heart rate', 'deep sleep', 'rem', 'breathing', 'oxygen', 'spo2'] },
  { id: 'sleep-calendar', title: 'Sleep calendar', where: 'Sleep › Month calendar', icon: 'calendar-month', href: '/calendar', keywords: ['month', 'past nights', 'calendar', 'history'] },

  // More › Sleep
  { id: 'need', title: 'Sleep need and debt', where: 'More › Sleep', icon: 'scale-balance', href: '/need', keywords: ['how much sleep', 'hours', 'your sleep need', 'estimate', 'owe', 'pay back'] },
  { id: 'winddown', title: 'Wind-down', where: 'More › Sleep', icon: 'weather-night', href: '/winddown', keywords: ['routine', 'breathing', 'relax', 'sounds', 'white noise', "can't sleep", 'checklist', 'calm', 'light check'] },
  {
    id: 'rundown',
    title: 'Bedtime rundown (step by step)',
    where: 'Today › evening · More › Sleep › Wind-down',
    icon: 'format-list-checks',
    href: '/rundown',
    keywords: ['bedtime routine', 'rundown', 'phone down', 'reading', 'e-book', 'kindle', 'shower', 'to-do list', 'checklist', 'start my rundown', 'guided', 'step by step', 'teeth', 'skin care', 'evening routine', 'night routine'],
  },
  { id: 'sleep-sounds', title: 'Sleep sounds & timer', where: inSettings('winddown'), icon: 'music-note-outline', href: settingsPage('winddown'), keywords: ['white noise', 'brown noise', 'pink noise', 'rain', 'volume', 'sleep timer'] },
  { id: 'autopilot', title: 'Bedtime autopilot (phone sleep mode)', where: inSettings('winddown'), icon: 'moon-waning-crescent', href: settingsPage('winddown'), keywords: ['sleep mode', 'do not disturb', 'dnd', 'grayscale', 'modes', 'silence'] },
  { id: 'journal', title: 'Journal', where: 'More › Sleep', icon: 'notebook-outline', href: '/journal', keywords: ['tags', 'diary', 'ratings', 'alcohol', 'notes', 'log day'] },
  { id: 'log-sleep', title: 'Log a night yourself', where: 'More › Sleep', icon: 'pencil-plus-outline', href: '/log-sleep', keywords: ['manual', 'add sleep', 'forgot watch', 'missing night', 'nap log', 'sleep time', 'adjust sleep time', 'adjust wake time', 'fell asleep'] },

  // More › Coach
  { id: 'coach', title: 'Coach', where: 'More › Coach', icon: 'account-heart-outline', href: '/coach', keywords: ['coach', 'advice', 'tips', 'suggestions'] },
  { id: 'experiments', title: 'Experiments', where: 'More › Coach', icon: 'flask-outline', href: '/experiments', keywords: ['test', 'try something', 'before after', 'experiment'] },
  { id: 'goals', title: 'Goals', where: 'More › Coach', icon: 'flag-checkered', href: '/goals', keywords: ['goals', 'streak', 'habits'] },
  { id: 'review', title: 'Weekly review', where: 'More › Coach', icon: 'calendar-week', href: '/review', keywords: ['week', 'summary', 'report', 'review'] },
  { id: 'cbti', title: 'Insomnia programme', where: 'More › Coach', icon: 'bed-clock', href: '/cbti', keywords: ['cbt-i', 'insomnia', 'sleep restriction', '6 weeks', 'programme', 'program'] },

  // More › Self-checks
  { id: 'quiz-rmeq', title: 'Chronotype quiz', where: 'More › Self-checks', icon: 'owl', href: quiz('rmeq'), keywords: ['morning person', 'night owl', 'lark', 'quiz', 'self-check'] },
  { id: 'quiz-ess', title: 'Daytime sleepiness check', where: 'More › Self-checks', icon: 'sleep', href: quiz('ess'), keywords: ['sleepy', 'epworth', 'doze', 'quiz', 'self-check'] },
  { id: 'quiz-isi', title: 'Insomnia check', where: 'More › Self-checks', icon: 'eye-outline', href: quiz('isi'), keywords: ["can't sleep", 'insomnia', 'quiz', 'self-check'] },
  { id: 'quiz-stopbang', title: 'Sleep apnoea risk', where: 'More › Self-checks', icon: 'lungs', href: quiz('stopbang'), keywords: ['snoring', 'apnea', 'breathing', 'stop-bang', 'quiz', 'self-check'] },

  // More › App
  { id: 'settings', title: 'Settings', where: 'More › App', icon: 'cog-outline', href: '/settings', keywords: ['preferences', 'options', 'configure'] },
  { id: 'connect', title: 'Connect your CMF Watch', where: 'More › App › Watch and data', icon: 'link-variant', href: '/connect', keywords: ['health connect', 'pair', 'nothing x', 'permissions', 'setup', 'watch'] },
  { id: 'export', title: 'Reports', where: 'More › App', icon: 'file-chart-outline', href: '/export', keywords: ['export', 'pdf', 'doctor', 'csv', 'spreadsheet', 'share', 'print', 'report', 'save to a folder'] },
  { id: 'updates-screen', title: 'App updates', where: 'More › App', icon: 'cellphone-arrow-down', href: '/updates', keywords: ['update', 'new version', 'install'] },
  { id: 'whats-new', title: "What's new", where: 'More › App', icon: 'gift-outline', href: '/whats-new', keywords: ['new', 'changes', 'new look', 'release', 'help'] },
];

/** Single settings people look for by name, pointing at their page. */
const SETTINGS_ITEMS: Feature[] = [
  { id: 's-birth-year', title: 'Birth year', where: inSettings('you'), icon: 'cake-variant-outline', href: settingsPage('you'), keywords: ['age'] },
  { id: 's-time-format', title: 'Time format (12 / 24-hour)', where: inSettings('you'), icon: 'clock-outline', href: settingsPage('you'), keywords: ['12-hour', '24-hour', 'am pm', 'clock'] },
  { id: 's-sleep-need', title: 'Set my sleep need', where: inSettings('you'), icon: 'battery-charging-high', href: settingsPage('you'), keywords: ['manual', 'hours', 'override'] },
  { id: 's-insomnia-mode', title: 'Insomnia mode', where: inSettings('you'), icon: 'account-heart-outline', href: settingsPage('you'), keywords: ['cbt-i', 'no naps', 'rules'] },
  { id: 's-calendar', title: 'Plan around my calendar', where: inSettings('you'), icon: 'calendar-sync', href: settingsPage('you'), keywords: ['calendar', 'events', 'first event', 'meeting', 'google calendar', 'prep time'] },
  { id: 's-wake-alarm', title: 'Wake alarm (cycle-timed)', where: inSettings('alarms'), icon: 'alarm', href: settingsPage('alarms'), keywords: ['smart alarm', 'turn on alarm', 'alarm sound', 'full-screen alarm', 'snooze'] },
  { id: 's-watch-alarm', title: 'Watch-first alarms', where: inSettings('alarms'), icon: 'watch-vibrate', href: settingsPage('alarms'), keywords: ['buzz', 'wrist', 'vibrate', 'silent alarm', 'partner', 'test buzz', 'backup'] },
  { id: 's-reminders', title: 'Reminders', where: inSettings('notifications'), icon: 'bell-ring-outline', href: settingsPage('notifications'), keywords: ['wind-down reminder', 'bedtime reminder', 'caffeine cut-off', 'screens off', 'morning check-in', 'forgot coffee', 'adaptive'] },
  { id: 's-background', title: 'Background sync & morning report', where: inSettings('notifications'), icon: 'sync', href: settingsPage('notifications'), keywords: ['while closed', 'morning report', 'missing night'] },
  { id: 's-pings', title: 'Check-in reminders', where: inSettings('notifications'), icon: 'bell-badge-outline', href: settingsPage('notifications'), keywords: ['pings', 'alertness', 'how alert', 'how many a day', 'natural wake'] },
  { id: 's-reset-learning', title: 'Reset what eepy learned', where: inSettings('notifications'), icon: 'restore', href: settingsPage('notifications'), keywords: ['reset learned rhythm', 'body clock', 'watch signals', 'weights', 'start learning again', 'forget'] },
  { id: 's-shortcuts', title: 'Shortcuts & Quick Settings tile', where: inSettings('notifications'), icon: 'gesture-tap-hold', href: settingsPage('notifications'), keywords: ['app icon', 'long-press', 'log coffee tile', 'home screen'] },
  { id: 's-winddown-length', title: 'Wind-down length', where: inSettings('winddown'), icon: 'timer-sand', href: settingsPage('winddown'), keywords: ['how long', 'minutes before bed', 'routine'] },
  { id: 's-screens-off', title: 'Screens off before lights-out', where: inSettings('winddown'), icon: 'cellphone-off', href: settingsPage('winddown'), keywords: ['phone away', 'screen time', 'phone down'] },
  {
    id: 's-rundown',
    title: 'Your bedtime rundown (customize)',
    where: inSettings('winddown'),
    icon: 'tune-variant',
    href: settingsPage('winddown'),
    keywords: ['bedtime routine', 'rundown', 'phone down', 'reading time', 'e-book', 'kindle', 'shower', 'to-do list', 'checklist', 'reorder', 'add a step', 'custom step', 'last drink', 'alcohol'],
  },
  { id: 's-e-reader', title: 'E-ink reader (Kindle, Kobo, Boox)', where: inSettings('winddown'), icon: 'book-open-variant', href: settingsPage('winddown'), keywords: ['e-reader', 'ereader', 'e-ink', 'eink', 'kindle', 'kobo', 'boox', 'reading', 'read in bed', 'book', 'frontlight', 'front light', 'warm light', 'amber'] },
  { id: 's-dim-eepy', title: 'Dim and warm eepy in the evening', where: inSettings('winddown'), icon: 'brightness-4', href: settingsPage('winddown'), keywords: ['tint', 'dim', 'warm', 'night'] },
  { id: 's-half-life', title: 'How fast caffeine wears off', where: inSettings('caffeine'), icon: 'coffee-outline', href: settingsPage('caffeine'), keywords: ['half-life', 'how fast', 'sensitive', 'bedtime limit'] },
  { id: 's-drinks', title: 'Your own drinks', where: inSettings('caffeine'), icon: 'star-outline', href: settingsPage('caffeine'), keywords: ['custom', 'instant coffee', 'mg'] },
  { id: 's-sync', title: 'Sync now', where: inSettings('data'), icon: 'sync', href: settingsPage('data'), keywords: ['health connect', 'refresh', 'auto sync', 'sync automatically', 'last sync'] },
  { id: 's-reread', title: 'Re-read my whole history', where: inSettings('data'), icon: 'history', href: settingsPage('data'), keywords: ['full re-sync', 'resync', 'import again', 'daytime heart rate', 'steps per hour', 'history length', 'days'] },
  { id: 's-detect-up', title: "Detect when I'm actually up", where: inSettings('data'), icon: 'walk', href: settingsPage('data'), keywords: ['wake detection', 'end the night', 'steps'] },
  { id: 's-source', title: "Which app's sleep to trust", where: inSettings('data'), icon: 'source-branch', href: settingsPage('data'), keywords: ['source', 'duplicate', 'other apps'] },
  { id: 's-backup', title: 'Backup and restore', where: inSettings('data'), icon: 'backup-restore', href: settingsPage('data'), keywords: ['save backup', 'folder', 'share backup', 'export backup', 'restore', 'new phone', 'save data'] },
  { id: 's-demo', title: 'Demo data', where: inSettings('data'), icon: 'flask-outline', href: settingsPage('data'), keywords: ['try', 'sample', 'load demo'] },
  { id: 's-erase', title: 'Erase everything', where: inSettings('data'), icon: 'delete-outline', href: settingsPage('data'), keywords: ['delete', 'reset', 'start over', 'wipe'] },
];

const PAGES: Feature[] = SETTINGS_SECTIONS.map((s) => ({ id: `settings-${s.id}`, title: s.title, where: 'Settings', icon: s.icon, href: settingsPage(s.id), keywords: [s.sub, ...s.keywords] }));

export const FEATURES: Feature[] = [...SCREENS, ...PAGES, ...SETTINGS_ITEMS];

/** Lower-case words without accents or punctuation ("Can't make it?" → ["cant", "make", "it"]). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Features matching every word of the query (prefixes count: "alar" finds alarms), best first. */
export function searchFeatures(query: string, features: Feature[] = FEATURES): Feature[] {
  const q = words(query);
  if (!q.length) return [];
  const scored: { f: Feature; score: number; i: number }[] = [];
  features.forEach((f, i) => {
    const title = words(f.title);
    const rest = [...words(f.where), ...f.keywords.flatMap(words)];
    let score = 0;
    for (const w of q) {
      if (title.some((t) => t === w)) score += 4;
      else if (title.some((t) => t.startsWith(w))) score += 3;
      else if (rest.some((t) => t === w)) score += 2;
      else if (rest.some((t) => t.startsWith(w))) score += 1;
      else return;
    }
    if (words(f.title).join(' ').startsWith(q.join(' '))) score += 3;
    scored.push({ f, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.f);
}
