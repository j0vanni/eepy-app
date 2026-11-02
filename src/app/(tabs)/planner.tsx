/**
 * Planner: the coming week at a glance (tap a day to see or change it), tonight in big type, your
 * usual week (workdays and wake-up times), and occasional tools folded at the bottom.
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
import { WindDownTimelineCard } from '@/ui/cards/WindDownTimeline';
import { Button, Card, Empty, Icon, ListRow, Row, Screen, Section } from '@/ui/components';
import { Disclosure } from '@/ui/Disclosure';
import { RecoveryCard } from '@/ui/planner/calendar';
import { DayCard } from '@/ui/planner/DayCard';
import { TonightPanel } from '@/ui/planner/TonightPanel';
import { BedtimeCalculator, BodyClockNote, CaffeineCurve, ScheduleShift } from '@/ui/planner/tools';
import { UsualWeekCard } from '@/ui/planner/UsualWeek';
import { WeekStrip } from '@/ui/planner/WeekStrip';
import { colors, font, space } from '@/ui/theme';
import { TwoStepMorningCard } from '@/ui/cards/TwoStepMorningCard';

const TOOLS = ['calculator', 'shift', 'caffeine', 'light'] as const;
type ToolId = (typeof TOOLS)[number];
const isTool = (s: string | undefined): s is ToolId => !!s && (TOOLS as readonly string[]).includes(s);

export default function PlannerScreen() {
  const a = useAnalysis();
  const { show, date } = useLocalSearchParams<{ show?: string; date?: string }>();
  const skippedDate = useStore((s) => s.settings.marks[WAKE_SKIP_MARK]);
  const twoStepOn = useStore((s) => !!s.profile.twoStepMorning?.enabled);
  const scroll = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Record<string, number>>({});
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState<Partial<Record<ToolId, boolean>>>({});

  // Opened from search or a link: select / open what was asked for, then scroll to it.
  useEffect(() => {
    if (!show && !date) return;
    if (date) setSelected(date);
    if (isTool(show)) setOpen((o) => ({ ...o, [show]: true }));
    const target = isTool(show) ? `tool:${show}` : show === 'week' ? 'week' : show === 'tonight' ? 'tonight' : 'top';
    const id = setTimeout(() => {
      const y = target.startsWith('tool:') ? (offsets.current.tools ?? 0) + (offsets.current[target] ?? 0) : (offsets.current[target] ?? 0);
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
    <View onLayout={at('week')}>
      <Section title="Your usual week">
        <UsualWeekCard />
        <TwoStepMorningCard />
      </Section>
    </View>
  );

  const monthButton = <Button small kind="secondary" icon="calendar-month-outline" label="Month view" onPress={() => router.push('/calendar')} />;

  if (!a) {
    return (
      <Screen title="Planner" subtitle="Your sleep plan for the week ahead" right={monthButton} scrollRef={scroll}>
        <Empty
          icon="calendar-clock"
          title="Your plan appears after the first night"
          body="Once eepy has a night of sleep data it plans each night's lights-out, the alarm and your caffeine cut-off. You can already set your usual week below."
        />
        {usualWeek}
      </Screen>
    );
  }

  const week = a.upcoming.slice(0, 7);
  const tonightDate = a.tonight.wakeDate;
  const selectedNight = selected ? a.upcoming.find((n) => n.wakeDate === selected) : undefined;

  return (
    <Screen title="Planner" subtitle="Your sleep plan for the week ahead" right={monthButton} scrollRef={scroll}>
      <View onLayout={at('top')}>
        <WeekStrip nights={week} selected={selected ?? ''} onSelect={(d) => setSelected(d === selected ? undefined : d)} skippedDate={typeof skippedDate === 'string' ? skippedDate : undefined} />
      </View>
      <View style={{ marginTop: space.md }}>
        {selectedNight ? (
          <DayCard night={selectedNight} needMin={a.need.needMin} isTonight={selectedNight.wakeDate === tonightDate} skippedDate={typeof skippedDate === 'string' ? skippedDate : undefined} />
        ) : (
          <Row gap={space.sm} style={{ paddingHorizontal: 2 }}>
            <Icon name="gesture-tap" size={18} color={colors.accent} />
            <Text style={[font.small, { flex: 1 }]}>{`Tap a day to see its plan, change its wake-up${twoStepOn ? ', skip the routine alarm' : ''} or make it a free day.`}</Text>
          </Row>
        )}
      </View>

      <View onLayout={at('tonight')}>
        <Section title="Tonight">
          <TonightPanel a={a} />
          <WindDownTimelineCard a={a} compact />
          <RecoveryCard nights={a.upcoming} debtMin={a.debt.debtMin} />
        </Section>
      </View>

      {usualWeek}

      <View onLayout={at('tools')}>
        <Section title="More planning tools">
          <View onLayout={at('tool:calculator')}>
            <Disclosure icon="calculator-variant-outline" title="Bedtime calculator" sub="When to go to bed for a wake-up time — or the reverse" open={!!open.calculator} onToggle={() => toggle('calculator')}>
              <BedtimeCalculator a={a} />
            </Disclosure>
          </View>
          <View onLayout={at('tool:shift')}>
            <Disclosure icon="arrow-left-right" title="Move your schedule" sub="Wake up earlier or later for good, a little each day" open={!!open.shift} onToggle={() => toggle('shift')}>
              <ScheduleShift a={a} />
            </Disclosure>
          </View>
          <View onLayout={at('tool:caffeine')}>
            <Disclosure
              icon="coffee-outline"
              color={colors.caffeine}
              title="Caffeine in your system"
              sub={a.caffeine.cutoff.cutoff ? `Today's last coffee by ${formatTime(a.caffeine.cutoff.cutoff)}` : 'How much is left, and your cut-off'}
              open={!!open.caffeine}
              onToggle={() => toggle('caffeine')}
            >
              <CaffeineCurve a={a} />
            </Disclosure>
          </View>
          <View onLayout={at('tool:light')}>
            <Disclosure icon="brightness-6" color={colors.light} title="Phone light" sub="How bright your screen should be this evening" open={!!open.light} onToggle={() => toggle('light')}>
              <ScreenLightCard a={a} full embedded />
            </Disclosure>
          </View>
          <Card>
            <ListRow icon="tune-variant" title="What if?" sub="Try a bedtime, nap or coffee and see how tomorrow changes" onPress={() => router.push('/simulate')} />
            <ListRow icon="airplane-clock" title="Jet lag planner" sub="A day-by-day plan for crossing time zones" onPress={() => router.push('/jetlag')} />
          </Card>
          <BodyClockNote a={a} />
        </Section>
      </View>
    </Screen>
  );
}
