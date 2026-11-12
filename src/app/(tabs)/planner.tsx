/**
 * Plan: tonight as the big number (lights-out, with wind-down and the alarm under it), the one
 * action (adjust tonight), tonight's options, the week ahead (tap a day), your usual week, and the
 * occasional tools as folded rows.
 * Params (from search and links): `show` = tonight | week | calculator | shift | caffeine | light
 * scrolls there (and opens that tool); `date` = a coming morning to select.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, ScrollViewInstance, Text, View } from 'react-native';

import { formatTime } from '@/engine/time';
import { WAKE_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { ScreenLightCard } from '@/ui/cards/ScreenLightCard';
import { Empty, Fold, IconButton, Link, ListRow, Screen, Section } from '@/ui/components';
import { DayCard } from '@/ui/planner/DayCard';
import { AdjustTonightButton } from '@/ui/planner/DayPlan';
import { Rows } from '@/ui/planner/parts';
import { PlanOptionsCard } from '@/ui/planner/PlanOptions';
import { TonightDetails, TonightHero } from '@/ui/planner/TonightPanel';
import { BedtimeCalculator, BodyClockRows, CaffeineCurve, hasBodyClock, ScheduleShift } from '@/ui/planner/tools';
import { UsualWeekCard } from '@/ui/planner/UsualWeek';
import { WeekStrip } from '@/ui/planner/WeekStrip';
import { font, space } from '@/ui/theme';

const TOOLS = ['calculator', 'shift', 'caffeine', 'light'] as const;
type ToolId = (typeof TOOLS)[number];
const isTool = (s: string | undefined): s is ToolId => !!s && (TOOLS as readonly string[]).includes(s);

export default function PlanScreen() {
  const a = useAnalysis();
  const { show, date } = useLocalSearchParams<{ show?: string; date?: string }>();
  const skippedMark = useStore((s) => s.settings.marks[WAKE_SKIP_MARK]);
  const skippedDate = typeof skippedMark === 'string' ? skippedMark : undefined;
  const twoStepOn = useStore((s) => !!s.profile.twoStepMorning?.enabled);
  const scroll = useRef<ScrollViewInstance>(null);
  // Where each part sits: sections on the page, the tools panel in its section, each tool in the panel.
  const offsets = useRef<Record<string, number>>({});
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState<Partial<Record<ToolId, boolean>>>({});

  // Opened from search or a link: select / open what was asked for, then scroll to it.
  useEffect(() => {
    if (!show && !date) return;
    if (date) setSelected(date);
    if (isTool(show)) setOpen((o) => ({ ...o, [show]: true }));
    const id = setTimeout(() => {
      const o = offsets.current;
      const y = isTool(show)
        ? (o.tools ?? 0) + space.xl + (o.toolsPanel ?? 0) + (o[`tool:${show}`] ?? 0)
        : show === 'week'
          ? (o.usual ?? 0)
          : show !== 'tonight' && date
            ? (o.days ?? 0)
            : 0;
      scroll.current?.scrollTo({ y: Math.max(0, y - space.sm), animated: true });
      router.setParams({ show: undefined, date: undefined });
    }, 150);
    return () => clearTimeout(id);
  }, [show, date]);

  const at = (key: string) => (e: LayoutChangeEvent) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };
  const toggle = (t: ToolId) => setOpen((o) => ({ ...o, [t]: !o[t] }));

  const usualWeek = (
    <View onLayout={at('usual')}>
      <Section title="Your usual week">
        <UsualWeekCard />
      </Section>
    </View>
  );
  const month = <IconButton icon="calendar-month-outline" label="Month view" onPress={() => router.push('/calendar')} />;

  if (!a) {
    return (
      <Screen title="Plan" subtitle="Tonight and the week ahead" right={month} scrollRef={scroll}>
        <Empty
          icon="calendar-clock"
          title="Your plan appears after the first night"
          body="With one night of sleep data eepy plans each night's lights-out, the alarm and your caffeine cut-off. You can already set your usual week."
        />
        {usualWeek}
      </Screen>
    );
  }

  const week = a.upcoming.slice(0, 7);
  const selectedNight = selected ? a.upcoming.find((n) => n.wakeDate === selected) : undefined;
  const cutoff = a.caffeine.cutoff.cutoff;

  return (
    <Screen title="Plan" subtitle="Tonight and the week ahead" right={month} scrollRef={scroll}>
      <TonightHero a={a} />
      <AdjustTonightButton primary />

      <PlanOptionsCard a={a} />
      <TonightDetails a={a} />

      <View onLayout={at('days')}>
        <Section title="The week ahead" action={<Link label="Month view" onPress={() => router.push('/calendar')} />}>
          <WeekStrip nights={week} selected={selected ?? ''} onSelect={(d) => setSelected(d === selected ? undefined : d)} skippedDate={skippedDate} />
          <View style={{ marginTop: space.md }}>
            {selectedNight ? (
              <DayCard night={selectedNight} needMin={a.need.needMin} isTonight={selectedNight.wakeDate === a.tonight.wakeDate} skippedDate={skippedDate} />
            ) : (
              <Text style={[font.small, { paddingHorizontal: space.xs }]}>{`Tap a day to see why, change its wake-up${twoStepOn ? ', skip the routine alarm' : ''} or make it a free day.`}</Text>
            )}
          </View>
        </Section>
      </View>

      {usualWeek}

      <View onLayout={at('tools')}>
        <Section title="Tools">
          <View onLayout={at('toolsPanel')}>
            <Rows
              onRowLayout={(key, y) => {
                offsets.current[`tool:${key}`] = y;
              }}
              rows={[
                {
                  key: 'calculator',
                  node: (
                    <Fold bare icon="calculator-variant-outline" title="Bedtime calculator" sub="When to go to bed for a wake-up time, or the reverse" open={!!open.calculator} onToggle={() => toggle('calculator')}>
                      <BedtimeCalculator a={a} />
                    </Fold>
                  ),
                },
                {
                  key: 'shift',
                  node: (
                    <Fold bare icon="arrow-left-right" title="Move your schedule" sub="Wake up earlier or later for good, a little each day" open={!!open.shift} onToggle={() => toggle('shift')}>
                      <ScheduleShift a={a} />
                    </Fold>
                  ),
                },
                {
                  key: 'caffeine',
                  node: (
                    <Fold
                      bare
                      icon="coffee-outline"
                      title="Caffeine in your system"
                      sub={cutoff ? `Today's last coffee by ${formatTime(cutoff)}` : 'How much is left, and your cut-off'}
                      open={!!open.caffeine}
                      onToggle={() => toggle('caffeine')}
                    >
                      <CaffeineCurve a={a} />
                    </Fold>
                  ),
                },
                {
                  key: 'light',
                  node: (
                    <Fold bare icon="brightness-6" title="Phone light" sub="How bright your screen should be this evening" open={!!open.light} onToggle={() => toggle('light')}>
                      <ScreenLightCard a={a} full embedded />
                    </Fold>
                  ),
                },
                hasBodyClock(a) && {
                  key: 'clock',
                  node: (
                    <Fold bare icon="clock-outline" title="Your body clock tonight" sub="When your body is ready for sleep">
                      <BodyClockRows a={a} />
                    </Fold>
                  ),
                },
                { key: 'simulate', node: <ListRow icon="tune-variant" title="What if?" sub="Try a bedtime, nap or coffee and see tomorrow" onPress={() => router.push('/simulate')} /> },
                { key: 'jetlag', node: <ListRow icon="airplane-clock" title="Jet lag" sub="A day-by-day plan for crossing time zones" onPress={() => router.push('/jetlag')} /> },
              ]}
            />
          </View>
        </Section>
      </View>
    </Screen>
  );
}
