import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
import { formatClock, formatDuration, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { LineChart } from '@/ui/charts';
import { Button, Card, CardTitle, Chip, Empty, Icon, Meter, Note, Row, Screen, Section, Stat, Stepper } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel, shortDate } from '@/ui/format';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, radius, space } from '@/ui/theme';

const RULES_MARK = 'cbti-rules';

export default function CbtiScreen() {
  const a = useAnalysis();
  const program = useStore((s) => s.cbti);
  if (!a) {
    return (
      <Screen>
        <Empty icon="eye-off-outline" title="Insomnia programme" body="A 6-week CBT-I programme built on your watch's sleep data. Record a week of nights to start.">
          <Button label="Connect your watch" icon="watch" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }
  return program?.active ? <Dashboard a={a} program={program} /> : <Intro a={a} previous={program} />;
}

function Bullets({ items, color = colors.textDim }: { items: string[]; color?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((t) => (
        <Row key={t} gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Text style={[font.body, { color }]}>•</Text>
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{t}</Text>
        </Row>
      ))}
    </View>
  );
}

const TONE: Record<CbtiSafetyFlag['severity'], 'bad' | 'warn' | 'info'> = { clinician: 'bad', caution: 'warn', info: 'info' };
const QUIZ_FOR: Partial<Record<CbtiSafetyFlag['id'], 'ess' | 'stopbang' | 'isi'>> = { 'ess-missing': 'ess', 'stopbang-missing': 'stopbang', 'isi-missing': 'isi' };

function FlagNote({ flag }: { flag: CbtiSafetyFlag }) {
  const quiz = QUIZ_FOR[flag.id];
  return (
    <View>
      <Note tone={TONE[flag.severity]} icon={flag.severity === 'clinician' ? 'stethoscope' : flag.severity === 'caution' ? 'alert-outline' : 'clipboard-check-outline'}>
        <Text style={{ fontWeight: '700' }}>{flag.title}. </Text>
        {flag.detail}
      </Note>
      {quiz ? (
        <View style={{ alignSelf: 'flex-start', marginBottom: space.sm, marginTop: -2 }}>
          <Button small kind="ghost" label="Take the check" icon="chevron-right" onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: quiz } })} />
        </View>
      ) : null}
    </View>
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
    <Screen>
      <Card>
        <CardTitle icon="account-heart" title="CBT-I in 6 weeks" />
        <Text style={font.body}>
          Cognitive behavioural therapy for insomnia is the first-line treatment for long-term insomnia. It works better over time than sleeping pills.
        </Text>
        <View style={{ marginTop: space.md }}>
          <Bullets
            items={[
              'Sleep restriction: a fixed wake time, and only as much time in bed as you actually sleep. eepy widens the window each week as your sleep consolidates.',
              'Stimulus control: bed is for sleeping. If you lie awake, you get up.',
              'One short lesson a week: worry time, relaxation, habits and relapse prevention.',
            ]}
          />
        </View>
        <Text style={[font.small, { marginTop: space.md }]}>
          The first one to two weeks are the hardest: you will probably feel sleepier before you sleep better. Most people see clear gains by week 4.
        </Text>
      </Card>

      {previous ? (
        <Note tone="info" icon="history">
          You stopped your last programme{previous.stoppedAt ? ` on ${dayLabel(previous.stoppedAt, a.day)}` : ''}. Starting again uses a fresh baseline from your recent nights.
        </Note>
      ) : null}

      {isi !== undefined ? (
        <Note tone={isi >= 15 ? 'warn' : 'info'} icon="eye-outline">
          Your insomnia check: {isi} / 28{isi >= 15 ? ', clinically significant insomnia. This programme is designed for you.' : '.'} Retake it after the programme to measure your progress.
        </Note>
      ) : null}

      <Section title="Safety check">
        <Card>
          <Text style={[font.small, { marginBottom: space.sm }]}>Sleep restriction isn't safe for everyone. Do any of these apply to you?</Text>
          {CBTI_CONDITIONS.map((c) => (
            <Toggle key={c.id} label={c.label} sub={c.sub} value={!!declared[c.id]} onChange={(v) => setDeclared((d) => ({ ...d, [c.id]: v }))} />
          ))}
        </Card>
        {warnings.map((f) => (
          <FlagNote key={f.id} flag={f} />
        ))}
        {tips.map((f) => (
          <FlagNote key={f.id} flag={f} />
        ))}
        {safety.needsClinician ? (
          <Card accent={colors.bad}>
            <Text style={font.body}>Please talk to a doctor or a CBT-I clinician before starting. Stimulus control, worry time and relaxation (the lessons) are safe to use on their own.</Text>
            <Toggle label="A clinician has OK'd sleep restriction for me" value={clinicianOk} onChange={setClinicianOk} />
          </Card>
        ) : null}
        {!warnings.length ? (
          <Note tone="good">Nothing in your answers rules out sleep restriction. Stop and see a doctor if you feel unwell, very low or dangerously sleepy.</Note>
        ) : null}
      </Section>

      <Section title="Your sleep window">
        <Card>
          <Stepper
            label="Wake time, every day"
            sub="Pick one you can keep on weekends too"
            value={formatClock(wakeMin)}
            onDec={() => setWakeMin((w) => normalizeMinutes(w - 15))}
            onInc={() => setWakeMin((w) => normalizeMinutes(w + 15))}
          />
          {baseline.nights > 0 ? (
            <Row style={{ marginTop: space.md }}>
              <Stat label="Avg asleep" value={formatDuration(baseline.avgSleepMin)} sub={`last ${baseline.nights} nights`} />
              <Stat label="Avg in bed" value={formatDuration(baseline.avgInBedMin)} />
              <Stat label="Efficiency" value={`${Math.round(baseline.efficiency * 100)}%`} sub="asleep ÷ in bed" />
            </Row>
          ) : null}
          <View style={{ marginTop: space.lg, padding: space.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
            <Text style={font.tiny}>STARTING WINDOW</Text>
            <Text style={[font.stat, { marginTop: 2 }]}>
              {formatClock(bedMin)} → {formatClock(wakeMin)}
            </Text>
            <Text style={font.small}>
              {formatDuration(baseline.windowMin)} in bed: your average sleep{gentle ? ', with the gentler 6 h minimum' : ', never less than 5 h'}.
            </Text>
          </View>
          {!baseline.enough ? (
            <View style={{ marginTop: space.md }}>
              <Note tone="warn" icon="calendar-clock">
                eepy needs at least {CBTI_BASELINE_MIN_NIGHTS} recorded nights from the last 4 weeks to set a fair window (you have {baseline.nights}). Keep wearing your watch to bed, or add missed nights with Log sleep.
              </Note>
            </View>
          ) : null}
          <View style={{ marginTop: space.md }}>
            <Button label="Start tonight" icon="play" onPress={start} disabled={!canStart} />
          </View>
        </Card>
      </Section>

      <Text style={[font.tiny, { marginTop: space.sm }]}>
        Based on standard CBT-I protocols (sleep restriction, stimulus control). eepy is not a medical device. If you have depression, another mental or physical health condition, or take sleep medication,
        involve your doctor.
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
  const lesson = CBTI_LESSONS[(lessonWeek ?? Math.min(s.week, CBTI_WEEKS)) - 1];
  const rules = stimulusControlRules(program.wakeMin);

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
      <Card accent={colors.accent}>
        <Row>
          <Text style={[font.tiny, { flex: 1 }]}>
            {s.maintenance ? `WEEK ${s.week} · MAINTENANCE` : `WEEK ${s.week} OF ${CBTI_WEEKS}`} · {s.lesson.title.toUpperCase()}
          </Text>
          <Text style={font.tiny}>
            {s.daysLeftInWeek} night{s.daysLeftInWeek === 1 ? '' : 's'} left
          </Text>
        </Row>
        <Meter value={Math.min(s.week - 1 + (7 - s.daysLeftInWeek) / 7, CBTI_WEEKS)} max={CBTI_WEEKS} height={6} />
        <Text style={[font.tiny, { marginTop: space.lg }]}>TONIGHT IN BED</Text>
        <Text style={[font.stat, { fontSize: 36, marginTop: 2 }]}>
          {formatClock(s.bedMin)} → {formatClock(s.wakeMin)}
        </Text>
        <Text style={font.small}>{formatDuration(s.windowMin)} in bed · up at {formatClock(s.wakeMin)} every day, however you slept</Text>
        <Text style={[font.small, { marginTop: space.sm, color: s.lastCompleted ? verdictColor(s.windowMin - s.lastCompleted.windowMin) : colors.textDim }]}>{s.change}</Text>
      </Card>

      <Section title="This week">
        <Card>
          <Row>
            <Stat label="Efficiency" value={eff !== undefined ? `${Math.round(eff * 100)}%` : '–'} sub={nightsSoFar ? `${cur.nightsRecorded} of ${nightsSoFar} nights` : 'from tomorrow'} />
            <Stat label="In window" value={`${cur.nightsInWindow}/${cur.nightsRecorded}`} sub="nights kept" />
            <Stat label="Avg asleep" value={cur.avgSleepMin !== undefined ? formatDuration(cur.avgSleepMin) : '–'} />
          </Row>
          <View style={{ marginTop: space.md, padding: space.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
            <Row gap={space.sm}>
              <Icon name={projected.deltaMin > 0 ? 'arrow-expand-horizontal' : projected.deltaMin < 0 ? 'arrow-collapse-horizontal' : 'equal'} color={verdictColor(projected.deltaMin)} />
              <Text style={[font.h3, { flex: 1 }]}>
                {projected.verdict === 'insufficient'
                  ? `Next review: ${dayLabel(s.nextReviewDate, a.day)} morning`
                  : projected.deltaMin > 0
                    ? 'On track for +15 min'
                    : projected.deltaMin < 0
                      ? 'On track for −15 min'
                      : 'On track to keep the window'}
              </Text>
            </Row>
            <Text style={[font.small, { marginTop: 4 }]}>
              {projected.verdict === 'insufficient'
                ? `${cur.nightsRecorded} of the ${CBTI_MIN_WEEK_NIGHTS} recorded nights needed so far. `
                : `${projected.reason} Decided on ${dayLabel(s.nextReviewDate, a.day)} morning. `}
              Each week, 90% or more adds 15 min, 85–90% holds, and under 85% removes 15 min (never below {formatDuration(cbtiFloor(program))}).
            </Text>
          </View>
        </Card>
      </Section>

      <Section title="Sleep efficiency">
        <Card>
          <LineChart values={effValues} labels={series.map((n) => shortDate(n.wakeDate))} color={colors.accent} band={{ lo: 85, hi: 90 }} maxY={100} format={(v) => `${Math.round(v)}%`} />
          <Text style={[font.tiny, { marginTop: 6 }]}>Each night since you started. The shaded band is the 85–90% target.</Text>
          <View style={{ marginTop: space.md }}>
            {[...s.weeks].reverse().map((w) => (
              <Row key={w.week} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={[font.body, { width: 70 }]}>Week {w.week}</Text>
                <Text style={[font.small, { flex: 1 }]}>
                  {formatDuration(w.windowMin)} · {w.efficiency !== undefined ? `${Math.round(w.efficiency * 100)}%` : 'no data'} · {w.nightsRecorded} night{w.nightsRecorded === 1 ? '' : 's'}
                </Text>
                <Text style={[font.small, { color: w.complete ? verdictColor(w.adjustment.deltaMin) : colors.textFaint }]}>
                  {w.complete ? (w.adjustment.deltaMin > 0 ? '+15 min' : w.adjustment.deltaMin < 0 ? '−15 min' : 'held') : 'in progress'}
                </Text>
              </Row>
            ))}
          </View>
          <Text style={[font.tiny, { marginTop: space.sm }]}>
            Efficiency = time asleep ÷ time in bed, from your watch. If you lie awake before it notices you&apos;re in bed it reads high, so add those nights with Log sleep.
          </Text>
        </Card>
      </Section>

      <Section title={lessonWeek && lessonWeek !== Math.min(s.week, CBTI_WEEKS) ? `Lesson ${lesson.week}` : "This week's lesson"}>
        <Card>
          <CardTitle icon="school-outline" title={lesson.title} />
          <Text style={font.body}>{lesson.summary}</Text>
          <View style={{ marginTop: space.md }}>
            <Bullets items={lesson.points} />
          </View>
          <Text style={[font.tiny, { marginTop: space.md, marginBottom: space.sm }]}>THIS WEEK, TRY</Text>
          <Bullets items={lesson.practice} color={colors.accent} />
          <Row gap={6} style={{ marginTop: space.lg, flexWrap: 'wrap' }}>
            {CBTI_LESSONS.map((l) => (
              <Chip key={l.week} label={`${l.week}`} selected={l.week === lesson.week} onPress={() => setLessonWeek(l.week)} />
            ))}
          </Row>
        </Card>
      </Section>

      <Section title={`Tonight's rules · ${doneCount}/${rules.length}`}>
        <Card>
          {rules.map((r, i) => {
            const on = (checked & (1 << i)) !== 0;
            return (
              <Pressable
                key={r.id}
                onPress={() => toggleRule(i)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm, alignItems: 'flex-start' }, pressed && { opacity: 0.7 }]}
              >
                <Icon name={on ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} color={on ? colors.good : colors.textFaint} />
                <View style={{ flex: 1 }}>
                  <Text style={font.body}>{r.title}</Text>
                  <Text style={font.small}>{r.detail}</Text>
                </View>
              </Pressable>
            );
          })}
          <Text style={[font.tiny, { marginTop: space.sm }]}>Stimulus control. Tick them as you go; the list resets each day.</Text>
        </Card>
      </Section>

      <Section title="Safety">
        <Note tone="warn" icon="car-off">
          Feeling sleepier is expected in the first weeks. Don&apos;t drive or use machinery if you&apos;re drowsy. If it&apos;s too much, add 15 minutes rather than giving up.
        </Note>
        <Button label="Add 15 min from tonight" icon="plus" kind="secondary" onPress={addTime} />
      </Section>

      <Section title="Programme">
        <Card>
          <Text style={font.small}>
            Started {dayLabel(program.startedAt, a.day)} with {formatDuration(program.windowMin)} in bed
            {program.baseline ? ` (average sleep ${formatDuration(program.baseline.avgSleepMin)}, efficiency ${Math.round(program.baseline.efficiency * 100)}%)` : ''}.
            {s.maintenance ? ' You have finished the six weeks: keep the wake time, and keep letting the window grow while efficiency stays high.' : ''}
          </Text>
          <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
            <Button small kind="secondary" icon="restart" label="Restart from week 1" onPress={restart} />
            <Button small kind="danger" icon="stop" label="Stop programme" onPress={stop} />
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
