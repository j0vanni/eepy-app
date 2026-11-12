// Today: the running insomnia programme in one row, or a nudge when the insomnia check suggests it.
import { router } from 'expo-router';
import { useMemo } from 'react';

import type { Analysis } from '@/engine/analysis';
import { cbtiStatus } from '@/engine/cbti';
import { formatClock } from '@/engine/time';
import { useStore } from '@/state/store';
import { ListCard, ListRow } from '@/ui/components';

export function CbtiCard({ analysis }: { analysis: Analysis }) {
  const program = useStore((s) => s.cbti);
  const isi = useStore((s) => s.profile.screenings.isi?.score);
  const status = useMemo(() => (program?.active ? cbtiStatus(program, analysis.nights, analysis.day) : undefined), [program, analysis.nights, analysis.day]);

  if (status) {
    const eff = status.current.efficiency ?? status.lastCompleted?.efficiency;
    return (
      <ListCard>
        <ListRow
          icon="account-heart-outline"
          title={`Insomnia programme · week ${status.week}`}
          sub={`In bed ${formatClock(status.bedMin)} – ${formatClock(status.wakeMin)}${eff !== undefined ? ` · efficiency ${Math.round(eff * 100)}%` : ''}`}
          onPress={() => router.push('/cbti')}
        />
      </ListCard>
    );
  }

  if (isi !== undefined && isi >= 15) {
    return (
      <ListCard>
        <ListRow icon="account-heart-outline" title="Sleep could get easier" sub="A 6-week insomnia programme, built on your watch data" onPress={() => router.push('/cbti')} />
      </ListCard>
    );
  }

  return null;
}
