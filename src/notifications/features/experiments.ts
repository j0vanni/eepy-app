/**
 * Daily experiment nudges (`settings.notifications.experimentNudges`):
 * - a reminder of the active experiment's rule at the moment it matters ("No caffeine after 14:00 today");
 * - when adherence can't be inferred from data, a morning Yes/No question about the day before.
 */
import { router } from 'expo-router';

import {
  activeExperiment,
  adherenceFor,
  experimentData,
  experimentQuestion,
  needsQuestion,
  reminderFor,
  templateFor,
} from '../../engine/experiments';
import { addDays, DAY, daysBetween, MINUTE } from '../../engine/time';
import { selectDataset, useStore } from '../../state/store';
import type { NotificationFeature, PlannedNotification } from '../types';

const CATEGORY = 'experiment-adherence';

export const experiments: NotificationFeature = {
  id: 'experiments',
  categories: [
    {
      id: CATEGORY,
      actions: [
        { id: 'yes', title: 'Yes 👍', opensApp: false },
        { id: 'no', title: 'Not this time', opensApp: false },
      ],
    },
  ],
  plan({ analysis: a, state, now }) {
    if (!state.settings.notifications.experimentNudges) return [];
    const exp = activeExperiment(state.experiments);
    const t = exp ? templateFor(exp) : undefined;
    if (!exp || !t) return [];
    const lastDay = addDays(exp.startDate, exp.durationDays - 1);
    const d = experimentData(a, selectDataset(state));
    const out: PlannedNotification[] = [];

    // Rule reminders for today and tomorrow (the scheduler keeps whatever falls in its horizon).
    for (let k = 0; k <= 1; k++) {
      const date = addDays(a.day, k);
      if (date < exp.startDate || date > lastDay) continue;
      const r = reminderFor(exp, date, { bedtime: a.tonight.bedtime + k * DAY, wake: k === 0 ? a.wakeTime : a.tonight.wake });
      if (!r || r.at <= now) continue;
      // Already broken today (e.g. a late coffee was logged) — no point nagging.
      if (k === 0 && adherenceFor(exp, date, d).value === false) continue;
      out.push({
        id: `rule-${date}`,
        at: r.at,
        channel: 'reminders',
        title: `🧪 ${exp.title} · day ${daysBetween(exp.startDate, date) + 1} of ${exp.durationDays}`,
        body: r.text,
        data: { experimentId: exp.id, kind: 'rule' },
      });
    }

    // Morning questions: yesterday's (asked this morning) and today's (asked tomorrow morning).
    const ask = (date: string, at: number) => {
      if (date < exp.startDate || date > lastDay || at <= now) return;
      // Data-driven rules usually answer themselves; only ask when it's self-report or still unknown.
      if (!t.askByDefault && date === a.day) return;
      if (exp.adherence[date] !== undefined) return;
      if (date < a.day && !needsQuestion(exp, date, d)) return;
      out.push({
        id: `ask-${date}`,
        at,
        channel: 'reminders',
        categoryId: CATEGORY,
        title: `🧪 ${exp.title}`,
        body: experimentQuestion(exp),
        data: { experimentId: exp.id, date, kind: 'ask' },
      });
    };
    ask(addDays(a.day, -1), a.wakeTime + 40 * MINUTE);
    ask(a.day, a.tonight.wake + 40 * MINUTE);
    return out;
  },
  onResponse(response, state) {
    const id = typeof response.data.experimentId === 'string' ? response.data.experimentId : undefined;
    const date = typeof response.data.date === 'string' ? response.data.date : undefined;
    if (!id) return;
    if ((response.actionId === 'yes' || response.actionId === 'no') && date) {
      // Read fresh state: the app may have been in the background for hours.
      const cur = useStore.getState().experiments.find((e) => e.id === id) ?? state.experiments.find((e) => e.id === id);
      if (!cur) return;
      useStore.getState().upsertExperiment({ ...cur, adherence: { ...cur.adherence, [date]: response.actionId === 'yes' } });
      return;
    }
    try {
      router.push({ pathname: '/experiments/[id]', params: { id } });
    } catch (e) {
      console.warn('experiments: navigation failed', e);
    }
  },
};
