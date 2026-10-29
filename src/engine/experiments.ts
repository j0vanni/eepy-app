/**
 * Personal experiments ("no caffeine after 14:00 for 7 nights"): templates, adherence tracking
 * and a before/after comparison using the insight statistics.
 *
 * OWNER: coach workstream. Stub types only until implemented.
 */
export interface Experiment {
  id: string;
  templateId: string;
  title: string;
  /** First date (YYYY-MM-DD) of the experiment period. */
  startDate: string;
  durationDays: number;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  /** Manual adherence answers per date, when it can't be inferred from data. */
  adherence: Record<string, boolean>;
}
