/**
 * Energy: the number now, what it is made of, what the watch contributed, and how well eepy's
 * forecast has matched your own ratings (and your reaction tests).
 */
import { router } from 'expo-router';
import { ReactNode, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { energyFromKss, forecastEnergy, sleepPressureAt } from '@/engine/alertness';
import { calibrationContext, CalibrationTier, createKssPredictor, describeRhythm, eligibleCheckins, LEARNING, livingDay, timeOfDay, TimeOfDay } from '@/engine/calibration';
import { curvePosition } from '@/engine/dayPhase';
import { pingsPerDay } from '@/engine/pingPlan';
import { reactionAgreement, readReaction, REACTION_VERDICT_TEXT } from '@/engine/reaction';
import { atMinutes, DAY, formatTime, minutesOfDay } from '@/engine/time';
import { DEFAULT_WEIGHTS, SignalKey } from '@/engine/watchSignals';
import { LEARNING_RESET_MARK, useLearning } from '@/state/learning';
import { selectDataset, useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { useAnalysis } from '@/state/useAnalysis';
import { RecoveryAlertCard } from '@/ui/cards/CoachCards';
import { EnergyChart } from '@/ui/charts';
import { Banner, Button, Card, Empty, Fold, Hero, Icon, IconButton, KeyValue, Link, ListCard, ListRow, Meter, Row, Screen, Section, SplitBar, Stat } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { KSS_LABELS, QuickCheckIn } from '@/ui/learning/QuickCheckIn';
import { ChartCheckIn, RhythmChart } from '@/ui/learning/RhythmChart';
import { colors, font, scoreColor, space } from '@/ui/theme';
import { energySentence } from '@/ui/today/heroes';

const PART_LABEL: Record<TimeOfDay, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

const SIGNAL_LABEL: Record<SignalKey | 'clock', string> = {
  caffeine: 'Caffeine',
  rhr: 'Sleeping heart rate',
  hrv: 'HRV overnight',
  deep: 'Deep sleep',
  waso: 'Time awake at night',
  resp: 'Breathing rate',
  dayHr: 'Heart rate during the day',
  clock: 'Body-clock shift',
};

const TIER_TEXT: Record<CalibrationTier, string> = {
  population: 'Typical body clock, sleep times only',
  personal: 'Your body clock, sleep times only',
  watch: 'Typical body clock + your watch',
  'personal+watch': 'Your body clock + your watch',
};

function Para({ children }: { children: ReactNode }) {
  return <Text style={[font.small, { marginTop: space.sm }]}>{children}</Text>;
}

export default function EnergyScreen() {
  useLearning();
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  const calibration = useStore((s) => s.calibration);
  const checkins = useStore((s) => s.checkins);
  const reactions = useStore((s) => s.reactions);
  const removeCheckIn = useStore((s) => s.removeCheckIn);
  const prefs = useStore((s) => s.settings.notifications);
  const dataMode = useStore((s) => s.settings.dataMode);
  const resetAt = useStore((s) => s.settings.marks[LEARNING_RESET_MARK]);
  const since = typeof resetAt === 'number' ? resetAt : undefined;
  const [allCheckins, setAllCheckins] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const now = a?.now ?? Date.now();
  const eligible = useMemo(() => eligibleCheckins(checkins, now, since), [checkins, now, since]);

  // The same day for an average person with your sleep and nothing from the watch.
  const plain = useMemo(
    () =>
      a
        ? forecastEnergy({
            sleeps: a.sleeps,
            now: a.now,
            wakeTime: a.wakeTime,
            bedtime: a.tonight.bedtime,
            nextWake: a.tonight.wake,
            midSleepMin: a.habitualMidSleepMin,
            debtMin: a.debt.debtMin,
            assumedLastNight: a.energy.assumedLastNight,
          })
        : undefined,
    [a],
  );

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

  // Does measured reaction speed go up and down with the forecast?
  const agreement = useMemo(() => {
    if (!a || reactions.length === 0) return undefined;
    const ctx = calibrationContext(data, a.now);
    const predictor = createKssPredictor(ctx.sleeps, ctx.midSleepMin, (t) => ctx.debtOn(livingDay(t)), ctx.signals);
    return reactionAgreement(reactions, (t) => {
      const kss = predictor.kssAt(t, a.circadian, a.energyWeights);
      return kss === undefined ? undefined : energyFromKss(kss);
    });
  }, [a, data, reactions]);

  if (!a || !plain) {
    return (
      <Screen>
        <Empty icon="lightning-bolt-outline" title="Energy" body="Your energy forecast needs a few nights of sleep. Connect your watch, or look around with demo data.">
          <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }

  const pos = curvePosition(a.energy, a.now);
  const breakdown = a.energyNow;
  const maxPart = Math.max(10, ...(breakdown?.parts.map((p) => Math.abs(p.points)) ?? []));
  const n = eligible.length;
  const target = LEARNING.confidentCheckins;
  const usesWatch = a.energyWeights !== undefined && (Object.keys(a.energyWeights) as (keyof typeof a.energyWeights)[]).some((k) => a.energyWeights[k] !== 0);
  const tier: CalibrationTier = calibration?.tier ?? (calibration?.applied ? 'personal' : usesWatch ? 'watch' : 'population');
  const tiers = calibration?.tiers;
  const withoutWatch = tiers ? Math.max(tiers.population.withinOne, tiers.personal.withinOne) : undefined;
  const withWatch = tiers ? Math.max(tiers.watch.withinOne, tiers['personal+watch'].withinOne) : undefined;
  const use = calibration?.signalUse;
  const useRows = use ? (Object.keys(use) as (SignalKey | 'clock')[]).map((k) => ({ k, v: use[k] ?? 0 })).sort((x, y) => y.v - x.v) : [];
  const maxUse = Math.max(1, ...useRows.map((r) => r.v));
  const findings = calibration ? describeRhythm(calibration.fitted ?? calibration.params) : [];
  const perDay = pingsPerDay(prefs.pingsPerDay, calibration);
  const parts = Object.keys(coverage) as TimeOfDay[];
  const weakest = parts.reduce((x, y) => (coverage[y] < coverage[x] ? y : x));
  const recent = [...checkins].sort((x, y) => y.time - x.time).slice(0, 15);
  const pressure = sleepPressureAt(a.sleeps, a.now);
  const clockToday = a.signals.clock.find((c) => c.date === a.day);
  const cover = a.signals.coverage;
  const lastTest = reactions.length ? reactions[reactions.length - 1] : undefined;
  const lastReading = lastTest ? readReaction(lastTest, reactions.slice(0, -1)) : undefined;
  const differs = a.energy.points.some((p, i) => Math.abs(p.energy - (plain.points[i]?.energy ?? p.energy)) > 0.5);

  const status = !calibration
    ? n >= LEARNING.minCheckins
      ? 'Waiting for the sleep around your check-ins to sync — eepy needs the night before each rating.'
      : `${LEARNING.minCheckins - n} more check-in${LEARNING.minCheckins - n === 1 ? '' : 's'} until eepy can test itself against you. Until then it uses typical values.`
    : `Of the check-ins eepy hadn't seen, ${calibration.accuracy}% were predicted within one point on the 1–9 scale${
        calibration.accuracyBefore !== undefined && calibration.accuracy !== calibration.accuracyBefore ? ` (the plain model: ${calibration.accuracyBefore}%)` : ''
      }.`;

  const backfill = async () => {
    setSyncing(true);
    await runSync({ full: true });
    setSyncing(false);
  };

  return (
    <Screen>
      <Hero
        label="Energy now"
        value={pos ? String(Math.round(pos.energy)) : '–'}
        unit="/ 100"
        color={colors.energy}
        caption={energySentence(a, a.now)}
        right={pos ? <Icon name={pos.trend === 'rising' ? 'trending-up' : pos.trend === 'falling' ? 'trending-down' : 'trending-neutral'} size={30} color={colors.energy} /> : undefined}
      >
        <View style={{ marginTop: space.md }}>
          <EnergyChart points={a.energy.points} now={a.now} dip={a.energy.dip} focusWindows={a.energy.focusWindows} height={180} />
        </View>
      </Hero>

      {breakdown ? (
        <Section title="Why this number">
          <Card>
            <KeyValue label="From your sleep and body clock" sub="Hours awake, last night's sleep, time of day" value={String(breakdown.base)} />
            {breakdown.parts.map((p) => (
              <View key={p.key} style={{ marginTop: space.md }}>
                <Row>
                  <Text style={[font.body, { flex: 1 }]}>{p.label}</Text>
                  {p.points !== 0 ? (
                    <Text style={[font.h3, { color: p.points > 0 ? colors.good : colors.bad, fontVariant: ['tabular-nums'] }]}>
                      {p.points > 0 ? '+' : '−'}
                      {Math.abs(p.points)}
                    </Text>
                  ) : null}
                </Row>
                {p.points !== 0 ? (
                  <View style={{ marginVertical: 6 }}>
                    <SplitBar value={p.points} max={maxPart} />
                  </View>
                ) : null}
                <Text style={font.small}>{p.detail}</Text>
              </View>
            ))}
            <View style={{ marginTop: space.md }}>
              <KeyValue label="Energy now" value={String(breakdown.energy)} color={colors.energy} />
            </View>
          </Card>
        </Section>
      ) : null}

      {a.recoveryAlert ? (
        <Section title="Recovery">
          <RecoveryAlertCard analysis={a} />
        </Section>
      ) : null}

      <Section title="Today">
        <ListCard>
          {a.energy.peaks.length ? <KeyValue label={a.energy.peaks.length > 1 ? 'Peaks' : 'Peak'} value={a.energy.peaks.map((p) => formatTime(p.t)).join(' · ')} /> : null}
          {a.energy.dip ? <KeyValue label="Afternoon dip" value={`${formatTime(a.energy.dip.start)} – ${formatTime(a.energy.dip.end)}`} /> : null}
          <KeyValue label="Sleep pressure" sub={`Builds while you're awake · about ${Math.round(a.sleepPressure.atBedtime * 100)}% at lights-out`} value={`${Math.round(pressure * 100)}%`} />
          {clockToday ? (
            <KeyValue
              label="Body clock"
              sub="From your steps, sleep and heart-rate rhythm"
              value={Math.abs(clockToday.shiftMin) < 10 ? 'On time' : `${Math.abs(clockToday.shiftMin)} min ${clockToday.shiftMin > 0 ? 'late' : 'early'}`}
            />
          ) : null}
          {a.readiness ? <KeyValue label="Recovery" sub={a.readiness.label} value={String(a.readiness.score)} color={scoreColor(a.readiness.score)} /> : null}
        </ListCard>
      </Section>

      <Section title="How well eepy knows you">
        <Card>
          <Row>
            <Stat label="Accuracy" value={calibration?.accuracy !== undefined ? `${calibration.accuracy}%` : '–'} sub="within one point" />
            <Stat label="Check-ins" value={String(n)} sub={n >= target ? 'enough' : `of ${target}`} />
            <Stat label="Days" value={String(calibration?.days ?? new Set(eligible.map((c) => livingDay(c.time))).size)} sub="with ratings" />
          </Row>
          <View style={{ marginTop: space.md }}>
            <Meter value={Math.min(n, target)} max={target} />
          </View>
          <Para>{status}</Para>
          <Para>In use: {TIER_TEXT[tier].toLowerCase()}.</Para>
          <View style={{ marginTop: space.md }}>
            <QuickCheckIn />
          </View>
        </Card>
        {withWatch !== undefined && withoutWatch !== undefined ? (
          <ListCard>
            <KeyValue label="Sleep times only" sub="The forecast before the watch signals" value={`${Math.round(withoutWatch * 100)}%`} />
            <KeyValue label="With your watch" sub="Recovery signals, heart rate, caffeine, body clock" value={`${Math.round(withWatch * 100)}%`} color={withWatch > withoutWatch ? colors.good : colors.text} />
          </ListCard>
        ) : null}
      </Section>

      <Section title="What counts for you">
        <Card>
          {useRows.length && tier !== 'population' && tier !== 'personal' ? (
            <>
              <Text style={font.small}>How much each signal has moved your energy, in points, over your check-ins.</Text>
              {useRows.map(({ k, v }) => (
                <View key={k} style={{ marginTop: space.md }}>
                  <Row>
                    <Text style={[font.body, { flex: 1 }]}>{SIGNAL_LABEL[k]}</Text>
                    <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{v >= 0.05 ? `±${v.toFixed(1)}` : 'no effect'}</Text>
                  </Row>
                  <View style={{ marginTop: 6 }}>
                    <Meter value={v} max={maxUse} color={k === 'caffeine' ? colors.caffeine : colors.accent} />
                  </View>
                </View>
              ))}
            </>
          ) : calibration && (tier === 'population' || tier === 'personal') ? (
            <Text style={font.small}>
              So far the watch signals haven't predicted your ratings better than sleep times alone, so eepy leaves them out. It re-tests this with every new check-in.
            </Text>
          ) : (
            <Text style={font.small}>
              Until there are {LEARNING.minCheckins} check-ins eepy uses typical weights: a rough night in your heart rate, HRV, breathing or deep sleep lowers the day a little, and caffeine lifts it
              (about {Math.round(DEFAULT_WEIGHTS.caffeine * 0.4 * 7.5)} points for a coffee). Your check-ins then set how much each one counts for you.
            </Text>
          )}
        </Card>
      </Section>

      <Section title="What your watch sends">
        {cover.dayHrHours === 0 && dataMode === 'live' ? (
          <Banner
            tone="warn"
            icon="heart-pulse"
            text="No daytime heart rate yet. eepy used to throw it away; one full sync reads it from your history."
            action={syncing ? undefined : 'Sync'}
            onAction={syncing ? undefined : backfill}
          />
        ) : null}
        {syncing ? <ActivityIndicator color={colors.accent} style={{ marginBottom: space.md }} /> : null}
        <ListCard>
          <KeyValue label="Nights with recovery signals" sub="HRV, sleeping heart rate, breathing, deep sleep" value={String(cover.nights)} />
          <KeyValue label="Hours of daytime heart rate" sub="Compared with your usual for the hour" value={String(cover.dayHrHours)} />
          <KeyValue label="Days of body-clock tracking" sub="Steps, sleep and the heart-rate rhythm" value={String(cover.clockDays)} />
        </ListCard>
      </Section>

      <Section title="Reaction test" action={<Link label="Take it" onPress={() => router.push('/reaction')} />}>
        <ListCard>
          <ListRow
            icon="gesture-tap"
            title={lastReading ? `${lastReading.medianMs} ms` : 'One minute, objective'}
            sub={
              lastReading
                ? `${dayLabel(livingDay(lastTest!.time), a.day)} ${formatTime(lastTest!.time)}${lastReading.verdict ? ` · ${REACTION_VERDICT_TEXT[lastReading.verdict].toLowerCase()}` : ''}`
                : 'Tap when the panel lights up. A check on the forecast that does not depend on how you rate yourself.'
            }
            onPress={() => router.push('/reaction')}
          />
        </ListCard>
        {agreement ? (
          <Card>
            <Text style={font.small}>
              {agreement.text} ({agreement.n} tests, correlation {agreement.r.toFixed(2)})
            </Text>
          </Card>
        ) : null}
      </Section>

      <Section title="Your rhythm">
        <Card>
          <RhythmChart population={plain.points} personal={differs ? a.energy.points : undefined} checkins={dots} now={a.now} />
          <Text style={[font.tiny, { marginTop: space.sm }]}>
            {differs ? 'Solid: your forecast. Dashed: an average person with your sleep and no watch signals. ' : ''}Dots: your ratings from the last two weeks, at the time of day you gave them.
          </Text>
          {findings.map((f) => (
            <Para key={f.id}>
              {f.text}
              {calibration?.applied ? '' : ' (tentative)'}
            </Para>
          ))}
        </Card>
      </Section>

      <Section title="Check-ins" action={<Link label="Check in" onPress={() => router.push('/checkin')} />}>
        <Card>
          <Row>
            {parts.map((k) => (
              <Stat key={k} label={PART_LABEL[k]} value={String(coverage[k])} />
            ))}
          </Row>
          <Para>
            {n === 0
              ? 'Rate how alert you feel a few times across the day. Mornings, early afternoons and evenings all matter.'
              : coverage[weakest] < 5
                ? `${PART_LABEL[weakest]} check-ins would help most right now.`
                : 'Good spread across the day.'}{' '}
            {!prefs.pings ? 'Reminders to check in are off (Settings → Notifications).' : perDay === 1 ? 'eepy asks once a day now.' : `eepy asks ${perDay} times a day.`}
          </Para>
        </Card>
        {recent.length ? (
          <ListCard>
            {(allCheckins ? recent : recent.slice(0, 4)).map((c) => (
              <ListRow
                key={c.id}
                title={`${dayLabel(livingDay(c.time), a.day)} ${formatTime(c.time)} · ${c.kss} of 9`}
                sub={`${KSS_LABELS[Math.round(c.kss)] ?? ''}${since !== undefined && c.time < since ? ' · before the reset' : ''}`}
                right={
                  <IconButton
                    icon="trash-can-outline"
                    label="Delete check-in"
                    color={colors.textFaint}
                    onPress={async () => {
                      if (await confirm('Delete check-in?', `${formatTime(c.time)} · ${c.kss} of 9`, 'Delete', true)) removeCheckIn(c.id);
                    }}
                  />
                }
              />
            ))}
            {recent.length > 4 ? <ListRow title={allCheckins ? 'Show fewer' : `Show all ${recent.length}`} onPress={() => setAllCheckins(!allCheckins)} right={<Icon name={allCheckins ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} />} /> : null}
          </ListCard>
        ) : null}
      </Section>

      <Section title="How this works">
        <Fold icon="school-outline" title="Where the number comes from" sub="The model, what the watch adds, and its limits">
          <Text style={font.small}>
            The curve starts from a sleep-science model with three parts: sleep pressure that builds while you're awake and drains while you sleep, a body clock (a 24-hour rhythm with an
            early-afternoon dip), and grogginess right after waking. Sleep debt lowers the whole day.
          </Text>
          <Para>
            Your watch adds four things. Last night's recovery signals (HRV, sleeping heart rate, breathing rate, deep sleep, time awake), each compared with your own last 30 nights. Your heart
            rate during the day, compared with your usual for that hour and that much movement. Caffeine you log. And where your body clock sits today: a model of the clock driven by when you
            slept and moved, and the daily rhythm in your heart rate.
          </Para>
          <Para>
            How much each counts is fitted to your check-ins, starting from typical values. The fit is tested on check-ins it hasn't seen, against the plain model; a signal that doesn't help you
            is switched off. A watch can't measure alertness directly, which is why your ratings — and the reaction test — are what everything is checked against.
          </Para>
        </Fold>
        {calibration?.skipped ? (
          <Banner text={`${calibration.skipped} check-in${calibration.skipped === 1 ? ' was' : 's were'} left out because the sleep before ${calibration.skipped === 1 ? 'it' : 'them'} wasn't recorded.`} />
        ) : null}
      </Section>
    </Screen>
  );
}
