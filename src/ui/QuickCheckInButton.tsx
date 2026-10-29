import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './components';
import { EnterView } from './motion';
import { colors } from './theme';

export const FAB_SIZE = 58;

/** Floating "+" over the tab screens that opens the quick check-in sheet. */
export function QuickCheckInButton({ bottom, right = 18 }: { bottom: number; right?: number }) {
  return (
    <EnterView style={[styles.wrap, { bottom, right }]}>
      <Pressable
        onPress={() => router.push('/checkin')}
        accessibilityRole="button"
        accessibilityLabel="Quick check-in"
        accessibilityHint="Log sleepiness, energy, coffee or a tag"
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }], opacity: 0.92 }]}
      >
        <Icon name="plus" size={30} color="#140F33" />
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
});
