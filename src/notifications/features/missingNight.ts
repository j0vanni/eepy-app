/**
 * Mid-morning nudge to open Nothing X when last night hasn't synced (`missingNightNudge`).
 * OWNER: background & notifications workstream. Stub — plans nothing until implemented.
 */
import type { NotificationFeature } from '../types';

export const missingNight: NotificationFeature = {
  id: 'missingNight',
  plan() {
    return [];
  },
};
