import { useStudio } from "./StudioProvider";

/** Keep a failed save and recovery reachable inside the active modal. */
export function StudioMutationError() {
  const { error, busy, refresh } = useStudio();
  return error ? (
    <div className="studio-error" role="alert">
      <span>{error}</span>
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        Refresh values
      </button>
    </div>
  ) : null;
}
