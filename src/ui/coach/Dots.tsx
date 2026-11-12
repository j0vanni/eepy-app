/**
 * Day-by-day marks for experiments and goals. Shape carries the meaning as well as colour:
 * filled = kept / met, a cross or a red ring = missed, grey = no data, an amber ring = today.
 */
import { Pressable, Text, View } from 'react-native';

import type { DayStatus, ExperimentDay } from '../../engine/experiments';
import type { GoalDay, GoalDayStatus } from '../../engine/goals';
import { Icon } from '../components';
import { weekdayInitial } from '../format';
import { colors, font, space } from '../theme';

const EXP_STYLE: Record<DayStatus, { bg: string; ring?: string; fg: string; icon?: string }> = {
  kept: { bg: colors.good, fg: colors.onAccent, icon: 'check' },
  missed: { bg: colors.surfaceAlt, fg: colors.bad, icon: 'close' },
  unknown: { bg: colors.surfaceAlt, fg: colors.warn, icon: 'help' },
  today: { bg: colors.accentSoft, ring: colors.accent, fg: colors.text },
  upcoming: { bg: colors.surfaceAlt, fg: colors.textFaint },
};

/** Day-by-day experiment progress. Finished days can be tapped to change the answer. */
export function ExperimentDots({ days, size = 30, onPressDay }: { days: ExperimentDay[]; size?: number; onPressDay?: (d: ExperimentDay) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm - 2 }}>
      {days.map((d) => {
        const st = EXP_STYLE[d.status];
        const tappable = !!onPressDay && (d.status === 'kept' || d.status === 'missed' || d.status === 'unknown' || d.status === 'today');
        return (
          <Pressable
            key={d.date}
            disabled={!tappable}
            onPress={() => onPressDay?.(d)}
            hitSlop={tappable ? 6 : undefined}
            accessibilityRole={tappable ? 'button' : undefined}
            accessibilityLabel={`Day ${d.index + 1}: ${d.status}`}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: st.bg,
              borderWidth: st.ring ? 1.5 : 0,
              borderColor: st.ring,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {st.icon ? <Icon name={st.icon} size={size * 0.5} color={st.fg} /> : <Text style={[font.tiny, { color: st.fg, fontWeight: '700', fontSize: size * 0.38, lineHeight: size * 0.5 }]}>{d.index + 1}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ExperimentLegend() {
  const items: [DayStatus, string][] = [
    ['kept', 'Kept'],
    ['missed', 'Missed'],
    ['unknown', 'Needs an answer'],
    ['today', 'Today'],
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs, marginTop: space.sm }}>
      {items.map(([k, l]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {EXP_STYLE[k].icon ? (
            <Icon name={EXP_STYLE[k].icon!} size={12} color={k === 'kept' ? colors.good : EXP_STYLE[k].fg} />
          ) : (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: EXP_STYLE[k].bg, borderWidth: 1.5, borderColor: EXP_STYLE[k].ring }} />
          )}
          <Text style={font.tiny}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

const GOAL_STYLE: Record<GoalDayStatus, { bg: string; ring?: string }> = {
  met: { bg: colors.good },
  missed: { bg: 'transparent', ring: colors.bad },
  unknown: { bg: colors.border },
  pending: { bg: 'transparent', ring: colors.accent },
};

/** Compact strip of goal days (oldest → newest) with weekday initials. */
export function GoalDots({ days, size = 16, labels = true }: { days: GoalDay[]; size?: number; labels?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {days.map((d) => (
        <View key={d.date} style={{ alignItems: 'center', gap: 3 }}>
          <View
            accessibilityLabel={`${d.date}: ${d.status}`}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: GOAL_STYLE[d.status].bg, borderWidth: GOAL_STYLE[d.status].ring ? 1.5 : 0, borderColor: GOAL_STYLE[d.status].ring }}
          />
          {labels ? <Text style={font.tiny}>{weekdayInitial(d.date)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** What the goal marks mean, in one line. */
export const GOAL_LEGEND = 'Green: met · red ring: missed · grey: no data · amber ring: today, still to come.';

export const GOAL_STATUS_TEXT: Record<GoalDayStatus, { label: string; color: string; icon: string }> = {
  met: { label: 'Done', color: colors.good, icon: 'check-circle' },
  missed: { label: 'Missed', color: colors.bad, icon: 'close-circle' },
  unknown: { label: 'No data', color: colors.textFaint, icon: 'help-circle-outline' },
  pending: { label: 'Today', color: colors.accent, icon: 'circle-outline' },
};
