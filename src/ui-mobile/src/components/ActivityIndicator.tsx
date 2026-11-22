import { ACTIVITY_LABELS } from "../services/activity";
import type { ActivityDisplay } from "../types";

export function ActivityIndicator(props: { display: ActivityDisplay | null }) {
  const { display } = props;
  if (display === null) return null;
  return (
    <span
      className={"activity activity--" + display}
      role="img"
      aria-label={ACTIVITY_LABELS[display]}
    />
  );
}
