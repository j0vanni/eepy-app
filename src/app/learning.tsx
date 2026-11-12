import { Redirect } from 'expo-router';

/** "Your body clock" moved into the Energy screen (old links and notifications still land here). */
export default function LearningRedirect() {
  return <Redirect href="/energy" />;
}
