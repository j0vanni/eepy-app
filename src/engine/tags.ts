/** Journal tags: things done on a day that may affect that night's sleep. */
export interface TagDef {
  id: string;
  label: string;
  icon: string;
  /** Phrase used in insights: "After {phrase}, …" */
  phrase: string;
}

export const TAGS: TagDef[] = [
  { id: 'alcohol', label: 'Alcohol', icon: 'glass-wine', phrase: 'drinking alcohol' },
  { id: 'late-caffeine', label: 'Late caffeine', icon: 'coffee', phrase: 'late caffeine' },
  { id: 'late-meal', label: 'Late meal', icon: 'food', phrase: 'a late meal' },
  { id: 'exercise', label: 'Exercise', icon: 'run', phrase: 'exercising' },
  { id: 'late-exercise', label: 'Late workout', icon: 'weight-lifter', phrase: 'a late workout' },
  { id: 'screens', label: 'Screens in bed', icon: 'cellphone', phrase: 'screens in bed' },
  { id: 'stress', label: 'Stressful day', icon: 'head-flash', phrase: 'a stressful day' },
  { id: 'wind-down', label: 'Wind-down routine', icon: 'weather-night', phrase: 'a wind-down routine' },
  { id: 'reading', label: 'Read before bed', icon: 'book-open-variant', phrase: 'reading before bed' },
  { id: 'meditation', label: 'Meditation', icon: 'meditation', phrase: 'meditating' },
  { id: 'hot-shower', label: 'Warm shower/bath', icon: 'shower', phrase: 'a warm shower or bath' },
  { id: 'outdoor-light', label: 'Morning sunlight', icon: 'white-balance-sunny', phrase: 'getting morning sunlight' },
  { id: 'nap', label: 'Napped', icon: 'sleep', phrase: 'napping' },
  { id: 'melatonin', label: 'Melatonin', icon: 'pill', phrase: 'taking melatonin' },
  { id: 'cannabis', label: 'Cannabis', icon: 'cannabis', phrase: 'cannabis' },
  { id: 'nicotine', label: 'Nicotine', icon: 'smoking', phrase: 'nicotine' },
  { id: 'sick', label: 'Sick', icon: 'emoticon-sick-outline', phrase: 'being sick' },
  { id: 'travel', label: 'Travel', icon: 'airplane', phrase: 'travelling' },
  { id: 'warm-room', label: 'Warm bedroom', icon: 'thermometer-high', phrase: 'a warm bedroom' },
  { id: 'noise', label: 'Noise', icon: 'volume-high', phrase: 'a noisy night' },
  { id: 'shared-bed', label: 'Shared bed', icon: 'account-multiple', phrase: 'sharing the bed' },
];

export const TAG_BY_ID: Record<string, TagDef> = Object.fromEntries(TAGS.map((t) => [t.id, t]));
