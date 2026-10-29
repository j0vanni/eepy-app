// OWNER: learning workstream. "Your body clock": how eepy is learning your rhythm and sleep need.
import { router } from 'expo-router';
import { ReactNode, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { energyFromKss, forecastEnergy } from '@/engine/alertness';
import { describeRhythm, eligibleCheckins, LEARNING, livingDay, TimeOfDay, timeOfDay } from '@/engine/calibration';
import { pingsPerDay } from '@/engine/pingPlan';
import { atMinutes, DAY, formatDuration, formatTime, minutesOfDay } from '@/engine/time';
import { LEARNING_RESET_MARK, useLearning } from '@/state/learning';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Empty, Icon, ListRow, Meter, Note, Row, Screen, Section, Stat } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { KSS_LABELS, QuickCheckIn } from '@/ui/learning/QuickCheckIn';
import { ChartCheckIn, RhythmChart } from '@/ui/learning/RhythmChart';
import { colors, font, space } from '@/ui/theme';

const PART_LABEL: Record<TimeOfDay, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const fmtErr = (x?: number) => (x === undefined ? '–' : x.toFixed(1));

export default function LearningScreen() {
  useLearning();
  const a = useAnalysis();
  const calibration = useStore((s) => s.calibration);
  const checkins = useStore((s) => s.checkins);
  const removeCheckIn = useStore((s) => s.removeCheckIn);
  const prefs = useStore((s) => s.settings.notifications);
  const resetAt = useStore((s) => s.settings.marks[LEARNING_RESET_MARK]);
  const since = typeof resetAt === 'number' ? resetAt : undefined;

  const now = a?.now ?? Date.now();
  const eligible = useMemo(() => eligibleCheckins(checkins, now, since), [checkins, now, since]);
  const applied = !!calibration?.applied;

  const curves = useMemo(() => {
    if (!a) return undefined;
    const base = {
      sleeps: a.sleeps,
      now: a.now,
      wakeTime: a.wakeTime,
      bedtime: a.tonight.bedtime,
      nextWake: a.tonight.wake,
      midSleepMin: a.habitualMidSleepMin,
      debtMin: a.debt.debtMin,
      assumedLastNight: a.energy.assumedLastNight,
    };
    const population = forecastEnergy(base);
    const personal = calibration?.applied ? forecastEnergy({ ...base, circadian: calibration.params }) : undefined;
    return { population, personal };
  }, [a, calibration]);

  const dots: ChartCheckIn[] = useMemo(() => {
    if (!a) return [];
    return checkins
      .filter((c) => c.time <= a.now && c.time > a.now - 14 * DAY)
      .map((c) => {
        const m = minutesOfDay(c.time);
        return { t: atMinutes(a.day, m) + (m < 240 ? DAY : 0), energy: energyFromKss(c.kss), today: livingDay(c.time) === a.day };
      });
  }, [a, checkins]);

  const coverage = useMemo(() => {
    const out: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0 };
    for (const c of eligible) out[timeOfDay(c.time)]++;
    return out;
  }, [eligible]);

  if (!a || !curves) {
    return (
      <Screen>
        <Empty
          icon="brain"
          title="Your body clock"
          body="eepy learns your personal rhythm from quick 'how alert are you?' check-ins, matched against your sleep. Connect your watch (or try demo data) to start."
        >
          <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }

  const n = eligible.length;
  const target = LEARNING.confidentCheckins;
  const forecast = curves.personal ?? curves.population;
  const findings = calibration ? describeRhythm(calibration.fitted ?? calibration.params) : [];
  const perDay = pingsPerDay(prefs.pingsPerDay, calibration);
  const parts = Object.keys(coverage) as TimeOfDay[];
  const weakest = parts.reduce((x, y) => (coverage[y] < coverage[x] ? y : x));
  const lopsided = coverage[weakest] < 5 || coverage[weakest] < 0.6 * Math.max(...parts.map((k) => coverage[k]));
  const recent = [...checkins].sort((x, y) => y.time - x.time).slice(0, 15);
  const need = a.need;

  const status = calibration
    ? applied
      ? (calibration.accuracy ?? 0) > (calibration.accuracyBefore ?? 0)
        ? `Your personal model predicted ${calibration.accuracy}% of check-ins it hadn't seen within ±1 point — the average-person model managed ${calibration.accuracyBefore}%.`
        : `Your personal model misses check-ins it hadn't seen by less (${fmtErr(calibration.maeBefore)} → ${fmtErr(calibration.maeAfter)} points on average), and lands within ±1 point about as often as the average-person model.`
      : `Not enough signal yet: your personal fit doesn't predict new check-ins better than the average-person model, so eepy keeps using the average for now.`
    : n >= LEARNING.minCheckins
      ? 'Waiting for the sleep around your check-ins to sync — eepy needs the night before each rating.'
      : `${LEARNING.minCheckins - n} more check-in${LEARNING.minCheckins - n === 1 ? '' : 's'} until your first personal fit.`;

  return (
    <Screen>
      <Card accent={applied ? colors.accent : undefined}>
        <CardTitle icon="brain" title={applied ? 'Personal forecast active' : 'Learning your rhythm'} />
        <Row gap={space.lg} style={{ alignItems: 'flex-end' }}>
          <View>
            <Text style={font.tiny}>FORECAST ACCURACY</Text>
            <Text style={[font.stat, { fontSize: 40, color: applied ? colors.text : colors.textDim }]}>{calibration?.accuracy !== undefined ? `${calibration.accuracy}%` : '—'}</Text>
          </View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text style={font.small}>{calibration ? `confidence ${calibration.confidence ?? 'low'}` : 'not fitted yet'}</Text>
          </View>
        </Row>
        <Text style={[font.small, { marginTop: space.sm }]}>{status}</Text>
        <Row style={{ marginTop: space.md }}>
          <Stat label="Check-ins" value={`${n}`} sub={n >= target ? 'enough for a confident fit' : `of ${target} for a confident fit`} />
          <Stat label="Days" value={`${calibration?.days ?? new Set(eligible.map((c) => livingDay(c.time))).size}`} sub="with ratings" />
          <Stat label="Typical error" value={calibration ? `${fmtErr(calibration.maeBefore)} → ${fmtErr(calibration.maeAfter)}` : '–'} sub="KSS points" />
        </Row>
        <View style={{ marginTop: space.md }}>
          <Meter value={Math.min(n, target)} max={target} color={applied ? colors.accent : colors.warn} />
        </View>
        <View style={{ marginTop: space.md }}>
          <QuickCheckIn />
        </View>
      </Card>

      <Card>
        <CardTitle icon="lightning-bolt-outline" title="Today's energy" color={colors.energy} />
        <RhythmChart population={curves.population.points} personal={curves.personal?.points} checkins={dots} now={a.now} />
        <Text style={[font.tiny, { marginTop: space.sm }]}>
          {curves.personal
            ? 'Solid: the forecast fitted to you. Dashed: the same day for an average person with your sleep. Dots: your ratings from the last two weeks at the time of day you gave them.'
            : 'The forecast for an average person with your sleep. Dots: your ratings from the last two weeks at the time of day you gave them.'}
        </Text>
      </Card>

      <Section title={applied ? 'What eepy has learned' : 'Early signs'}>
        <Card>
          {forecast.peaks.length ? (
            <FindingRow icon="trending-up" color={colors.good}>
              {applied ? "You're" : 'An average person with your sleep is'} most alert around {forecast.peaks.map((p) => formatTime(p.t)).join(' and ')}.
            </FindingRow>
          ) : null}
          {forecast.dip ? (
            <FindingRow icon="trending-down" color={colors.warn}>
              {applied ? 'Your' : 'Their'} energy dips around {formatTime(forecast.dip.t)} — good for routine tasks, a walk outside, or a short nap.
            </FindingRow>
          ) : null}
          {findings.map((f) => (
            <FindingRow key={f.id} icon="brain" color={colors.accent}>
              {f.text}
              {!applied ? ' (tentative)' : ''}
            </FindingRow>
          ))}
          {!calibration ? <FindingRow icon="timer-sand" color={colors.textDim}>Findings about your own rhythm appear after {LEARNING.minCheckins} check-ins.</FindingRow> : null}
        </Card>
      </Section>

      <Section title="Progress">
        <Card>
          <Text style={font.body}>Check-ins by time of day</Text>
          <Row style={{ marginTop: space.sm }}>
            {(Object.keys(PART_LABEL) as TimeOfDay[]).map((k) => (
              <Stat key={k} label={PART_LABEL[k]} value={String(coverage[k])} />
            ))}
          </Row>
          <Text style={[font.small, { marginTop: space.sm }]}>
            {n === 0
              ? 'Rate how alert you feel a few times across the day — mornings, the early afternoon and evenings all matter.'
              : lopsided
                ? `${PART_LABEL[weakest]} check-ins would help most right now: the fit needs every part of the day to pin down your timing.`
                : 'Good spread across the day — that is what pins down your timing.'}
          </Text>
          <Text style={[font.small, { marginTop: space.sm }]}>
            {!prefs.pings
              ? 'Pings are off — turn them on in Settings, or check in here whenever you like.'
              : perDay === 1
                ? 'Pings: 1 a day. Your fit is well calibrated, so one a day keeps it current as your routine changes.'
                : `Pings: ${perDay} a day. After ${LEARNING.taperCheckins} check-ins over ${LEARNING.taperDays}+ days they drop to one a day.`}
          </Text>
        </Card>
      </Section>

      <Section title="Sleep need" action={<Button small kind="ghost" label="Details" onPress={() => router.push('/need')} />}>
        <Card>
          <Row>
            <Text style={[font.body, { flex: 1 }]}>Nights you woke on your own</Text>
            <Text style={font.h3}>
              {need.naturalNightsUsed >= need.naturalNightsWanted ? `${need.naturalNightsUsed} ✓` : `${need.naturalNightsUsed}/${need.naturalNightsWanted}`}
            </Text>
          </Row>
          <View style={{ marginVertical: space.sm }}>
            <Meter value={Math.min(need.naturalNightsUsed, need.naturalNightsWanted)} max={need.naturalNightsWanted} color={colors.good} />
          </View>
          <Text style={font.small}>
            Your need is {formatDuration(need.needMin)} ({need.method === 'personalized' ? `personalised, ${need.confidence} confidence` : need.method === 'override' ? 'set by you' : 'age-based so far'}).
            {prefs.naturalWakePrompt ? ' On free days eepy asks "Did you wake up on your own?" — one tap adds a night.' : ' Mark alarm-free mornings in the journal to add nights.'}
          </Text>
          {need.evidence.map((e) => (
            <Row key={e.key} style={{ marginTop: space.sm }}>
              <Text style={[font.small, { flex: 1, color: colors.text }]}>{e.label}</Text>
              <Text style={font.small}>
                {formatDuration(e.estimateMin)} ± {Math.round(e.sdMin)}m
              </Text>
            </Row>
          ))}
        </Card>
      </Section>

      <Section title="Recent check-ins" action={<Button small kind="ghost" label="Check in" icon="plus" onPress={() => router.push('/checkin')} />}>
        <Card>
          {recent.length === 0 ? <Text style={font.small}>No check-ins yet.</Text> : null}
          {recent.map((c, i) => (
            <View key={c.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <ListRow
                icon={c.source === 'ping' ? 'bell-outline' : 'gesture-tap'}
                title={`${dayLabel(livingDay(c.time), a.day)} ${formatTime(c.time)} · KSS ${c.kss}`}
                sub={`${KSS_LABELS[Math.round(c.kss)] ?? ''}${since !== undefined && c.time < since ? ' · from before the reset' : ''}`}
                right={
                  <Pressable
                    hitSlop={10}
                    accessibilityLabel="Delete check-in"
                    onPress={async () => {
                      if (await confirm('Delete check-in?', `${formatTime(c.time)} · KSS ${c.kss}`, 'Delete', true)) removeCheckIn(c.id);
                    }}
                  >
                    <Icon name="trash-can-outline" color={colors.textFaint} />
                  </Pressable>
                }
              />
            </View>
          ))}
        </Card>
      </Section>

      <Section title="How this works">
        <Card>
          <Text style={font.small}>
            The energy curve comes from a sleep-science model with three parts: sleep pressure that builds while you're awake (from your watch's sleep data), a
            body clock — a 24-hour rhythm plus the early-afternoon dip — and grogginess right after waking. The body-clock part starts from population averages.
          </Text>
          <Text style={[font.small, { marginTop: space.sm }]}>
            Each check-in is compared with what the model predicted for that moment. eepy adjusts four things: when your rhythm runs, how big the daily swing is,
            how deep your afternoon dip is, and how you personally use the 1–9 scale. It starts from the average and only moves with consistent evidence, so one
            rough afternoon changes little.
          </Text>
          <Text style={[font.small, { marginTop: space.sm }]}>
            Accuracy is measured on check-ins left out of the fit, and your personal model is only used once it beats the average one. It can't see caffeine,
            meals, stress, illness or daylight — those show up as noise. Expect about two weeks of 2–3 check-ins a day for a confident fit.
          </Text>
        </Card>
        {calibration?.skipped ? (
          <Note tone="info">
            {calibration.skipped} check-in{calibration.skipped === 1 ? ' was' : 's were'} left out because the sleep before {calibration.skipped === 1 ? 'it' : 'them'} wasn't
            recorded.
          </Note>
        ) : null}
      </Section>
    </Screen>
  );
}

function FindingRow({ icon, color, children }: { icon: string; color: string; children: ReactNode }) {
  return (
    <Row gap={space.md} style={{ alignItems: 'flex-start', paddingVertical: 6 }}>
      <Icon name={icon} color={color} size={18} />
      <Text style={[font.body, { flex: 1 }]}>{children}</Text>
    </Row>
  );
}
