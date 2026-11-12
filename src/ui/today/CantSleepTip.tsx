/** The night view's "Can't sleep?" line: get up after ~20 min — on your e-reader, when you read on one. */
import { Text } from 'react-native';

import { eReaderGetUpTip, eReaderIfOn } from '@/engine/eReader';
import { useStore } from '@/state/store';
import { font, night } from '@/ui/theme';

export function CantSleepTip() {
  const eReader = eReaderIfOn(useStore((s) => s.settings.eReader));
  return (
    <Text style={[font.small, { color: night.textDim }]}>
      {eReader ? `Slow breathing, soft noise. Awake 20+ min? ${eReaderGetUpTip(eReader)}` : 'Slow breathing, soft noise. Awake 20+ min? Get up in dim light until sleepy.'}
    </Text>
  );
}
