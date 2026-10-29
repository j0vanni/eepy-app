// Settings slot: the insomnia programme and reports/export.
import { router } from 'expo-router';
import { useMemo } from 'react';

import { CBTI_WEEKS, cbtiStatus } from '@/engine/cbti';
import { formatClock } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, ListRow, Section } from '@/ui/components';

export function ProgramsSection() {
  const a = useAnalysis();
  const program = useStore((s) => s.cbti);
  const status = useMemo(() => (a && program?.active ? cbtiStatus(program, a.nights, a.day) : undefined), [a, program]);

  const cbtiSub = status
    ? `${status.maintenance ? `Week ${status.week}, maintenance` : `Week ${status.week} of ${CBTI_WEEKS}`} · in bed ${formatClock(status.bedMin)}–${formatClock(status.wakeMin)}`
    : program?.stoppedAt
      ? 'Stopped · start again any time'
      : 'Not started · 6-week sleep-restriction programme (CBT-I)';

  return (
    <Section title="Programmes & reports">
      <Card>
        <ListRow icon="account-heart" title="Insomnia programme" sub={cbtiSub} onPress={() => router.push('/cbti')} />
        <ListRow icon="file-chart-outline" title="Reports & export" sub="PDF report for you or your doctor · CSV of every night" onPress={() => router.push('/export')} />
      </Card>
    </Section>
  );
}
