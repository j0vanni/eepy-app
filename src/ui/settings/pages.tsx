/** What each Settings page (/settings/<id>, listed in sections.ts) shows, built from the section components. */
import { CalendarSection } from './CalendarSection';
import { AboutSection } from './AboutSection';
import { CaffeineSection } from './CaffeineSection';
import { DataSourcesSection, YourDataSection } from './DataSection';
import { EReaderSection } from './EReaderSection';
import { LearningSection } from './LearningSection';
import { BackgroundSection, NotificationsSection, WakeAlarmSection } from './NotificationsSection';
import { AboutYouSection, SleepNeedSection } from './ProfileSection';
import { ProgramsSection } from './ProgramsSection';
import type { SettingsSectionId } from './sections';
import { SelfChecksCard } from './SelfChecks';
import { ShortcutsSection } from './ShortcutsSection';
import { SleepModeSection } from './SleepModeSection';
import { UpdatesSection } from './UpdatesSection';
import { WatchSection } from './WatchSection';
import { WindDownLengthSection, WindDownSection } from './WindDownSection';
import { Section } from '../components';

export function SettingsPage({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case 'you':
      return (
        <>
          <AboutYouSection />
          <SleepNeedSection />
          <CalendarSection />
          <Section title="Self-checks">
            <SelfChecksCard />
          </Section>
          <ProgramsSection />
        </>
      );
    case 'alarms':
      return (
        <>
          <WakeAlarmSection />
          <WatchSection />
        </>
      );
    case 'notifications':
      return (
        <>
          <NotificationsSection />
          <BackgroundSection />
          <LearningSection />
          <ShortcutsSection />
        </>
      );
    case 'winddown':
      return (
        <>
          <WindDownLengthSection />
          <WindDownSection />
          <EReaderSection />
          <SleepModeSection />
        </>
      );
    case 'caffeine':
      return <CaffeineSection />;
    case 'data':
      return (
        <>
          <DataSourcesSection />
          <YourDataSection />
        </>
      );
    case 'updates':
      return <UpdatesSection />;
    case 'about':
      return <AboutSection />;
  }
}
