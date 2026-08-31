import type { RepReplayController } from "./useRepReplay";
import { PianoPlayback } from "./PianoPlayback";
import { ConfirmDelete } from "../../../components/ConfirmDelete";
import "./repReplay.css";

function durationLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RepReplayControl({
  replay,
  available = true,
  unavailableReason = null,
}: {
  replay: RepReplayController;
  available?: boolean;
  unavailableReason?: string | null;
}) {
  if (!available) {
    return (
      <section
        className="rep-replay"
        aria-label="Listen-back verdict"
        data-compact-visible="true"
      >
        <div className="rep-replay-unavailable" role="note">
          <strong>Listen Back unavailable</strong>
          <small>
            {unavailableReason ??
              "Listen Back is unavailable while hands-free voice is down."}
          </small>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rep-replay${replay.enabled ? " is-enabled" : ""}`}
      aria-label="Listen-back verdict"
      data-compact-visible="true"
    >
      <label className="rep-replay-toggle">
        <input
          type="checkbox"
          checked={replay.enabled}
          disabled={replay.phase === "saving"}
          onChange={(event) => replay.setEnabled(event.target.checked)}
        />
        <span>
          <strong>Review each rep by listening back</strong>
          <small>Records the next take automatically; voice pauses for safety</small>
        </span>
      </label>

      {replay.enabled && (
        <div className="rep-replay-body">
          {(replay.phase === "idle" || replay.phase === "requesting") && (
            <button
              type="button"
              className="rep-replay-record"
              disabled={replay.phase === "requesting"}
              onClick={() => void replay.start()}
            >
              {replay.phase === "requesting" ? "Opening mic…" : "Start next take"}
            </button>
          )}
          {replay.phase === "recording" && (
            <div className="rep-replay-recording">
              <button
                type="button"
                className="rep-replay-stop"
                onClick={replay.stop}
              >
                <span aria-hidden="true" /> Finish take
              </button>
              <small>
                Play now. Space or any verdict button also finishes this take;
                judge after listening.
              </small>
            </div>
          )}
          {(replay.phase === "review" || replay.phase === "saving") &&
            replay.takeUrl && (
              <div className="rep-replay-review">
                <PianoPlayback
                  src={replay.takeUrl}
                  onEnded={replay.markReviewed}
                />
                <div className="rep-replay-review-row">
                  {replay.verdictCommitted ? (
                    <>
                      <button
                        type="button"
                        disabled={replay.phase === "saving"}
                        onClick={() => void replay.retryKeep()}
                      >
                        {replay.phase === "saving" ? "Saving…" : "Retry keep"}
                      </button>
                      <button
                        type="button"
                        disabled={replay.phase === "saving"}
                        onClick={replay.discard}
                      >
                        Don’t keep audio
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={replay.markReviewed}>
                        {replay.reviewed ? "Listened ✓" : "I listened"}
                      </button>
                      <label>
                        <input
                          type="checkbox"
                          checked={replay.keep}
                          disabled={replay.phase === "saving"}
                          onChange={(event) => replay.setKeep(event.target.checked)}
                        />
                        Keep after verdict
                      </label>
                      <button
                        type="button"
                        disabled={replay.phase === "saving"}
                        onClick={replay.discard}
                      >
                        Retake
                      </button>
                    </>
                  )}
                </div>
                <p>
                  {replay.verdictCommitted
                    ? "The verdict is already recorded; retrying here only saves the audio."
                    : replay.reviewed
                    ? "Now judge the one sound target above—not the whole performance."
                    : "Listen once before judging, or use the explicit judge-anyway choice."}
                </p>
              </div>
            )}

          {replay.error && <p role="alert">{replay.error}</p>}

          {!replay.verdictCommitted &&
            !replay.reviewBypassed &&
            !(replay.phase === "review" && replay.reviewed) && (
              <button
                type="button"
                className="rep-replay-bypass"
                disabled={
                  replay.captureSafety === "pending" ||
                  replay.captureSafety === "failed"
                }
                onClick={replay.judgeAnyway}
              >
                {replay.captureSafety === "pending"
                  ? "Securing microphone…"
                  : replay.captureSafety === "failed"
                    ? "Retry or turn Review off"
                    : "Judge without listening"}
              </button>
            )}

          {replay.kept.length > 0 && (
            <details className="rep-replay-kept">
              <summary>{replay.kept.length} kept take{replay.kept.length === 1 ? "" : "s"}</summary>
              <ul>
                {replay.kept.map((take, index) => (
                  <li key={take.id}>
                    <span>Take {replay.kept.length - index}</span>
                    <small>{durationLabel(take.duration_ms)}</small>
                    <button type="button" onClick={() => void replay.playKept(take.id)}>
                      Listen
                    </button>
                    <ConfirmDelete
                      label={`Delete kept Take ${replay.kept.length - index}? This cannot be undone.`}
                      onConfirm={() => replay.deleteKept(take.id)}
                    >
                      <button type="button">Delete</button>
                    </ConfirmDelete>
                  </li>
                ))}
              </ul>
              {replay.keptPlaybackUrl && (
                <PianoPlayback autoPlay src={replay.keptPlaybackUrl} />
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
