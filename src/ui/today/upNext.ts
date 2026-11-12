/** Today's plan as a short "what's next" list for the Timeline on Today. */
import type { Href } from 'expo-router';

import type { Analysis } from '@/engine/analysis';
import type { PlanKind } from '@/engine/coach';
import { formatTime } from '@/engine/time';
import type { TimelineItem } from '@/ui/components';

/** Where tapping a step leads (steps without an entry are information only). */
const HREF: Partial<Record<PlanKind, Href>> = {
  focus: '/energy',
  dip: '/energy',
  nap: '/nap',
  caffeine: '/caffeine',
  winddown: '/winddown',
  bed: '/tonight',
  alarm: '/planner',
};

export interface UpNextItem extends Omit<TimelineItem, 'onPress'> {
  kind: PlanKind;
  href?: Href;
}

/**
 * The steps still ahead today (and the one happening now), earliest first: at most `max`, always
 * ending with lights-out and the alarm when they are still to come.
 */
export function upNext(a: Pick<Analysis, 'plan'>, now: number, max = 6): UpNextItem[] {
  const ahead = a.plan
    .filter((p) => p.kind !== 'wake' && (p.end ?? p.time) >= now)
    .sort((x, y) => x.time - y.time);
  // Keep the night's fixed points when the list has to be cut.
  const fixed = ahead.filter((p) => p.kind === 'bed' || p.kind === 'alarm');
  const rest = ahead.filter((p) => p.kind !== 'bed' && p.kind !== 'alarm');
  const shown = [...rest.slice(0, Math.max(0, max - fixed.length)), ...fixed].sort((x, y) => x.time - y.time);
  let nextSeen = false;
  return shown.map((p) => {
    const running = p.time <= now && (p.end ?? p.time) >= now;
    let state: TimelineItem['state'] = 'later';
    if (running) state = 'now';
    else if (!nextSeen) {
      state = 'next';
      nextSeen = true;
    }
    return {
      key: p.id,
      kind: p.kind,
      time: formatTime(p.time),
      title: p.title.replace(/ \(end of a sleep cycle\)$/, ''),
      sub: p.end ? `until ${formatTime(p.end)}` : undefined,
      state,
      href: HREF[p.kind],
    };
  });
}
