// App updates (opened from the "build N is ready" notification and the update banner).
import { Screen } from '@/ui/components';
import { UpdatesSection } from '@/ui/settings/UpdatesSection';

export default function UpdatesScreen() {
  return (
    <Screen>
      <UpdatesSection title="This phone" />
    </Screen>
  );
}
