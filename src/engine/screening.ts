/**
 * Self-screening questionnaires. Items are paraphrased adaptations of published instruments
 * (the official versions are copyrighted); results are educational, not a diagnosis.
 */

export interface QuizOption {
  label: string;
  value: number;
}

export interface QuizQuestion {
  text: string;
  options: QuizOption[];
}

export interface QuizBand {
  min: number;
  max: number;
  label: string;
  detail: string;
  level: 'good' | 'info' | 'warn' | 'alert';
}

export interface Quiz {
  id: 'rmeq' | 'ess' | 'isi' | 'stopbang';
  title: string;
  subtitle: string;
  intro: string;
  source: string;
  questions: QuizQuestion[];
  bands: QuizBand[];
}

const dozing: QuizOption[] = [
  { label: 'Would never doze', value: 0 },
  { label: 'Slight chance', value: 1 },
  { label: 'Moderate chance', value: 2 },
  { label: 'High chance', value: 3 },
];

const severity: QuizOption[] = [
  { label: 'None', value: 0 },
  { label: 'Mild', value: 1 },
  { label: 'Moderate', value: 2 },
  { label: 'Severe', value: 3 },
  { label: 'Very severe', value: 4 },
];

const yesNo: QuizOption[] = [
  { label: 'No', value: 0 },
  { label: 'Yes', value: 1 },
];

export const QUIZZES: Record<Quiz['id'], Quiz> = {
  rmeq: {
    id: 'rmeq',
    title: 'Chronotype quiz',
    subtitle: 'Are you a morning or evening person?',
    intro: 'Five questions about when you naturally feel your best. Answer for how you would live if you had no schedule.',
    source: 'Adapted from the reduced Morningness–Eveningness Questionnaire (Adan & Almirall, 1991).',
    questions: [
      {
        text: 'If you were entirely free to plan your day, what time would you get up?',
        options: [
          { label: '5:00–6:30', value: 5 },
          { label: '6:30–7:45', value: 4 },
          { label: '7:45–9:45', value: 3 },
          { label: '9:45–11:00', value: 2 },
          { label: '11:00–12:00', value: 1 },
        ],
      },
      {
        text: 'During the first half hour after waking, how tired do you usually feel?',
        options: [
          { label: 'Very tired', value: 1 },
          { label: 'Fairly tired', value: 2 },
          { label: 'Fairly refreshed', value: 3 },
          { label: 'Very refreshed', value: 4 },
        ],
      },
      {
        text: 'At what time in the evening do you feel tired and in need of sleep?',
        options: [
          { label: '20:00–21:00', value: 5 },
          { label: '21:00–22:15', value: 4 },
          { label: '22:15–00:45', value: 3 },
          { label: '00:45–02:00', value: 2 },
          { label: '02:00–03:00', value: 1 },
        ],
      },
      {
        text: 'At what time of day do you feel at your best?',
        options: [
          { label: '5:00–8:00', value: 5 },
          { label: '8:00–10:00', value: 4 },
          { label: '10:00–17:00', value: 3 },
          { label: '17:00–22:00', value: 2 },
          { label: '22:00–5:00', value: 1 },
        ],
      },
      {
        text: 'Which type do you consider yourself?',
        options: [
          { label: 'Definitely a morning type', value: 6 },
          { label: 'More morning than evening', value: 4 },
          { label: 'More evening than morning', value: 2 },
          { label: 'Definitely an evening type', value: 0 },
        ],
      },
    ],
    bands: [
      { min: 22, max: 25, label: 'Definite morning type', detail: 'You are a strong lark.', level: 'info' },
      { min: 18, max: 21, label: 'Moderate morning type', detail: 'You lean toward mornings.', level: 'info' },
      { min: 12, max: 17, label: 'Neither type', detail: 'You sit in the middle of the population.', level: 'info' },
      { min: 8, max: 11, label: 'Moderate evening type', detail: 'You lean toward evenings.', level: 'info' },
      { min: 4, max: 7, label: 'Definite evening type', detail: 'You are a strong night owl.', level: 'info' },
    ],
  },
  ess: {
    id: 'ess',
    title: 'Daytime sleepiness',
    subtitle: 'How likely are you to doze off?',
    intro: 'How likely are you to doze off (not just feel tired) in these situations, thinking of your usual way of life recently?',
    source: 'Adapted from the Epworth Sleepiness Scale (Johns, 1991).',
    questions: [
      { text: 'Sitting and reading', options: dozing },
      { text: 'Watching TV', options: dozing },
      { text: 'Sitting inactive in a public place (a meeting, a theatre)', options: dozing },
      { text: 'As a passenger in a car for an hour without a break', options: dozing },
      { text: 'Lying down to rest in the afternoon when you can', options: dozing },
      { text: 'Sitting and talking to someone', options: dozing },
      { text: 'Sitting quietly after a lunch without alcohol', options: dozing },
      { text: 'In a car, while stopped for a few minutes in traffic', options: dozing },
    ],
    bands: [
      { min: 0, max: 10, label: 'Normal', detail: 'Your daytime sleepiness is in the normal range.', level: 'good' },
      { min: 11, max: 12, label: 'Mild excessive sleepiness', detail: 'Mildly elevated — often fixed by more consistent, longer sleep.', level: 'warn' },
      { min: 13, max: 15, label: 'Moderate excessive sleepiness', detail: 'Consider discussing with a doctor, especially if it persists with enough sleep.', level: 'alert' },
      {
        min: 16,
        max: 24,
        label: 'Severe excessive sleepiness',
        detail: 'Please talk to a doctor. Severe sleepiness can signal sleep apnoea, narcolepsy or other conditions — and is dangerous when driving.',
        level: 'alert',
      },
    ],
  },
  isi: {
    id: 'isi',
    title: 'Insomnia check',
    subtitle: 'How much are sleep problems affecting you?',
    intro: 'Rate your sleep over the last two weeks.',
    source: 'Adapted from the Insomnia Severity Index (Morin, 1993).',
    questions: [
      { text: 'Difficulty falling asleep', options: severity },
      { text: 'Difficulty staying asleep', options: severity },
      { text: 'Waking up too early', options: severity },
      {
        text: 'How satisfied are you with your current sleep?',
        options: [
          { label: 'Very satisfied', value: 0 },
          { label: 'Satisfied', value: 1 },
          { label: 'Neutral', value: 2 },
          { label: 'Dissatisfied', value: 3 },
          { label: 'Very dissatisfied', value: 4 },
        ],
      },
      {
        text: 'How noticeable to others is the impact on your life?',
        options: [
          { label: 'Not at all', value: 0 },
          { label: 'A little', value: 1 },
          { label: 'Somewhat', value: 2 },
          { label: 'Much', value: 3 },
          { label: 'Very much', value: 4 },
        ],
      },
      {
        text: 'How worried or distressed are you about your sleep?',
        options: [
          { label: 'Not at all', value: 0 },
          { label: 'A little', value: 1 },
          { label: 'Somewhat', value: 2 },
          { label: 'Much', value: 3 },
          { label: 'Very much', value: 4 },
        ],
      },
      {
        text: 'How much does your sleep problem interfere with daily functioning (energy, mood, concentration)?',
        options: [
          { label: 'Not at all', value: 0 },
          { label: 'A little', value: 1 },
          { label: 'Somewhat', value: 2 },
          { label: 'Much', value: 3 },
          { label: 'Very much', value: 4 },
        ],
      },
    ],
    bands: [
      { min: 0, max: 7, label: 'No significant insomnia', detail: 'Your answers do not suggest insomnia.', level: 'good' },
      {
        min: 8,
        max: 14,
        label: 'Subthreshold insomnia',
        detail: 'Some trouble sleeping. Insomnia mode (consistent wake time, no naps, stimulus control) can help.',
        level: 'warn',
      },
      {
        min: 15,
        max: 21,
        label: 'Moderate insomnia',
        detail: 'Consider CBT-I (cognitive behavioural therapy for insomnia) — the first-line treatment, available via clinicians and apps.',
        level: 'alert',
      },
      { min: 22, max: 28, label: 'Severe insomnia', detail: 'Please talk to a doctor or sleep specialist about CBT-I and other options.', level: 'alert' },
    ],
  },
  stopbang: {
    id: 'stopbang',
    title: 'Sleep apnoea risk',
    subtitle: 'A quick screen for obstructive sleep apnoea',
    intro: 'Answer yes or no. Your CMF Watch\'s overnight blood-oxygen readings are shown alongside, but cannot diagnose apnoea.',
    source: 'Adapted from the STOP-Bang questionnaire (Chung et al., 2008).',
    questions: [
      { text: 'Do you snore loudly (louder than talking, or heard through a closed door)?', options: yesNo },
      { text: 'Do you often feel tired, fatigued or sleepy during the day?', options: yesNo },
      { text: 'Has anyone seen you stop breathing or choke/gasp during sleep?', options: yesNo },
      { text: 'Do you have, or are you treated for, high blood pressure?', options: yesNo },
      { text: 'Is your BMI over 35?', options: yesNo },
      { text: 'Are you older than 50?', options: yesNo },
      { text: 'Is your neck circumference over 40 cm (16 in)?', options: yesNo },
      { text: 'Are you male?', options: yesNo },
    ],
    bands: [
      { min: 0, max: 2, label: 'Low risk', detail: 'Low risk of moderate-to-severe obstructive sleep apnoea.', level: 'good' },
      { min: 3, max: 4, label: 'Intermediate risk', detail: 'Consider mentioning snoring/sleepiness to your doctor.', level: 'warn' },
      { min: 5, max: 8, label: 'High risk', detail: 'Talk to a doctor about a sleep study. Untreated apnoea affects heart health and daytime alertness.', level: 'alert' },
    ],
  },
};

export function scoreQuiz(id: Quiz['id'], answers: number[]): { score: number; band: QuizBand } {
  const quiz = QUIZZES[id];
  const score = answers.reduce((s, a) => s + a, 0);
  let band = quiz.bands.find((b) => score >= b.min && score <= b.max) ?? quiz.bands[quiz.bands.length - 1];
  if (id === 'stopbang' && score >= 2 && score <= 4) {
    // High risk also when 2+ of the first four (STOP) items are yes plus BMI, neck or male sex.
    const stop = answers.slice(0, 4).reduce((s, a) => s + a, 0);
    if (stop >= 2 && (answers[4] === 1 || answers[6] === 1 || answers[7] === 1)) band = quiz.bands[2];
  }
  return { score, band };
}
