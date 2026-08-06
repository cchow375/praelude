import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type SVGProps,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceDetailData } from "../pieces/types";
import { BANNER_MAX_CHARS } from "./bannerText";
import "./Banner.css";

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" && reason.trim() !== ""
    ? reason
    : "The goal banner could not be saved.";
}

/** Both glyphs are decorative — their buttons carry the aria-label. */
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Dismiss-for-now: an eye with a stroke through it. */
function EyeSlashIcon() {
  return (
    <Glyph>
      <path d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2" />
      <path d="M20.4 9.2c.4.5.6 1 .6 1.3v.1s-3.5 6-9 6c-1 0-2-.2-2.9-.6" />
      <path d="M9.9 9.9a3 3 0 104.2 4.2" />
      <line x1="4" y1="20" x2="20" y2="4" />
    </Glyph>
  );
}

function CloseIcon() {
  return (
    <Glyph>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Glyph>
  );
}

export interface ScoreBannerProps {
  /** The piece whose banner this strip shows and edits. */
  pieceId: number;
}

/**
 * The per-piece goals banner (spec A11): the one sentence Christian wants over
 * this score while he plays it, set in the notebook's serif display face so it
 * reads as a written note rather than as chrome.
 *
 * Three affordances, in the order they matter: the text itself is click-to-edit
 * (Enter saves, Escape abandons); the eye-slash hides the strip for THIS session
 * only — plain React state, no write, so it is back on the next mount; the ×
 * deletes, behind a confirm, because a banner is typed prose that nothing else
 * remembers.
 *
 * With no banner the strip does not exist at all — only one quiet "+ goal"
 * affordance, so an unbannered score loses no vertical space (the dense-layout
 * floor is a 720x520 window).
 */
export function ScoreBanner({ pieceId }: ScoreBannerProps) {
  const [text, setText] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The banner is read straight off the piece, so a pin from the day sheet is
  // picked up the next time the score mounts without any cross-surface wiring.
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setEditing(false);
    setConfirmingDelete(false);
    // A different piece is a different banner: never inherit the hidden state.
    setDismissed(false);
    setError(null);
    invoke<PieceDetailData>("piece_get", { id: pieceId }).then(
      (detail) => {
        if (!alive) return;
        setText(detail?.banner_text ?? null);
        setLoaded(true);
      },
      () => {
        if (!alive) return;
        setText(null);
        setLoaded(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [pieceId]);

  const save = useCallback(
    async (next: string | null) => {
      setError(null);
      try {
        const detail = await invoke<PieceDetailData>("piece_banner_set", {
          pieceId,
          text: next,
        });
        setText(detail?.banner_text ?? null);
        setEditing(false);
        setConfirmingDelete(false);
      } catch (reason) {
        // The previous banner stays on screen: a rejected edit must never look
        // like it landed.
        setError(messageOf(reason));
      }
    },
    [pieceId],
  );

  const beginEdit = useCallback(() => {
    setDraft(text ?? "");
    setError(null);
    setEditing(true);
  }, [text]);

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const trimmed = draft.trim();
      void save(trimmed === "" ? null : trimmed);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Not a save and not a delete — the edit simply never happened.
      event.stopPropagation();
      setEditing(false);
      setError(null);
    }
  };

  if (!loaded || dismissed) return null;

  if (editing) {
    return (
      <div className="score-banner is-editing" data-testid="score-banner-edit">
        <input
          type="text"
          className="score-banner-field"
          aria-label="Goal banner text"
          placeholder="One goal for this score"
          maxLength={BANNER_MAX_CHARS}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        {error && (
          <p className="score-banner-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (text == null) {
    return (
      <div className="score-banner-empty">
        <button
          type="button"
          className="score-banner-add"
          aria-label="Add a goal banner"
          onClick={beginEdit}
        >
          + goal
        </button>
      </div>
    );
  }

  return (
    <div className="score-banner" data-testid="score-banner">
      <button
        type="button"
        className="score-banner-text"
        aria-label="Edit the goal banner"
        onClick={beginEdit}
      >
        {text}
      </button>
      {confirmingDelete ? (
        <span className="score-banner-confirm">
          <span className="score-banner-confirm-ask">Remove this banner?</span>
          <button
            type="button"
            className="score-banner-action"
            onClick={() => void save(null)}
          >
            Remove
          </button>
          <button
            type="button"
            className="score-banner-action"
            aria-label="Keep the banner"
            onClick={() => setConfirmingDelete(false)}
          >
            Keep
          </button>
        </span>
      ) : (
        <span className="score-banner-tools">
          <button
            type="button"
            className="score-banner-icon"
            aria-label="Hide the goal banner"
            title="Hide until next time"
            onClick={() => setDismissed(true)}
          >
            <EyeSlashIcon />
          </button>
          <button
            type="button"
            className="score-banner-icon"
            aria-label="Remove the goal banner"
            onClick={() => setConfirmingDelete(true)}
          >
            <CloseIcon />
          </button>
        </span>
      )}
      {error && (
        <p className="score-banner-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
