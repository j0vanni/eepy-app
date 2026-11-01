// Old route: the Plan tab is now the Planner tab. Kept so old links and bookmarks still land somewhere.
import { Redirect } from 'expo-router';

export default function PlanRedirect() {
  return <Redirect href="/planner" />;
}
