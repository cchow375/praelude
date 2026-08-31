import "./MicToggle.css";

export type MicToggleProps = {
  status: "live" | "muted" | "down";
  onToggle: (muted: boolean) => void;
  /** Backend recovery/capability guidance for an unavailable mic. */
  downGuidance?: string | null;
  /** A temporary practice mode may own the mic gate to prevent voice writes. */
  lockedReason?: string | null;
};

/** The mic mute control. Always visible in the nav rail — §4b: the thing you
 * practise with is not allowed to hide. The backend has been able to mute
 * since v6 (`voice_loop.rs:1300`); until now nothing could reach it. */
export function MicToggle({
  status,
  onToggle,
  downGuidance = null,
  lockedReason = null,
}: MicToggleProps) {
  const muted = status === "muted";
  const down = status === "down";
  const label = down
    ? "Mic unavailable"
    : muted
      ? "Mic muted — click to unmute"
      : "Mic listening — click to mute";
  return (
    <button
      type="button"
      className={`mic-toggle ${muted ? "is-muted" : ""} ${down ? "is-down" : ""}`}
      aria-pressed={muted}
      aria-label={label}
      disabled={down || lockedReason != null}
      title={
        down
          ? (downGuidance ?? "Hands-free voice is unavailable.")
          : (lockedReason ?? undefined)
      }
      onClick={() => onToggle(!muted)}
    >
      <span className="mic-toggle-glyph" aria-hidden="true">
        {muted ? "🔇" : "🎙"}
      </span>
      <span className="mic-toggle-label">
        {down ? "Unavailable" : muted ? "Muted" : "Mic"}
      </span>
    </button>
  );
}
