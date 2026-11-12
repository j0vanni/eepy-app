/**
 * Insomnia programme (CBT-I, six weeks).
 *
 * Before starting: the window you would start with, the wake time to pick, a safety check, and
 * Start. While it runs: this week and tonight's window, tonight's rules to tick off, how the week
 * is going, the lesson, and — folded away — the chart, how the window changes, and restart / stop.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import {
  adjustCbtiWindow,
  CBTI_BASELINE_MIN_NIGHTS,
  CBTI_CONDITIONS,
  CBTI_LESSONS,
  CBTI_MIN_WEEK_NIGHTS,
  CBTI_WEEKS,
  CbtiCondition,
  CbtiProgram,
  CbtiSafetyFlag,
  cbtiBaseline,
  cbtiFloor,
  cbtiSafety,
  cbtiStatus,
  startCbtiProgram,
  stimulusControlRules,
} from '@/engine/cbti';
import { eReaderIfOn } from '@/engine/eReader';
import { formatClock, formatDuration, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { LineChart } from '@/ui/charts';
import { CheckRow, Lines } from '@/ui/coach/parts';
import { Banner, Button, Card, Chip, Empty, Fold, Hero, KeyValue, ListCard, ListRow, Meter, Note, Screen, Section, Stepper } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel, shortDate } from '@/ui/format';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, space } from '@/ui/theme';

const RULES_MARK = 'cbti-rules';

export default function CbtiScreen() {
  const a = useAnalysis();
  const program = useStore((s) => s.cbti);
  if (!a) {
    return (
      <Screen>
        <Empty icon="eye-off-outline" title="Insomnia programme" body="A six-week programme (CBT-I) built on your watch's sleep data. Record a week of nights to start.">
          <Button label="Connect your watch" icon="watch" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }
  return program?.active ? <Dashboard a={a} program={program} /> : <Intro a={a} previous={program} />;
}

const FLAG_ICON: Record<CbtiSafetyFlag['severity'], string> = { clinician: 'stethoscope', caution: 'alert-outline', info: 'clipboard-check-outline' };
const FLAG_COLOR: Record<CbtiSafetyFlag['severity'], string> = { clinician: colors.bad, caution: colors.warn, info: colors.textDim };
const QUIZ_FOR: Partial<Record<CbtiSafetyFlag['id'], 'ess' | 'stopbang' | 'isi'>> = { 'ess-missing': 'ess', 'stopbang-missing': 'stopbang', 'isi-missing': 'isi' };

/** One thing the safety check found; the ones about a missing self-check open that check. */
function FlagRow({ flag }: { flag: CbtiSafetyFlag }) {
  const quiz = QUIZ_FOR[flag.id];
  return (
    <ListRow
      icon={FLAG_ICON[flag.severity]}
      iconColor={FLAG_COLOR[flag.severity]}
      title={flag.title}
      sub={quiz ? `${flag.detail} Tap to take the check.` : flag.detail}
      onPress={quiz ? () => router.push({ pathname: '/quiz/[id]', params: { id: quiz } }) : undefined}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Before starting

function Intro({ a, previous }: { a: Analysis; previous?: CbtiProgram }) {
  const profile = useStore((s) => s.profile);
  const setCbti = useStore((s) => s.setCbti);
  const [declared, setDeclared] = useState<Partial<Record<CbtiCondition, boolean>>>({});
  const [clinicianOk, setClinicianOk] = useState(false);
  const [wakeMin, setWakeMin] = useState(() => Math.round((previous?.wakeMin ?? profile.workWakeMin) / 15) * 15);

  const safety = cbtiSafety(profile, declared);
  const baseline = useMemo(() => cbtiBaseline(a.nights, a.day, safety.minWindowMin), [a.nights, a.day, safety.minWindowMin]);
  const bedMin = normalizeMinutes(wakeMin - baseline.windowMin);
  const isi = profile.screenings.isi?.score;
  const gentle = safety.minWindowMin > 300;
  const canStart = baseline.enough && (!safety.needsClinician || clinicianOk);
  const warnings = safety.flags.filter((f) => f.severity !== 'info');
  const tips = safety.flags.filter((f) => f.severity === 'info');

  const start = async () => {
    const ok = await confirm(
      'Start the programme tonight?',
      `In bed ${formatClock(bedMin)}–${formatClock(wakeMin)} (${formatDuration(baseline.windowMin)}), getting up at ${formatClock(wakeMin)} every day. Expect to feel sleepier for the first week or two — don't drive when drowsy.`,
      'Start',
    );
    if (!ok) return;
    setCbti(startCbtiProgram({ nights: a.nights, today: a.day, wakeMin, minWindowMin: safety.minWindowMin }));
  };

  return (
    <Screen subtitle="Six weeks. One wake time every day, and only as much time in bed as you actually sleep. eepy widens the window as your sleep comes together.">
      {!baseline.enough ? (
        <Banner
          tone="warn"
          icon="calendar-clock"
          text={`eepy needs ${CBTI_BASELINE_MIN_NIGHTS} recorded nights from the last 4 weeks to set a fair window (you have ${baseline.nights}). Keep wearing your watch to bed, or add missed nights with Log sleep.`}
        />
      ) : previous ? (
        <Banner icon="history" text={`You stopped your last programme${previous.stoppedAt ? ` ${dayLabel(previous.stoppedAt, a.day).toLowerCase()}` : ''}. Starting again sets a fresh window from your recent nights.`} />
      ) : null}

      <Hero
        label="Your starting window"
        value={`${formatClock(bedMin)} → ${formatClock(wakeMin)}`}
        caption={`${formatDuration(baseline.windowMin)} in bed: your average sleep${gentle ? ', with the gentler 6 h minimum' : ', never less than 5 h'}.`}
      />
      <Card>
        <Stepper
          label="Wake time, every day"
          sub="One you can keep on weekends too"
          value={formatClock(wakeMin)}
          onDec={() => setWakeMin((w) => normalizeMinutes(w - 15))}
          onInc={() => setWakeMin((w) => normalizeMinutes(w + 15))}
        />
      </Card>

      <Section title="Safety check">
        <Card style={{ paddingVertical: space.xs }}>
          <Text style={[font.small, { paddingTop: space.md }]}>Cutting time in bed isn't safe for everyone. Do any of these apply to you?</Text>
          {CBTI_CONDITIONS.map((c) => (
            <Toggle key={c.id} label={c.label} sub={c.sub} value={!!declared[c.id]} onChange={(v) => setDeclared((d) => ({ ...d, [c.id]: v }))} />
          ))}
        </Card>
        {safety.flags.length ? (
          <ListCard>
            {[...warnings, ...tips].map((f) => (
              <FlagRow key={f.id} flag={f} />
            ))}
          </ListCard>
        ) : null}
        {safety.needsClinician ? (
          <Card>
            <Text style={font.small}>Please talk to a doctor or a CBT-I clinician before starting. The rules for bed, worry time and relaxation (the lessons) are safe to use on their own.</Text>
            <Toggle label="A clinician has OK'd this for me" value={clinicianOk} onChange={setClinicianOk} />
          </Card>
        ) : null}
        {!warnings.length ? <Note tone="good">Nothing in your answers rules it out. Stop and see a doctor if you feel unwell, very low or dangerously sleepy.</Note> : null}
      </Section>

      <Button label="Start tonight" icon="play" onPress={start} disabled={!canStart} style={{ marginTop: space.sm }} />

      <Section title="What it is based on">
        <ListCard>
          {baseline.nights > 0 ? <KeyValue label="Average asleep" sub={`Your last ${baseline.nights} nights`} value={formatDuration(baseline.avgSleepMin)} /> : null}
          {baseline.nights > 0 ? <KeyValue label="Average in bed" value={formatDuration(baseline.avgInBedMin)} /> : null}
          {baseline.nights > 0 ? <KeyValue label="Sleep efficiency" sub="Time asleep ÷ time in bed" value={`${Math.round(baseline.efficiency * 100)}%`} /> : null}
          {isi !== undefined ? (
            <KeyValue
              label="Your insomnia check"
              sub={isi >= 15 ? 'Clinically significant: this programme is designed for you. Retake it afterwards.' : 'Retake it after the programme to measure progress.'}
              value={`${isi} / 28`}
              color={isi >= 15 ? colors.warn : colors.text}
            />
          ) : null}
          <Fold bare icon="school-outline" title="How the programme works">
            <Lines
              items={[
                'Sleep restriction: a fixed wake time, and only as much time in bed as you actually sleep. The window widens each week as your sleep consolidates.',
                'Stimulus control: bed is for sleeping. If you lie awake, you get up.',
                'One short lesson a week: worry time, relaxation, habits and relapse prevention.',
              ]}
            />
            <Text style={[font.small, { marginTop: space.md }]}>
              Cognitive behavioural therapy for insomnia is the first-line treatment for long-term insomnia, and works better over time than sleeping pills. The first one to two weeks are the hardest: you
              will probably feel sleepier before you sleep better. Most people see clear gains by week 4.
            </Text>
          </Fold>
        </ListCard>
      </Section>

      <Text style={[font.tiny, { marginTop: space.sm, paddingHorizontal: space.xs }]}>
        Based on standard CBT-I protocols. eepy is not a medical device. If you have depression, another mental or physical health condition, or take sleep medication, involve your doctor.
      </Text>
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// While running

function verdictColor(deltaMin: number) {
  return deltaMin > 0 ? colors.good : deltaMin < 0 ? colors.warn : colors.textDim;
}

function Dashboard({ a, program }: { a: Analysis; program: CbtiProgram }) {
  const setCbti = useStore((s) => s.setCbti);
  const setMark = useStore((s) => s.setMark);
  const rulesMark = useStore((s) => s.settings.marks[RULES_MARK]);
  const s = useMemo(() => cbtiStatus(program, a.nights, a.day), [program, a.nights, a.day]);
  const [lessonWeek, setLessonWeek] = useState<number | undefined>();
  const thisWeek = Math.min(s.week, CBTI_WEEKS);
  const lesson = CBTI_LESSONS[(lessonWeek ?? thisWeek) - 1];
  const eReader = eReaderIfOn(useStore((st) => st.settings.eReader));
  const rules = stimulusControlRules(program.wakeMin, { eReader });

  // Tonight's ticks: "<day>:<bitmask>", so the list resets each day.
  const [markDay, markBits] = typeof rulesMark === 'string' ? rulesMark.split(':') : [];
  const checked = markDay === a.day ? Number(markBits) || 0 : 0;
  const toggleRule = (i: number) => setMark(RULES_MARK, `${a.day}:${checked ^ (1 << i)}`);
  const doneCount = rules.filter((_, i) => checked & (1 << i)).length;

  const cur = s.current;
  const eff = cur.efficiency;
  const series = s.nights;
  const effValues = series.map((n) => (n.efficiency !== undefined ? n.efficiency * 100 : undefined));
  const projected = cur.adjustment;
  const nightsSoFar = 7 - s.daysLeftInWeek;
  const reviewDay = dayLabel(s.nextReviewDate, a.day).toLowerCase();

  const addTime = async () => {
    const ok = await confirm(
      'Add 15 minutes from tonight?',
      `Your window becomes ${formatDuration(s.windowMin + 15)}, with bedtime ${formatClock(s.bedMin - 15)}. Do this if you're struggling to stay safe or awake in the day. Weekly titration continues from the new window.`,
      'Add 15 min',
    );
    if (ok) setCbti(adjustCbtiWindow(program, a.nights, a.day, 15));
  };
  const restart = async () => {
    const ok = await confirm('Restart from week 1?', `A fresh starting window is set from your recent nights, keeping your ${formatClock(program.wakeMin)} wake time.`, 'Restart');
    if (ok) setCbti(startCbtiProgram({ nights: a.nights, today: a.day, wakeMin: program.wakeMin, minWindowMin: program.minWindowMin }));
  };
  const stop = async () => {
    const ok = await confirm('Stop the programme?', "Tonight's plan goes back to eepy's normal schedule. Your sleep data stays.", 'Stop', true);
    if (ok) setCbti({ ...program, active: false, stoppedAt: a.day });
  };

  return (
    <Screen>
      <Hero
        label={`${s.maintenance ? `Week ${s.week} · keeping it up` : `Week ${s.week} of ${CBTI_WEEKS}`} · in bed tonight`}
        value={`${formatClock(s.bedMin)} → ${formatClock(s.wakeMin)}`}
        caption={`${formatDuration(s.windowMin)} in bed. Up at ${formatClock(s.wakeMin)} every day, however you slept.`}
      >
        <View style={{ marginTop: space.md }}>
          <Meter value={Math.min(s.week - 1 + (7 - s.daysLeftInWeek) / 7, CBTI_WEEKS)} max={CBTI_WEEKS} />
        </View>
        <Text style={[font.small, { marginTop: space.sm, color: s.lastCompleted ? verdictColor(s.windowMin - s.lastCompleted.windowMin) : colors.textDim }]}>
          {s.change} {s.daysLeftInWeek} night{s.daysLeftInWeek === 1 ? '' : 's'} left this week.
        </Text>
      </Hero>

      <Section title={`Tonight's rules · ${doneCount} of ${rules.length}`}>
        <ListCard>
          {rules.map((r, i) => (
            <CheckRow key={r.id} title={r.title} sub={r.detail} checked={(checked & (1 << i)) !== 0} onToggle={() => toggleRule(i)} />
          ))}
        </ListCard>
      </Section>

      <Section title="This week">
        <ListCard>
          <KeyValue label="Sleep efficiency" sub={nightsSoFar ? `${cur.nightsRecorded} of ${nightsSoFar} nights recorded` : 'From tomorrow'} value={eff !== undefined ? `${Math.round(eff * 100)}%` : '–'} />
          <KeyValue label="Nights inside the window" value={`${cur.nightsInWindow} of ${cur.nightsRecorded}`} />
          <KeyValue label="Average asleep" value={cur.avgSleepMin !== undefined ? formatDuration(cur.avgSleepMin) : '–'} />
          <KeyValue
            label={projected.verdict === 'insufficient' ? 'Next review' : 'On track for'}
            sub={
              projected.verdict === 'insufficient'
                ? `${cur.nightsRecorded} of the ${CBTI_MIN_WEEK_NIGHTS} recorded nights needed so far`
                : `${projected.reason} Decided ${reviewDay} morning.`
            }
            value={projected.verdict === 'insufficient' ? `${dayLabel(s.nextReviewDate, a.day)} morning` : projected.deltaMin > 0 ? '+15 min' : projected.deltaMin < 0 ? '−15 min' : 'Same window'}
            color={projected.verdict === 'insufficient' ? colors.text : verdictColor(projected.deltaMin)}
          />
          <Fold bare icon="chart-line" title="Every night so far" value={`${s.weeks.length} week${s.weeks.length === 1 ? '' : 's'}`}>
            <LineChart values={effValues} labels={series.map((n) => shortDate(n.wakeDate))} color={colors.accent} band={{ lo: 85, hi: 90 }} maxY={100} format={(v) => `${Math.round(v)}%`} />
            <Text style={[font.tiny, { marginTop: space.sm }]}>Sleep efficiency each night since you started. The shaded band is the 85–90% target.</Text>
            <View style={{ marginTop: space.sm }}>
              {[...s.weeks].reverse().map((w) => (
                <KeyValue
                  key={w.week}
                  label={`Week ${w.week}`}
                  sub={`${formatDuration(w.windowMin)} in bed · ${w.efficiency !== undefined ? `${Math.round(w.efficiency * 100)}%` : 'no data'} · ${w.nightsRecorded} night${w.nightsRecorded === 1 ? '' : 's'}`}
                  value={w.complete ? (w.adjustment.deltaMin > 0 ? '+15 min' : w.adjustment.deltaMin < 0 ? '−15 min' : 'Held') : 'In progress'}
                  color={w.complete ? verdictColor(w.adjustment.deltaMin) : colors.textFaint}
                />
              ))}
            </View>
          </Fold>
          <Fold bare icon="help-circle-outline" title="How the window changes">
            <Text style={font.small}>
              Each week, 90% or more adds 15 minutes, 85–90% keeps the window, and under 85% takes 15 minutes off (never below {formatDuration(cbtiFloor(program))}).
            </Text>
            <Text style={[font.small, { marginTop: space.sm }]}>
              Efficiency is time asleep ÷ time in bed, from your watch. If you lie awake before it notices you're in bed it reads high, so add those nights with Log sleep.
            </Text>
          </Fold>
        </ListCard>
      </Section>

      <Section title={lesson.week === thisWeek ? "This week's lesson" : `Lesson ${lesson.week}`}>
        <Fold icon="school-outline" title={lesson.title} sub={lesson.summary}>
          <Lines items={lesson.points} />
          <Text style={[font.label, { textTransform: 'uppercase', marginTop: space.lg, marginBottom: space.sm }]}>This week, try</Text>
          <Lines items={lesson.practice} icon="arrow-right-thin" color={colors.accent} />
          <Text style={[font.label, { textTransform: 'uppercase', marginTop: space.lg, marginBottom: space.sm }]}>All lessons</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {CBTI_LESSONS.map((l) => (
              <Chip key={l.week} label={String(l.week)} selected={l.week === lesson.week} onPress={() => setLessonWeek(l.week)} />
            ))}
          </View>
        </Fold>
      </Section>

      <Section title="If it gets too much">
        <Note tone="warn" icon="car-off">
          Feeling sleepier is expected in the first weeks. Don't drive or use machinery if you're drowsy. If it's too much, add 15 minutes rather than giving up.
        </Note>
        <ListCard>
          <ListRow icon="plus" title="Add 15 minutes from tonight" sub={`In bed ${formatClock(s.bedMin - 15)} instead`} onPress={addTime} />
        </ListCard>
      </Section>

      <Section title="Programme">
        <ListCard>
          <KeyValue
            label="Started"
            sub={`With ${formatDuration(program.windowMin)} in bed${program.baseline ? ` · you slept ${formatDuration(program.baseline.avgSleepMin)} on average, efficiency ${Math.round(program.baseline.efficiency * 100)}%` : ''}`}
            value={dayLabel(program.startedAt, a.day)}
          />
          {s.maintenance ? <ListRow icon="check-circle-outline" iconColor={colors.good} title="Six weeks done" sub="Keep the wake time, and let the window keep growing while efficiency stays high" /> : null}
          <ListRow icon="restart" title="Restart from week 1" sub="A fresh window from your recent nights" onPress={restart} />
          <ListRow icon="stop-circle-outline" iconColor={colors.bad} title="Stop the programme" sub="Tonight's plan goes back to normal" onPress={stop} />
        </ListCard>
      </Section>
    </Screen>
  );
}
