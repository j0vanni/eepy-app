import type { NotificationFeature } from '../types';
import { appUpdates } from './appUpdates';
import { caffeineNudge } from './caffeineNudge';
import { experiments } from './experiments';
import { liveWindDown } from './liveWindDown';
import { missingNight } from './missingNight';
import { morningReport } from './morningReport';
import { naturalWake } from './naturalWake';
import { pings } from './pings';
import { reminders } from './reminders';
import { screenLight } from './screenLight';
import { screensOff } from './screensOff';
import { weeklyReview } from './weeklyReview';

/** Every notification feature. The scheduler plans, de-duplicates and routes responses for these. */
export const FEATURES: NotificationFeature[] = [reminders, morningReport, missingNight, liveWindDown, pings, naturalWake, weeklyReview, experiments, caffeineNudge, appUpdates, screenLight, screensOff];
