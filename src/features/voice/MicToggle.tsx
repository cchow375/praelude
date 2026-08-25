import "./MicToggle.css";

export type MicToggleProps = {
  status: "live" | "muted" | "down";
  onToggle: (muted: boolean) => void;
};

/** The mic mute control. Always visible in the nav rail — §4b: the thing you
 * practise with is not allowed to hide. The backend has been able to mute
 * since v6 (`voice_loop.rs:1300`); until now nothing could reach it. */
export function MicToggle({ status, onToggle }: MicToggleProps) {
  const muted = status === "muted";
  const down = status === "down";
  return (
    <button
      type="button"
      className={`mic-toggle ${muted ? "is-muted" : ""} ${down ? "is-down" : ""}`}
      aria-pressed={muted}
      aria-label={
        muted ? "Mic muted — click to unmute" : "Mic listening — click to mute"
      }
      disabled={down}
      title={down ? "Voice is not running" : undefined}
      onClick={() => onToggle(!muted)}
    >
      <span className="mic-toggle-glyph" aria-hidden="true">
        {muted ? "🔇" : "🎙"}
      </span>
      <span className="mic-toggle-label">{muted ? "Muted" : "Mic"}</span>
    </button>
  );
}
