import { useState, type FormEvent } from "react";
import { defineCommand, executeCommand } from "../../services/command";
import { ASSISTANT } from "../../shell/terms";
import {
  ReaderWindow,
  type ExcerptFetcher,
  type ReaderQuoteRef,
} from "../reader/ReaderWindow";
import "./PassageHelper.css";

// The passage-helper (spec C4): one small chat card inside the Score "Plan" tab
// and the day sheet under a piece heading. The pianist describes the passage;
// the backend `assistant_suggest` returns 2–4 grounded one-line strategies, each
// with Accept / No / More. Accept is the explicit confirm — it appends a
// checkbox plan item under this piece via the SHARED day-sheet store (never an
// auto-write, never a practice-truth mutation). More expands one row in place.
// Reads and suggests only; no hot-loop authority. Offline → honest state.

/** One strategy row. Mirrors the Rust `AssistantSuggestion` (snake_case wire). */
export interface AssistantSuggestion {
  readonly id: string;
  readonly text: string;
  readonly source_id?: string;
  readonly source_author?: string;
  readonly source_heading?: string;
}

export interface AssistantSuggestions {
  readonly suggestions: AssistantSuggestion[];
}

export interface AssistantSuggestArgs {
  readonly pieceId: number;
  readonly description: string;
  readonly regionId?: number | null;
  readonly expandOf?: string | null;
}

const ASSISTANT_SUGGEST = defineCommand<
  AssistantSuggestArgs,
  AssistantSuggestions
>("assistant_suggest", `${ASSISTANT} is offline.`);

/** Injectable command runner (tests pass a stub); defaults to the native call. */
export type SuggestFn = (
  args: AssistantSuggestArgs,
) => Promise<AssistantSuggestions>;

const nativeSuggest: SuggestFn = (args) =>
  executeCommand(ASSISTANT_SUGGEST, args);

export interface PassageHelperProps {
  /** The piece this card plans for; Accept appends an item under it. */
  readonly pieceId: number;
  /** The selected region, when any, scoping the MusicXML facts. */
  readonly regionId?: number | null;
  /** Append a confirmed strategy as a checkbox plan item (the explicit confirm). */
  readonly onAccept: (text: string) => void;
  /** Injectable for tests; defaults to the native `assistant_suggest` command. */
  readonly suggest?: SuggestFn;
  /** Injectable reader fetch, forwarded to the ReaderWindow (tests stub it). */
  readonly fetchExcerpt?: ExcerptFetcher;
}

/**
 * The passage-helper card. Self-contained: it owns its own draft, suggestion
 * rows, and the reusable ReaderWindow it opens for a cited source. It writes
 * nothing itself — Accept calls `onAccept`, which the host appends to the shared
 * day-sheet store — and it never invokes any practice command.
 */
export function PassageHelper({
  pieceId,
  regionId,
  onAccept,
  suggest = nativeSuggest,
  fetchExcerpt,
}: PassageHelperProps) {
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<AssistantSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reader, setReader] = useState<ReaderQuoteRef | null>(null);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const description = draft.trim();
    if (!description || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await suggest({ pieceId, description, regionId });
      setRows(result.suggestions);
      if (result.suggestions.length === 0) {
        setError(`${ASSISTANT} had no grounded strategy for that.`);
      }
    } catch (cause) {
      setRows([]);
      setError(
        cause instanceof Error
          ? `${ASSISTANT} offline — ${cause.message}`
          : `${ASSISTANT} offline.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const accept = (row: AssistantSuggestion) => {
    // The one explicit confirm: append a checkbox plan item under this piece via
    // the shared store, then drop the actioned row. No practice command runs.
    onAccept(row.text);
    setRows((prev) => prev.filter((item) => item.id !== row.id));
  };

  const dismiss = (row: AssistantSuggestion) => {
    setRows((prev) => prev.filter((item) => item.id !== row.id));
  };

  const expand = async (row: AssistantSuggestion) => {
    if (expandingId) return;
    setExpandingId(row.id);
    setError(null);
    try {
      const result = await suggest({
        pieceId,
        description: draft.trim() || row.text,
        regionId,
        expandOf: row.text,
      });
      const expanded = result.suggestions[0];
      if (expanded) {
        // Replace the one row in place, keeping its id stable for the list key.
        setRows((prev) =>
          prev.map((item) =>
            item.id === row.id ? { ...expanded, id: row.id } : item,
          ),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${ASSISTANT} offline — ${cause.message}`
          : `${ASSISTANT} offline.`,
      );
    } finally {
      setExpandingId(null);
    }
  };

  const openReader = (row: AssistantSuggestion) => {
    if (!row.source_id) return;
    // Open the book at its cited section: the verbatim heading is the reader's
    // `contains` locator (never the non-verbatim strategy line).
    setReader({
      sourceId: row.source_id,
      text: row.source_heading ?? "",
      author: row.source_author,
      heading: row.source_heading,
    });
  };

  return (
    <section
      className="passage-helper"
      aria-label="Passage helper"
      data-testid="passage-helper"
    >
      <form className="passage-helper-form" onSubmit={ask}>
        <input
          type="text"
          className="passage-helper-input"
          aria-label="Describe the passage"
          placeholder="Stuck? Describe the passage."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim() || busy}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      {error && (
        <p className="passage-helper-state" role="alert">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="passage-helper-list">
          {rows.map((row) => (
            <li key={row.id} className="passage-helper-row">
              <span className="passage-helper-text">
                {row.text}
                {row.source_id && row.source_author && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="passage-helper-source"
                      onClick={() => openReader(row)}
                    >
                      {row.source_author}
                    </button>
                  </>
                )}
              </span>
              <span className="passage-helper-actions">
                <button type="button" onClick={() => accept(row)}>
                  Accept
                </button>
                <button type="button" onClick={() => dismiss(row)}>
                  No
                </button>
                <button
                  type="button"
                  onClick={() => expand(row)}
                  disabled={expandingId != null}
                >
                  {expandingId === row.id ? "…" : "More"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {reader && (
        <ReaderWindow
          quote={reader}
          onClose={() => setReader(null)}
          fetchExcerpt={fetchExcerpt}
        />
      )}
    </section>
  );
}
