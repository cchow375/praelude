import { useEffect, useRef, useState } from "react";
import "./HeardPill.css";

export const QUIET_SPEECH_NOTE =
  "Quiet-speech sensitivity belongs to the system speech engine — the app shows what it heard; it can't hear better.";

const MAX_CHARS = 72;
const MAX_HEARD_LINES = 3;

export function truncateHeard(text: string): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (trimmed.length <= MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_CHARS - 1).trimEnd()}…`;
}

export interface HeardDelivery {
  readonly text: string;
  readonly is_final: boolean;
  /** Honest app-side latency: first partial received to action/ignore decision. */
  readonly app_ms?: number;
  readonly delivery_id?: string | number;
  readonly revision?: number;
}

interface HeardLine {
  key: string | number;
  text: string;
  appMs?: number;
}

/** Persistent, bounded evidence of the last three final transcripts.
 * Every final is retained, including ignored ambient speech. */
export function HeardPill({
  delivery,
}: {
  readonly delivery: HeardDelivery | null;
}) {
  const [heard, setHeard] = useState<HeardLine[]>([]);
  const fallbackKey = useRef(0);

  useEffect(() => {
    if (!delivery?.is_final) return;
    const text = truncateHeard(delivery.text);
    if (!text) return;
    fallbackKey.current += 1;
    const key = delivery.delivery_id ?? fallbackKey.current;
    setHeard((previous) =>
      [...previous, { key, text, appMs: delivery.app_ms }].slice(
        -MAX_HEARD_LINES,
      ),
    );
  }, [delivery]);

  return (
    <section className="heard-feed" aria-label="Recently heard">
      <div className="heard-feed-heading">
        <span className="heard-pill-ear" aria-hidden="true" />
        Heard
      </div>
      {heard.length === 0 ? (
        <p className="heard-feed-empty">No final speech heard yet.</p>
      ) : (
        <ol className="heard-feed-lines" role="log" aria-live="polite">
          {heard.map((line, index) => (
            <li key={`${line.key}-${index}`}>
              <span className="heard-pill-text">{line.text}</span>
              {typeof line.appMs === "number" && (
                <span
                  className="heard-pill-latency"
                  title="Time from the first words the speech engine gave the app to the action being done. It does not include how long speech recognition took — the app cannot see that."
                >
                  app {(line.appMs / 1000).toFixed(1)}s
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
