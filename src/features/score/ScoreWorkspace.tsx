import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceSummary } from "../pieces/types";
import type { PracticeBrainContext } from "../brain/types";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import { ScoreView } from "./ScoreView";
import { ScoreBanner } from "./Banner";
import { MetronomeQuickBar } from "../metronome/MetronomeQuickBar";
import { ScorePlanTab } from "../notebook/ScorePlanTab";
import type { ScoreFocusContext } from "./types";
import "./ScoreWorkspace.css";

type WorkspaceTab = "score" | "plan";

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string"
    ? reason
    : "The score library could not be loaded.";
}

// The piece list sorts alphabetically, which made the heaviest scanned-PDF
// piece the permanent default. Remember the last piece Christian actually
// viewed instead; storage failures (private mode etc.) fall back silently.
const LAST_PIECE_KEY = "codakiller.score.lastPieceId";

function readLastPieceId(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_PIECE_KEY);
    const id = raw == null ? NaN : Number(raw);
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

function writeLastPieceId(id: number) {
  try {
    window.localStorage.setItem(LAST_PIECE_KEY, String(id));
  } catch {
    // Best-effort memory only.
  }
}

export interface ScoreWorkspaceProps {
  /** Shell's rep.open — without it ScoreView's Practice tab renders nothing. */
  onOpenBlock?: (args: RepOpenArgs) => Promise<void>;
  defaultCleanStreak?: number;
  /** Publishes the exact visible score target to the shell-owned Brain context. */
  onPracticeContextChange?: (context: PracticeBrainContext | null) => void;
  /** Exact piece requested by a cross-workspace jump (Today/Universe). */
  requestedPieceId?: number | null;
  /** Changes for every navigation request, including repeat requests. */
  requestRevision?: number;
  /** Which workspace tab a navigation request wants (spec C3 deep link). Each
   *  request revision re-asserts it, so a day-sheet piece heading lands on Plan. */
  requestedTab?: WorkspaceTab | null;
  /** False while Shell keeps Score mounted only to preserve local work. */
  isActive?: boolean;
  /** The shell's single live set, used to disable conflicting manual starts. */
  activeRep?: RepSnapshot | null;
}

/**
 * v3 Score workspace: a quiet piece picker over the existing PDF viewer +
 * atlas. It reuses `ScoreView` (PdfPage/RegionOverlay/pdfjs) unchanged and adds
 * the monochrome chrome; the "Map this score" wizard lives inside `ScoreView`.
 */
export function ScoreWorkspace({
  onOpenBlock,
  defaultCleanStreak,
  onPracticeContextChange,
  requestedPieceId = null,
  requestRevision = 0,
  requestedTab = null,
  isActive = true,
  activeRep = null,
}: ScoreWorkspaceProps = {}) {
  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("score");

  // Each navigation request sets the tab explicitly: a Plan deep link opens Plan
  // (spec C3); any other jump lands on the Score itself. A plain picker change is
  // not a request, so it never yanks the reader off the Plan tab.
  useEffect(() => {
    setTab(requestedTab === "plan" ? "plan" : "score");
  }, [requestRevision, requestedTab]);

  const openBlock = useCallback(
    async (args: RepOpenArgs) => {
      if (!onOpenBlock) return;
      setOpening(true);
      try {
        await onOpenBlock(args);
      } finally {
        // useRep publishes the application-level receipt on failure; the
        // shell-level RepHud appears on success. Here we only clear the
        // in-flight flag.
        setOpening(false);
      }
    },
    [onOpenBlock],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = (await invoke<PieceSummary[]>("pieces_list")) ?? [];
      const withPdf = next.filter((piece) => piece.has_pdf);
      const requested =
        requestedPieceId == null
          ? null
          : (next.find((piece) => piece.id === requestedPieceId) ?? null);
      // Keep an explicitly requested no-PDF piece visible so the destination
      // can explain why its score cannot open instead of silently substituting
      // another work.
      const list =
        requested && !requested.has_pdf && withPdf.length > 0
          ? [requested, ...withPdf]
          : withPdf.length > 0
            ? withPdf
            : next;
      setPieces(list);
      if (requestedPieceId != null && requested == null) {
        setNavigationError("That piece is no longer available in the library.");
        setSelectedId(null);
      } else if (requested != null) {
        setNavigationError(
          requested.has_pdf
            ? null
            : `No PDF score is available for ${requested.title}. Add a PDF to its piece folder and rescan.`,
        );
        setSelectedId(requested.id);
      } else {
        setNavigationError(null);
        setSelectedId((current) => {
          if (current != null && list.some((piece) => piece.id === current))
            return current;
          const last = readLastPieceId();
          if (last != null && list.some((piece) => piece.id === last))
            return last;
          return list[0]?.id ?? null;
        });
      }
    } catch (reason) {
      setPieces([]);
      setSelectedId(null);
      setNavigationError(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [requestRevision, requestedPieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      requestedPieceId != null &&
      pieces.some((piece) => piece.id === requestedPieceId)
    ) {
      setSelectedId(requestedPieceId);
      writeLastPieceId(requestedPieceId);
    }
  }, [pieces, requestRevision, requestedPieceId]);

  // The visible score selection is the application's current piece. Keep the
  // native setting used by deterministic voice/Brain in lockstep with it.
  useEffect(() => {
    if (selectedId == null) return;
    setSelectionError(null);
    void invoke("piece_select", { id: selectedId }).catch((reason) => {
      setSelectionError(
        `The score changed, but voice context did not: ${messageOf(reason)}`,
      );
    });
  }, [selectedId]);

  const selected = pieces.find((piece) => piece.id === selectedId) ?? null;

  const publishScoreContext = useCallback(
    (focus: ScoreFocusContext | null) => {
      if (!selected) {
        onPracticeContextChange?.(null);
        return;
      }
      onPracticeContextChange?.({
        piece_id: selected.id,
        piece_title: selected.title,
        composer: selected.composer,
        surface: "score",
        region: focus?.region ?? null,
        current_page: focus?.current_page ?? null,
        edition_id: focus?.edition_id ?? null,
        edition_label: focus?.edition_label ?? null,
        active_block: null,
      });
    },
    [onPracticeContextChange, selected],
  );

  // Publish the selected piece immediately. ScoreView follows with the exact
  // page/edition/Region once its document state is ready.
  useEffect(() => {
    publishScoreContext(null);
  }, [publishScoreContext]);

  return (
    <main className="score-workspace" data-testid="score-workspace">
      <header className="score-workspace-head">
        <div className="score-workspace-headline">
          <span className="score-workspace-kicker">Score</span>
          <h1 className="score-workspace-title">
            {selected ? selected.title : "Your scores"}
          </h1>
        </div>
        <div
          className="score-workspace-tabs"
          role="tablist"
          aria-label="Score workspace"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "score"}
            className={`score-workspace-tab${tab === "score" ? " is-active" : ""}`}
            onClick={() => setTab("score")}
          >
            Score
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "plan"}
            className={`score-workspace-tab${tab === "plan" ? " is-active" : ""}`}
            onClick={() => setTab("plan")}
          >
            Plan
          </button>
        </div>
        <div className="score-workspace-tools">
          <MetronomeQuickBar />
          {pieces.length > 0 && (
            <label className="score-workspace-picker">
              <span>Piece</span>
              <select
                aria-label="Choose a piece"
                value={selectedId ?? ""}
                onChange={(event) => {
                  const id = Number(event.target.value);
                  setNavigationError(null);
                  setSelectedId(id);
                  writeLastPieceId(id);
                }}
              >
                {pieces.map((piece) => (
                  <option key={piece.id} value={piece.id}>
                    {piece.title}
                    {piece.composer ? ` · ${piece.composer}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <div className="score-workspace-body">
        {loading && (
          <p className="score-workspace-state" role="status">
            Loading your scores…
          </p>
        )}
        {error && !loading && (
          <p className="score-workspace-state is-error" role="alert">
            {error}
          </p>
        )}
        {navigationError && !loading && !error && (
          <p className="score-workspace-state is-error" role="alert">
            {navigationError}
          </p>
        )}
        {selectionError && !loading && !error && !navigationError && (
          <p className="score-workspace-state is-error" role="alert">
            {selectionError}
          </p>
        )}
        {!loading && !error && selectedId == null && (
          <p className="score-workspace-state">
            No pieces with a PDF score yet. Add a PDF to a piece’s folder and
            rescan.
          </p>
        )}
        {!loading && !error && selectedId != null && (
          <>
            {/* The score reader stays mounted while the Plan tab is shown so its
                PDF is not torn down and reloaded on every toggle. */}
            <div className="score-workspace-pane" hidden={tab !== "score"}>
              {/* The piece's one goal sentence sits directly over the page, so
                  it is the first thing read before playing. With no banner it
                  collapses to a single "+ goal" affordance and costs no height.

                  Fix wave item 11: this used to carry `key={selectedId}` —
                  sitting right beside `<ScoreView key={selectedId}>` below,
                  React saw two SIBLINGS with the identical key on every
                  render ("Encountered two children with the same key, `1`").
                  ScoreView's key is deliberate (a fresh mount per piece resets
                  its PDF/tool state — see its own comment); ScoreBanner
                  doesn't need that trick, it already resets its OWN state via
                  a `[pieceId]` effect (Banner.tsx), so it can just take the
                  prop update in place. */}
              <ScoreBanner pieceId={selectedId} />
              <ScoreView
                key={selectedId}
                pieceId={selectedId}
                isActive={isActive && tab === "score"}
                onOpenBlock={onOpenBlock ? openBlock : undefined}
                opening={opening}
                defaultCleanStreak={defaultCleanStreak}
                onContextChange={publishScoreContext}
                activeRange={
                  activeRep
                    ? { m_start: activeRep.m_start, m_end: activeRep.m_end }
                    : null
                }
              />
            </div>
            {tab === "plan" && (
              <div className="score-workspace-pane">
                <ScorePlanTab pieceId={selectedId} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
