/**
 * "Find a feature or setting…": a small index of every screen, tool and Settings page, with the
 * words people might use for them and where each one lives. Pure (no React) and unit-tested:
 * src/ui/__tests__/featureIndex.test.ts checks every route file and Settings page is covered.
 */
import type { Href } from 'expo-router';

import { SETTINGS_SECTIONS, SettingsSectionId } from './settings/sections';

export interface Feature {
  id: string;
  title: string;
  /** Where it lives, in plain words: "Planner › Your usual week". */
  where: string;
  icon: string;
  keywords: string[];
  href: Href;
}

const settingsPage = (section: SettingsSectionId): Href => ({ pathname: '/settings/[section]', params: { section } });
const planner = (show?: 'tonight' | 'week' | 'calculator' | 'shift' | 'caffeine' | 'light'): Href => (show ? { pathname: '/planner', params: { show } } : '/planner');
const sleep = (view: 'trends' | 'calendar' | 'nights'): Href => ({ pathname: '/sleep', params: { view } });
const quiz = (id: 'rmeq' | 'ess' | 'isi' | 'stopbang'): Href => ({ pathname: '/quiz/[id]', params: { id } });

const settingsTitle = (id: SettingsSectionId) => SETTINGS_SECTIONS.find((s) => s.id === id)!.title;
const inSettings = (id: SettingsSectionId) => `Settings › ${settingsTitle(id)}`;

const SCREENS: Feature[] = [
  // Tabs
  { id: 'today', title: 'Today', where: 'Tab', icon: 'home-variant-outline', href: '/', keywords: ['home', 'last night', 'score', 'energy', 'countdown', 'morning check-in', 'quick actions'] },
  { id: 'planner', title: 'Planner', where: 'Tab', icon: 'calendar-clock', href: '/planner', keywords: ['plan', 'week', 'bedtime', 'lights out', 'alarm', 'wake-up', 'schedule'] },
  { id: 'nap', title: 'Nap coach', where: 'Tab', icon: 'sleep', href: '/nap', keywords: ['nap', 'power nap', 'nap timer', 'sleepy', 'afternoon'] },
  { id: 'log-nap', title: 'Log a nap you took', where: 'Nap tab, and the "+" check-in', icon: 'sleep', href: '/nap', keywords: ['log nap', 'took a nap', 'unplanned nap', 'add nap', 'napped', 'dozed off'] },
  { id: 'sleep', title: 'Sleep history', where: 'Tab', icon: 'chart-timeline-variant', href: '/sleep', keywords: ['history', 'trends', 'charts', 'nights', 'past'] },
  { id: 'more', title: 'More', where: 'Tab', icon: 'dots-horizontal-circle-outline', href: '/more', keywords: ['tools', 'all features', 'menu'] },

  // Planner
  { id: 'tonight-plan', title: "Tonight's plan", where: 'Planner › Tonight', icon: 'moon-waning-crescent', href: planner('tonight'), keywords: ['tonight', 'bedtime', 'lights out', 'wind down', 'why these times'] },
  { id: 'in-bed', title: "I'm in bed (start the sleep session)", where: 'Today › evening & night', icon: 'bed', href: '/', keywords: ['in bed', 'going to bed', 'sleep session', 'sleep sesh', 'start sleep', 'lights out now', 'bedtime now', "i'm up", 'end session', 'good night', 'save last night', 'up early', 'woke up early', 'awake before alarm', 'up before alarm', 'wake up time', 'woke up earlier', 'change wake time', 'correct wake up'] },
  {
    id: 'plan-options',
    title: 'Options for tonight (and "Still up?")',
    where: 'Planner › Tonight',
    icon: 'source-branch',
    href: planner('tonight'),
    keywords: ['options', 'possibilities', 'alternatives', 'best plan', 'how eepy decided', 'thinking', 'reasoning', 'still up', 're-plan', 'replan', 'skip routine tonight', 'catch up tonight', 'nap tomorrow', 'sleep in a little', 'going to bed late', 'bedtime slipping'],
  },
  { id: 'adjust-tonight', title: 'Adjust tonight', where: 'Planner › Tonight', icon: 'clock-edit-outline', href: '/tonight', keywords: ["can't make it", 'running late', 'later bedtime', 'stay up', 'change tonight', 'late night'] },
  { id: 'plan-morning', title: 'Plan a single morning', where: 'Planner › tap a day', icon: 'calendar-edit', href: '/planner', keywords: ['set a time', 'free day', 'day off', 'no alarm', 'holiday', 'flight', 'appointment', 'early start', 'sleep in'] },
  { id: 'skip-alarm', title: "Skip tomorrow's alarm", where: 'Planner › Tonight', icon: 'alarm-off', href: planner('tonight'), keywords: ['skip alarm', 'day off', 'sleep in', 'turn off alarm', 'no alarm'] },
  { id: 'usual-week', title: 'Workdays & wake-up times', where: 'Planner › Your usual week', icon: 'calendar-week', href: planner('week'), keywords: ['workdays', 'wake time', 'wake-up time', 'wakeup', 'weekend', 'free day wake-up', 'usual week', 'alarm time', 'work schedule'] },
  { id: 'day-wake', title: 'Different wake-up times on different days', where: 'Planner › Your usual week', icon: 'calendar-clock-outline', href: planner('week'), keywords: ['different wake times', 'each day', 'per day', 'tuesday', 'shift', 'varying schedule', 'irregular schedule', 'wake time per day'] },
  { id: 'two-step-morning', title: 'Two-step morning (routine, then back to sleep)', where: 'Planner › Your usual week', icon: 'weather-sunset-up', href: planner('week'), keywords: ['morning routine', 'routine alarm', 'two alarms', 'back to sleep', 'face routine', 'skin care', 'wake up twice', 'second alarm', '5am', 'skip routine', 'routine one day', 'no routine tomorrow', 'skipped my routine', 'did my routine', 'slept through routine'] },
  { id: 'month-view', title: 'Month view (calendar)', where: 'Planner › Month view', icon: 'calendar-month-outline', href: '/calendar', keywords: ['calendar', 'month', 'plan ahead', 'future', 'weeks'] },
  { id: 'recovery', title: 'Getting back on track (sleep debt)', where: 'Planner › Tonight', icon: 'battery-charging-medium', href: planner('tonight'), keywords: ['sleep debt', 'catch up', 'recovery', 'pay back', 'tired'] },
  { id: 'calculator', title: 'Bedtime calculator', where: 'Planner › More planning tools', icon: 'calculator-variant-outline', href: planner('calculator'), keywords: ['when to sleep', 'sleep cycles', 'what time to go to bed', 'wake up at', 'sleep now'] },
  { id: 'shift', title: 'Move your schedule', where: 'Planner › More planning tools', icon: 'arrow-left-right', href: planner('shift'), keywords: ['shift schedule', 'wake earlier', 'wake later', 'new routine', 'light'] },
  { id: 'caffeine-curve', title: 'Caffeine in your system', where: 'Planner › More planning tools', icon: 'coffee-outline', href: planner('caffeine'), keywords: ['caffeine', 'coffee', 'cut-off', 'last coffee', 'mg', 'curve'] },
  { id: 'phone-light', title: 'Phone light', where: 'Planner › More planning tools', icon: 'brightness-6', href: planner('light'), keywords: ['brightness', 'screen', 'night light', 'blue light', 'extra dim', 'too dark', 'cant see', 'dim', 'brighter'] },
  { id: 'simulate', title: 'What if?', where: 'More › Learn', icon: 'tune-variant', href: '/simulate', keywords: ['simulator', 'try', 'tomorrow', 'experiment with bedtime', 'forecast'] },
  { id: 'jetlag', title: 'Jet lag planner', where: 'More › Programmes', icon: 'airplane-clock', href: '/jetlag', keywords: ['travel', 'time zone', 'flight', 'jet lag'] },

  // Sleep
  { id: 'trends', title: 'Trends', where: 'Sleep › Trends', icon: 'chart-line', href: sleep('trends'), keywords: ['charts', 'average', 'sleep debt', 'score', 'regularity', 'chronotype', 'hrv', 'heart rate', 'deep sleep', 'rem', 'breathing', 'oxygen', 'spo2'] },
  { id: 'sleep-calendar', title: 'Sleep calendar', where: 'Sleep › Calendar', icon: 'calendar-month', href: sleep('calendar'), keywords: ['month', 'past nights', 'calendar', 'history'] },
  { id: 'nights', title: 'All nights', where: 'Sleep › Nights', icon: 'format-list-bulleted', href: sleep('nights'), keywords: ['list', 'night details', 'report', 'hypnogram', 'stages'] },
  { id: 'log-sleep', title: 'Log a night yourself', where: 'Sleep › Nights', icon: 'pencil-plus', href: '/log-sleep', keywords: ['manual', 'add sleep', 'forgot watch', 'missing night', 'nap log', 'sleep time', 'adjust sleep time', 'adjust wake time', 'fell asleep'] },

  // More: coach & learn
  { id: 'coach', title: 'Coach', where: 'More › Coach', icon: 'account-heart-outline', href: '/coach', keywords: ['coach', 'advice', 'tips', 'suggestions'] },
  { id: 'experiments', title: 'Experiments', where: 'More › Coach', icon: 'flask-outline', href: '/experiments', keywords: ['test', 'try something', 'before after', 'experiment'] },
  { id: 'goals', title: 'Goals & streaks', where: 'More › Coach', icon: 'flag-checkered', href: '/goals', keywords: ['goals', 'streak', 'habits'] },
  { id: 'review', title: 'Weekly review', where: 'More › Coach', icon: 'calendar-week', href: '/review', keywords: ['week', 'summary', 'report', 'review'] },
  { id: 'learning', title: 'Your body clock', where: 'More › Learn', icon: 'clock-time-four-outline', href: '/learning', keywords: ['circadian', 'rhythm', 'energy forecast', 'check-ins', 'learning', 'chronotype'] },
  { id: 'need', title: 'Your sleep need', where: 'More › Learn', icon: 'battery-charging-high', href: '/need', keywords: ['how much sleep', 'hours', 'need', 'estimate'] },
  { id: 'quiz-rmeq', title: 'Chronotype quiz', where: 'More › Self-checks', icon: 'owl', href: quiz('rmeq'), keywords: ['morning person', 'night owl', 'lark', 'quiz', 'self-check'] },
  { id: 'quiz-ess', title: 'Daytime sleepiness check', where: 'More › Self-checks', icon: 'sleep', href: quiz('ess'), keywords: ['sleepy', 'epworth', 'doze', 'quiz', 'self-check'] },
  { id: 'quiz-isi', title: 'Insomnia check', where: 'More › Self-checks', icon: 'eye-outline', href: quiz('isi'), keywords: ["can't sleep", 'insomnia', 'quiz', 'self-check'] },
  { id: 'quiz-stopbang', title: 'Sleep apnoea risk', where: 'More › Self-checks', icon: 'lungs', href: quiz('stopbang'), keywords: ['snoring', 'apnea', 'breathing', 'stop-bang', 'quiz', 'self-check'] },

  // More: wind-down & programmes
  { id: 'winddown', title: 'Wind-down routine', where: 'More › Wind-down', icon: 'weather-night', href: '/winddown', keywords: ['breathing', 'relax', 'sounds', 'white noise', "can't sleep", 'checklist', 'calm'] },
  {
    id: 'rundown',
    title: 'Bedtime rundown (step by step)',
    where: 'Today › evening · More › Wind-down',
    icon: 'format-list-checks',
    href: '/rundown',
    keywords: ['bedtime routine', 'rundown', 'phone down', 'reading', 'e-book', 'kindle', 'shower', 'to-do list', 'checklist', 'start my rundown', 'guided', 'step by step', 'teeth', 'skin care', 'evening routine', 'night routine'],
  },
  { id: 'sleep-sounds', title: 'Sleep sounds & timer', where: inSettings('winddown'), icon: 'music-note-outline', href: settingsPage('winddown'), keywords: ['white noise', 'brown noise', 'pink noise', 'rain', 'volume', 'sleep timer'] },
  { id: 'autopilot', title: 'Bedtime autopilot (phone sleep mode)', where: inSettings('winddown'), icon: 'moon-waning-crescent', href: settingsPage('winddown'), keywords: ['sleep mode', 'do not disturb', 'dnd', 'grayscale', 'modes', 'silence'] },
  { id: 'cbti', title: 'Insomnia programme', where: 'More › Programmes', icon: 'account-heart', href: '/cbti', keywords: ['cbt-i', 'insomnia', 'sleep restriction', '6 weeks', 'programme', 'program'] },

  // More: your data
  { id: 'journal', title: 'Journal', where: 'More › Your data', icon: 'notebook-outline', href: '/journal', keywords: ['tags', 'diary', 'ratings', 'alcohol', 'notes', 'log day'] },
  { id: 'checkin', title: 'Quick check-in', where: 'Today › Check in', icon: 'emoticon-happy-outline', href: '/checkin', keywords: ['how do you feel', 'sleepiness', 'energy', 'log', 'tag', 'plus button'] },
  { id: 'log-drink', title: 'Log a drink', where: 'Today › Log coffee', icon: 'coffee', href: '/caffeine', keywords: ['coffee', 'tea', 'caffeine', 'espresso', 'energy drink', 'add drink'] },
  { id: 'export', title: 'Reports & export', where: 'More › Your data', icon: 'file-chart-outline', href: '/export', keywords: ['pdf', 'doctor', 'csv', 'share', 'print', 'report'] },
  { id: 'connect', title: 'Connect your CMF Watch', where: 'More › Your data', icon: 'link-variant', href: '/connect', keywords: ['health connect', 'pair', 'nothing x', 'permissions', 'setup', 'watch'] },
  { id: 'updates-screen', title: 'App updates', where: 'More › App', icon: 'cellphone-arrow-down', href: '/updates', keywords: ['update', 'new version', 'install'] },
  { id: 'whats-new', title: "What's new", where: 'More › App', icon: 'gift-outline', href: '/whats-new', keywords: ['new', 'moved', 'where is', 'changes', 'tabs', 'help'] },
  { id: 'settings', title: 'Settings', where: 'More › App', icon: 'cog-outline', href: '/settings', keywords: ['preferences', 'options', 'configure'] },
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
  { id: 's-reminders', title: 'Reminders', where: inSettings('notifications'), icon: 'bell-ring-outline', href: settingsPage('notifications'), keywords: ['wind-down reminder', 'bedtime reminder', 'caffeine cut-off', 'screens off', 'morning check-in', 'forgot coffee'] },
  { id: 's-background', title: 'Background sync & morning report', where: inSettings('notifications'), icon: 'sync', href: settingsPage('notifications'), keywords: ['while closed', 'morning report', 'missing night'] },
  { id: 's-pings', title: 'Alertness check-in pings', where: inSettings('notifications'), icon: 'brain', href: settingsPage('notifications'), keywords: ['pings', 'how alert', 'natural wake', 'reset learned rhythm'] },
  { id: 's-shortcuts', title: 'Shortcuts & Quick Settings tile', where: inSettings('notifications'), icon: 'gesture-tap-hold', href: settingsPage('notifications'), keywords: ['app icon', 'long-press', 'log coffee tile', 'home screen'] },
  { id: 's-winddown-length', title: 'Wind-down length', where: inSettings('winddown'), icon: 'timer-sand', href: settingsPage('winddown'), keywords: ['how long', 'minutes before bed', 'routine'] },
  { id: 's-screens-off', title: 'Screens off before lights-out', where: inSettings('winddown'), icon: 'cellphone-off', href: settingsPage('winddown'), keywords: ['phone away', 'screen time'] },
  {
    id: 's-rundown',
    title: 'Your bedtime rundown (customize)',
    where: inSettings('winddown'),
    icon: 'tune-variant',
    href: settingsPage('winddown'),
    keywords: ['bedtime routine', 'rundown', 'phone down', 'reading time', 'e-book', 'kindle', 'shower', 'to-do list', 'checklist', 'reorder', 'add a step', 'custom step', 'last drink', 'alcohol'],
  },
  { id: 's-e-reader', title: 'E-ink reader (Kindle, Kobo, Boox)', where: inSettings('winddown'), icon: 'book-open-variant', href: settingsPage('winddown'), keywords: ['e-reader', 'ereader', 'e-ink', 'eink', 'kindle', 'kobo', 'boox', 'reading', 'read in bed', 'book', 'frontlight', 'front light', 'warm light', 'amber'] },
  { id: 's-dim-eepy', title: 'Dim & warm eepy in the evening', where: inSettings('winddown'), icon: 'brightness-4', href: settingsPage('winddown'), keywords: ['tint', 'dim', 'warm', 'night'] },
  { id: 's-half-life', title: 'Caffeine half-life', where: inSettings('caffeine'), icon: 'coffee-outline', href: settingsPage('caffeine'), keywords: ['how fast', 'wears off', 'sensitive'] },
  { id: 's-drinks', title: 'Your own drinks', where: inSettings('caffeine'), icon: 'star-outline', href: settingsPage('caffeine'), keywords: ['custom', 'instant coffee', 'mg'] },
  { id: 's-sync', title: 'Sync now', where: inSettings('data'), icon: 'sync', href: settingsPage('data'), keywords: ['health connect', 'refresh', 'full re-sync', 'auto sync'] },
  { id: 's-detect-up', title: "Detect when I'm actually up", where: inSettings('data'), icon: 'walk', href: settingsPage('data'), keywords: ['wake detection', 'end the night', 'steps'] },
  { id: 's-source', title: "Which app's sleep to trust", where: inSettings('data'), icon: 'source-branch', href: settingsPage('data'), keywords: ['source', 'duplicate', 'other apps'] },
  { id: 's-backup', title: 'Backup & restore', where: inSettings('data'), icon: 'export', href: settingsPage('data'), keywords: ['export backup', 'restore', 'new phone', 'save data'] },
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
