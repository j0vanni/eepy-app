// Old route: "/plan" became the Plan tab at "/planner". Kept so old links and bookmarks still land somewhere.
import { Redirect } from 'expo-router';

export default function PlanRedirect() {
  return <Redirect href="/planner" />;
}
