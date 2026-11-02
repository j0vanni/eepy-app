import { router } from 'expo-router';
import { createContext } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './components';
import { EnterView } from './motion';
import { colors } from './theme';

export const FAB_SIZE = 58;

/**
 * Lets a tab screen dim the floating button and tab bar (Today's night view sets it while focused),
 * so nothing bright is left on screen after lights-out.
 */
export const NightChromeContext = createContext<(night: boolean) => void>(() => undefined);

/** Floating "+" over the tab screens that opens the quick check-in sheet. */
export function QuickCheckInButton({ bottom, right = 18, night = false }: { bottom: number; right?: number; night?: boolean }) {
  return (
    <EnterView style={[styles.wrap, { bottom, right }]}>
      <Pressable
        onPress={() => router.push('/checkin')}
        accessibilityRole="button"
        accessibilityLabel="Quick check-in"
        accessibilityHint="Log sleepiness, energy, coffee or a tag"
        style={({ pressed }) => [styles.fab, night ? styles.fabNight : null, pressed && { transform: [{ scale: 0.94 }], opacity: 0.92 }]}
      >
        <Icon name="plus" size={30} color={night ? colors.textDim : colors.onAccent} />
      </Pressable>
    </EnterView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabNight: { backgroundColor: '#1A1838', borderWidth: 1, borderColor: '#2A2752', elevation: 0, shadowOpacity: 0 },
});
