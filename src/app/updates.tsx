// App updates (opened from the "build N is ready" notification, the update banner and More).
import { Screen } from '@/ui/components';
import { UpdatesSection } from '@/ui/settings/UpdatesSection';

export default function UpdatesScreen() {
  return (
    <Screen>
      <UpdatesSection />
    </Screen>
  );
}
