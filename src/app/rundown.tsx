import { useAnalysis } from '@/state/useAnalysis';
import { RundownPlayer } from '@/ui/rundown/Player';
import { Empty, Screen } from '@/ui/components';

/** "Start my rundown": tonight's bedtime rundown, one step at a time, ending with "I'm in bed". */
export default function RundownScreen() {
  const analysis = useAnalysis();
  return (
    <Screen tone="night">
      {analysis ? <RundownPlayer a={analysis} /> : <Empty icon="format-list-checks" title="No plan for tonight yet" body="Sync a few nights from your watch (or load the demo) and eepy builds your bedtime rundown from tonight's lights-out." />}
    </Screen>
  );
}
