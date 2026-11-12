/**
 * The "Find a feature or setting…" index must cover every screen and every Settings page, and
 * every entry must point at a route that exists — so moving a screen can't silently break search.
 */
import { FEATURES, searchFeatures, words } from '../featureIndex';
import { SETTINGS_SECTIONS } from '../settings/sections';

// Node built-ins, typed locally: the app's tsconfig deliberately has no Node globals.
declare const __dirname: string;
type Dirent = { name: string; isDirectory(): boolean };
const fs: { readdirSync(p: string, o: { withFileTypes: true }): Dirent[] } = require('fs');
const path: { join(...parts: string[]): string } = require('path');

const APP = path.join(__dirname, '../../app');

/** Every route file as its URL path ("/settings/[section]"), with groups like (tabs) removed. */
function routeFiles(dir = APP, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return routeFiles(path.join(dir, e.name), /^\(.*\)$/.test(e.name) ? prefix : `${prefix}/${e.name}`);
    if (!/\.tsx?$/.test(e.name) || e.name.startsWith('_')) return [];
    const name = e.name.replace(/\.tsx?$/, '');
    return [name === 'index' ? prefix || '/' : `${prefix}/${name}`];
  });
}

const pathnameOf = (href: (typeof FEATURES)[number]['href']) => (typeof href === 'string' ? href.split('?')[0] : href.pathname);

/** Routes reached only from a specific record (a night, an experiment), redirects, and first-run screens. */
const NOT_SEARCHABLE = new Set(['/night/[id]', '/experiments/[id]', '/quick/[action]', '/onboarding', '/plan', '/trends', '/learning']);

/** What the Plan and Sleep tabs understand in their `show` / `view` params. */
const PLAN_SHOW = ['tonight', 'week', 'calculator', 'shift', 'caffeine', 'light'];
const SLEEP_VIEW = ['nights', 'trends'];

describe('feature index', () => {
  const routes = routeFiles();
  const covered = new Set(FEATURES.map((f) => pathnameOf(f.href)));

  it('has every screen', () => {
    const missing = routes.filter((r) => !NOT_SEARCHABLE.has(r) && !covered.has(r));
    expect(missing).toEqual([]);
  });

  it('points only at routes that exist', () => {
    const known = new Set(routes);
    const broken = FEATURES.filter((f) => !known.has(pathnameOf(f.href))).map((f) => f.id);
    expect(broken).toEqual([]);
  });

  it('has every Settings page', () => {
    const pages = new Set(FEATURES.flatMap((f) => (typeof f.href === 'object' && f.href.pathname === '/settings/[section]' ? [String(f.href.params?.section)] : [])));
    expect(SETTINGS_SECTIONS.map((s) => s.id).filter((id) => !pages.has(id))).toEqual([]);
  });

  it('has unique ids', () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
  });

  it('keeps the old redirects in place', () => {
    expect(routes).toEqual(expect.arrayContaining(['/plan', '/trends', '/learning', '/coach', '/calendar', '/settings', '/settings/[section]']));
  });

  it('matches the four tabs: Today, Sleep, Plan, More', () => {
    const tabs = FEATURES.filter((f) => f.where === 'Tab');
    expect(tabs.map((f) => [f.title, f.href])).toEqual([
      ['Today', '/'],
      ['Sleep', '/sleep'],
      ['Plan', '/planner'],
      ['More', '/more'],
    ]);
    // Nap is a screen of its own now, Energy replaced the body-clock screen, and nothing lives in a "Planner".
    expect(FEATURES.find((f) => f.id === 'nap')).toMatchObject({ href: '/nap', where: expect.stringContaining('More › Energy') });
    expect(FEATURES.some((f) => pathnameOf(f.href) === '/learning')).toBe(false);
    expect(FEATURES.filter((f) => /planner|nap tab/i.test(f.where)).map((f) => f.id)).toEqual([]);
  });

  it('only asks the Plan and Sleep tabs for parts they have', () => {
    const params = (f: (typeof FEATURES)[number]) => (typeof f.href === 'object' ? ((f.href.params ?? {}) as Record<string, unknown>) : {});
    const badPlan = FEATURES.filter((f) => pathnameOf(f.href) === '/planner' && params(f).show !== undefined && !PLAN_SHOW.includes(String(params(f).show)));
    const badSleep = FEATURES.filter((f) => pathnameOf(f.href) === '/sleep' && params(f).view !== undefined && !SLEEP_VIEW.includes(String(params(f).view)));
    expect([...badPlan, ...badSleep].map((f) => f.id)).toEqual([]);
    // The planning tools are folded rows under Plan › Tools.
    for (const id of ['calculator', 'shift', 'caffeine-curve', 'phone-light']) expect(FEATURES.find((f) => f.id === id)?.where).toBe('Plan › Tools');
  });
});

describe('searchFeatures', () => {
  const ids = (q: string) => searchFeatures(q).map((f) => f.id);

  it('finds things by the words people use', () => {
    expect(ids('wake time')[0]).toBe('usual-week');
    expect(ids('workdays')[0]).toBe('usual-week');
    expect(ids("can't make it")[0]).toBe('adjust-tonight');
    expect(ids('alarm')).toEqual(expect.arrayContaining(['s-wake-alarm', 'skip-alarm', 'settings-alarms']));
    expect(ids('coffee')).toEqual(expect.arrayContaining(['log-drink', 'caffeine-curve', 'settings-caffeine']));
    expect(ids('backup')).toContain('s-backup');
    expect(ids('do not disturb')).toContain('autopilot');
    expect(ids('kindle')[0]).toBe('s-e-reader');
    expect(ids('e-ink')[0]).toBe('s-e-reader');
    expect(ids('kobo')).toContain('s-e-reader');
    expect(ids('frontlight')).toContain('s-e-reader');
  });

  it('finds the new screens and settings', () => {
    expect(ids('energy')[0]).toBe('energy');
    expect(ids('body clock')).toContain('energy');
    expect(ids('reaction')[0]).toBe('reaction');
    expect(ids('nap')[0]).toBe('nap');
    expect(ids('re-read')[0]).toBe('s-reread');
    expect(ids('full re-sync')).toContain('s-reread');
    expect(ids('save backup')).toContain('s-backup');
    expect(ids('reset learned')).toContain('s-reset-learning');
    expect(ids('check-in reminders')[0]).toBe('s-pings');
  });

  it('matches word starts, plurals and any letter case', () => {
    expect(ids('ALAR')).toContain('s-wake-alarm');
    expect(ids('alarms')).toContain('s-wake-alarm');
    expect(ids('journ')[0]).toBe('journal');
  });

  it('needs every word to match, and ignores empty queries', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('alarm xyzzy')).toEqual([]);
  });

  it('puts title matches first', () => {
    expect(ids('jet lag')[0]).toBe('jetlag');
    expect(ids('settings')[0]).toBe('settings');
  });

  it('normalises words', () => {
    expect(words("Can't make it?")).toEqual(['cant', 'make', 'it']);
    expect(words('Less, Drinks, gas')).toEqual(['less', 'drink', 'gas']);
  });
});
