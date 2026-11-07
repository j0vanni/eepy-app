/** "Took a nap? Log it" (state/napLog.ts) against the real store. */
jest.mock('expo-notifications', () => ({}));

import { analyze } from '../../engine/analysis';
import { computeSessionMetrics } from '../../engine/sessions';
import { atMinutes, MINUTE } from '../../engine/time';
import { clampNapStart, logNap, napSession, napsOn, removeNap } from '../napLog';
import { selectDataset, useStore } from '../store';

const DAY = '2026-11-06';
const at = (h: number) => atMinutes(DAY, Math.round(h * 60));

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  useStore.getState().loadDemo(at(17));
});

describe('logging a nap you took', () => {
  it('is a nap session with a few minutes to fall asleep', () => {
    const s = napSession(at(14), 30);
    expect(s).toMatchObject({ source: 'manual', kind: 'nap', start: at(14), end: at(14.5) });
    expect(s.stages?.[0]).toEqual({ stage: 'awake', start: at(14), end: at(14) + 5 * MINUTE });
    expect(computeSessionMetrics(s)!.isNap).toBe(true);
    // A very short one: no time to fall asleep assumed.
    expect(napSession(at(14), 10).stages).toHaveLength(1);
  });

  it("can't end in the future or start more than a day back", () => {
    const now = at(15);
    expect(clampNapStart(at(14.75), 30, now)).toBe(at(14.5));
    expect(clampNapStart(at(-30), 30, now)).toBe(now - 24 * 3600_000);
  });

  it('shows in today\'s naps and in the analysis; Remove takes it out', () => {
    const now = at(17);
    const id = logNap(at(14), 25, now);
    const naps = napsOn(useStore.getState().sessions, DAY);
    expect(naps.find((n) => n.id === id)).toMatchObject({ start: at(14), minutes: 25, manual: true });
    const a = analyze(selectDataset(useStore.getState()), now);
    expect(a.metrics.some((m) => m.session.id === id && m.isNap)).toBe(true);
    removeNap(id);
    expect(napsOn(useStore.getState().sessions, DAY).find((n) => n.id === id)).toBeUndefined();
  });
});
