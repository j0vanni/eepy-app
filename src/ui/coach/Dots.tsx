import { Pressable, Text, View } from 'react-native';

import type { DayStatus, ExperimentDay } from '../../engine/experiments';
import type { GoalDay, GoalDayStatus } from '../../engine/goals';
import { Icon } from '../components';
import { weekdayInitial } from '../format';
import { colors, font, space } from '../theme';

const EXP_STYLE: Record<DayStatus, { bg: string; border: string; fg: string; icon?: string }> = {
  kept: { bg: colors.good, border: colors.good, fg: '#0B1020', icon: 'check' },
  missed: { bg: '#3A1B2A', border: colors.bad, fg: colors.bad, icon: 'close' },
  unknown: { bg: 'transparent', border: colors.warn, fg: colors.warn, icon: 'help' },
  today: { bg: colors.accentSoft, border: colors.accent, fg: colors.text },
  upcoming: { bg: 'transparent', border: colors.border, fg: colors.textFaint },
};

/** Day-by-day experiment progress. Finished days can be tapped to change the answer. */
export function ExperimentDots({ days, size = 30, onPressDay }: { days: ExperimentDay[]; size?: number; onPressDay?: (d: ExperimentDay) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {days.map((d) => {
        const st = EXP_STYLE[d.status];
        const tappable = !!onPressDay && (d.status === 'kept' || d.status === 'missed' || d.status === 'unknown' || d.status === 'today');
        return (
          <Pressable
            key={d.date}
            disabled={!tappable}
            onPress={() => onPressDay?.(d)}
            accessibilityLabel={`Day ${d.index + 1}: ${d.status}`}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: st.bg,
              borderWidth: 1.5,
              borderColor: st.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {st.icon ? (
              <Icon name={st.icon} size={size * 0.5} color={st.fg} />
            ) : (
              <Text style={{ color: st.fg, fontSize: size * 0.38, fontWeight: '700' }}>{d.index + 1}</Text>
            )}
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
    ['unknown', 'Needs answer'],
    ['today', 'Today'],
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm }}>
      {items.map(([k, l]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: EXP_STYLE[k].bg, borderWidth: 1.5, borderColor: EXP_STYLE[k].border }} />
          <Text style={font.tiny}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

const GOAL_STYLE: Record<GoalDayStatus, { bg: string; border: string }> = {
  met: { bg: colors.good, border: colors.good },
  missed: { bg: '#3A1B2A', border: colors.bad },
  unknown: { bg: 'transparent', border: colors.border },
  pending: { bg: 'transparent', border: colors.accent },
};

/** Compact strip of goal days (oldest → newest) with weekday initials. */
export function GoalDots({ days, size = 16, labels = true }: { days: GoalDay[]; size?: number; labels?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {days.map((d) => (
        <View key={d.date} style={{ alignItems: 'center', gap: 3 }}>
          <View
            accessibilityLabel={`${d.date}: ${d.status}`}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: GOAL_STYLE[d.status].bg, borderWidth: 1.5, borderColor: GOAL_STYLE[d.status].border }}
          />
          {labels ? <Text style={[font.tiny, { fontSize: 9 }]}>{weekdayInitial(d.date)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export const GOAL_STATUS_TEXT: Record<GoalDayStatus, { label: string; color: string; icon: string }> = {
  met: { label: 'Done', color: colors.good, icon: 'check-circle' },
  missed: { label: 'Missed', color: colors.bad, icon: 'close-circle' },
  unknown: { label: 'No data', color: colors.textFaint, icon: 'help-circle-outline' },
  pending: { label: 'Today', color: colors.accent, icon: 'circle-outline' },
};
