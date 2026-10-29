/**
 * Sunday weekly-review notification (`settings.notifications.weeklyReview`):
 * "Your week in sleep is ready" at ~19:00 local on Sunday, opening /review.
 */
import { router } from 'expo-router';

import { selectDataset } from '../../state/store';
import { addDays, atMinutes, formatDuration, weekdayOfKey } from '../../engine/time';
import { buildWeeklyReview, weekStartOf } from '../../engine/weeklyReview';
import type { NotificationFeature } from '../types';

const REVIEW_HOUR_MIN = 19 * 60;

export const weeklyReview: NotificationFeature = {
  id: 'weeklyReview',
  plan({ analysis: a, state }) {
    if (!state.settings.notifications.weeklyReview) return [];
    // The coming Sunday (today if it's Sunday); the scheduler drops it if it's beyond its horizon.
    const sunday = addDays(a.day, (7 - weekdayOfKey(a.day)) % 7);
    const ws = weekStartOf(sunday);
    const recorded = a.nights.filter((n) => n.main && n.wakeDate >= ws && n.wakeDate <= sunday).length;
    if (recorded < 3) return [];
    const review = buildWeeklyReview({ analysis: a, data: selectDataset(state), goals: state.goals, experiments: state.experiments, weekStart: ws });
    const bits = [
      review.avgSleepMin !== undefined ? `You averaged ${formatDuration(review.avgSleepMin)} (need ${formatDuration(review.needMin)})` : undefined,
      review.avgScore !== undefined ? `score ${Math.round(review.avgScore)}` : undefined,
    ].filter(Boolean);
    return [
      {
        id: `review-${ws}`,
        at: atMinutes(sunday, REVIEW_HOUR_MIN),
        channel: 'reports',
        title: 'Your week in sleep is ready 📊',
        body: `${bits.length ? `${bits.join(' · ')}. ` : ''}Best night, what changed and one thing to try next week.`,
        data: { week: ws },
      },
    ];
  },
  onResponse(response) {
    const week = typeof response.data.week === 'string' ? response.data.week : undefined;
    try {
      router.push(week ? { pathname: '/review', params: { week } } : '/review');
    } catch (e) {
      console.warn('weekly review: navigation failed', e);
    }
  },
};
