import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { brainApi } from "./api";
import { ASSISTANT } from "../../shell/terms";
import { todayLocal } from "../calendar/dates";
import { Button, Disclosure, Receipt } from "../../ui";
import {
  parseProposedAction,
  type ProposedAction,
} from "../voice/domain/proposedAction";
import {
  brainStatus,
  commandErrorMessage,
  defineCommand,
  executeCommand,
  type BrainStatus,
  type CommandInvoker,
} from "../../services/command";
import type { PieceSummary } from "../pieces/types";
import type {
  BrainAnswer,
  BrainApi,
  BrainGroundingSummary,
  BrainIntakeReview,
  BrainProvider,
  BrainQuestionSource,
  BrainTurnRow,
  IntakeChange,
  PracticeBrainContext,
  WakeQuestion,
  WorkSuggestion,
} from "./types";
import "./brain.css";

/**
 * The v3 Brain workspace: a single-column transcript with a persistent status
 * line at the top and ONE primary action (the question input). Secondary
 * surfaces — grounding, methods, intake review, and the deterministic next-work
 * suggestions — live behind Disclosures so no screen is a wall of controls.
 *
 * Two seams: `api` (the BrainApi IPC boundary for ask/thread/intake/plan) and
 * `invoker` (the command.ts seam for `brain_status` + `pieces_list`). Both are
 * injectable for tests; production uses the real Tauri paths.
 */

interface ThreadEntry {
  id: string;
  question: string;
  source: BrainQuestionSource;
  answer: BrainAnswer;
}

export interface BrainProposedActionEvent {
  readonly answerId: string;
  /** Grounding captured before provider latency, never from state at answer time. */
  readonly pieceId: number | null;
  readonly targetBlockId: number | null;
  readonly action: ProposedAction;
}

export interface BrainWorkspaceProps {
  api?: BrainApi;
  invoker?: CommandInvoker;
  /** A new id represents one accepted wake-cue question, even if text repeats. */
  wakeQuestion?: WakeQuestion | null;
  /** Exact shell-owned score/practice context. Internal piece selection remains
   *  available when this prop is absent or the user deliberately changes it. */
  practiceContext?: PracticeBrainContext | null;
  /** Today's plain-English intention also follows manual Brain piece changes. */
  todayPlan?: string | null;
  /** Confirm UI and command ownership stay in Shell; Brain only emits a draft. */
  onProposedAction?: (event: BrainProposedActionEvent) => void;
}

const MAX_HISTORY_EXCHANGES = 6;
const MAX_HISTORY_CHARS = 2_000;

const piecesListCommand = defineCommand<undefined, PieceSummary[]>(
  "pieces_list",
  "Pieces could not be loaded.",
);

const PROVIDER_LABELS: Record<BrainProvider, string> = {
  claude: "Claude",
  gemini: "Gemini",
  offline: "Offline library",
};

function boundedHistory(thread: ThreadEntry[]) {
  return thread.slice(-MAX_HISTORY_EXCHANGES).flatMap((entry) => [
    {
      role: "user" as const,
      content: entry.question.slice(0, MAX_HISTORY_CHARS),
    },
    {
      role: "assistant" as const,
      content: entry.answer.answer.slice(0, MAX_HISTORY_CHARS),
    },
  ]);
}

function isProvider(value: string | null): value is BrainProvider {
  return value === "claude" || value === "gemini" || value === "offline";
}

/** Rebuild displayed exchanges from durable turns (oldest→newest user/assistant
 *  pairs). Only completed pairs are persisted, so pairing is straightforward. */
function seedThreadFromTurns(turns: BrainTurnRow[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  let pendingQuestion: string | null = null;
  turns.forEach((turn, index) => {
    if (turn.role === "user") {
      pendingQuestion = turn.content;
    } else if (turn.role === "assistant" && pendingQuestion != null) {
      const id = `resumed:${index}`;
      entries.push({
        id,
        question: pendingQuestion,
        source: "typed",
        answer: {
          id,
          answer: turn.content,
          provider: isProvider(turn.provider) ? turn.provider : "offline",
          citations: Array.isArray(turn.citations) ? turn.citations : [],
          methods: [],
          intake_review: null,
        },
      });
      pendingQuestion = null;
    }
  });
  return entries;
}

/** Minimal grounded context from the selected piece. The backend context
 *  resolver keys off `piece_id`; region/active-block are resolved server-side. */
function pieceContext(piece: PieceSummary | null): PracticeBrainContext | null {
  if (!piece) return null;
  return {
    piece_id: piece.id,
    piece_title: piece.title,
    composer: piece.composer,
    surface: "details",
    region: null,
    current_page: null,
    edition_id: null,
    edition_label: null,
    active_block: null,
  };
}

/**
 * Session-scoped Assistant-tools consent (Plan C1's Flag #1 resolution): the
 * composer asks once, before the FIRST question of the app session — not
 * per-question, which the frontend cannot predict ahead of asking — and the
 * choice is echoed on every subsequent `BrainAskRequest` for the rest of the
 * session. Module scope (not component state) so it survives a remount of
 * this component within the same app session, and resets only on reload.
 */
type ToolsConsent = "unset" | "allowed" | "declined";
let sessionToolsConsent: ToolsConsent = "unset";

/**
 * Test-only escape hatch: module-scope state does not reset between `it()`
 * blocks the way component state would, so a test suite that exercises the
 * consent card must be able to put it back to "unset" between tests, or
 * every test after the first one to click Allow/Decline would silently
 * inherit that earlier choice instead of exercising a fresh session.
 */
export function __resetAssistantToolsConsentForTests(): void {
  sessionToolsConsent = "unset";
}

export function BrainWorkspace({
  api = brainApi,
  invoker,
  wakeQuestion = null,
  practiceContext,
  todayPlan = null,
  onProposedAction,
}: BrainWorkspaceProps) {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [pieceId, setPieceId] = useState<number | null>(
    () => practiceContext?.piece_id ?? null,
  );
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [readyThreadPieceId, setReadyThreadPieceId] = useState<number | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkSuggestion[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const planGeneration = useRef(0);
  const handledWakeId = useRef<number | null>(null);
  const externalPieceId = useRef(practiceContext?.piece_id ?? null);
  const conversationGeneration = useRef(0);
  const activeAskId = useRef(0);
  const [, forceToolsConsentRerender] = useState(0);
  const rerenderForToolsConsent = () =>
    forceToolsConsentRerender((generation) => generation + 1);

  const selectedPiece = pieces.find((piece) => piece.id === pieceId) ?? null;
  const selectedPieceContext = pieceContext(selectedPiece);
  const effectiveTodayPlan =
    practiceContext?.today_plan?.trim() || todayPlan?.trim() || null;
  const baseContext =
    practiceContext?.piece_id === pieceId
      ? practiceContext
      : selectedPieceContext
        ? selectedPieceContext
        : null;
  const context =
    baseContext && effectiveTodayPlan
      ? { ...baseContext, today_plan: effectiveTodayPlan }
      : baseContext;
  const threadReady = pieceId == null || readyThreadPieceId === pieceId;

  const changePiece = useCallback(
    (next: number | null) => {
      if (next === pieceId) return;
      conversationGeneration.current += 1;
      activeAskId.current += 1;
      setAsking(false);
      setError(null);
      setPieceId(next);
    },
    [pieceId],
  );

  // A newly visible Score piece becomes Brain's selected thread. A deliberate
  // picker change remains respected until Score publishes a different piece.
  useEffect(() => {
    const next = practiceContext?.piece_id ?? null;
    if (next === externalPieceId.current) return;
    externalPieceId.current = next;
    // Losing a transient Score/active-set context must not throw the user out
    // of the piece conversation they were already reading.
    if (next !== null) changePiece(next);
  }, [changePiece, practiceContext?.piece_id]);

  // Persistent status line (no network — key presence + settings only).
  useEffect(() => {
    let active = true;
    executeCommand(brainStatus, undefined, invoker)
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setStatusError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setStatus(null);
        setStatusError(
          commandErrorMessage(cause, `${ASSISTANT} status unavailable.`),
        );
      });
    return () => {
      active = false;
    };
  }, [invoker]);

  // Piece list for the per-piece thread selector.
  useEffect(() => {
    let active = true;
    executeCommand(piecesListCommand, undefined, invoker)
      .then((list) => {
        if (active) setPieces(list ?? []);
      })
      .catch(() => {
        if (active) setPieces([]);
      });
    return () => {
      active = false;
    };
  }, [invoker]);

  const refreshPlan = useCallback(async () => {
    const generation = ++planGeneration.current;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const next = (await api.planPreview(pieceId)) ?? [];
      if (generation === planGeneration.current) setPlan(next);
    } catch (cause) {
      if (generation === planGeneration.current) {
        setPlan([]);
        setPlanError(errorMessage(cause, "Could not load next work."));
      }
    } finally {
      if (generation === planGeneration.current) setPlanLoading(false);
    }
  }, [api, pieceId]);

  useEffect(() => {
    void refreshPlan();
    return () => {
      planGeneration.current += 1;
    };
  }, [refreshPlan]);

  // Durable memory: selecting a piece resumes (or creates) its thread and seeds
  // the transcript. Switching pieces resets first, so a late resume can never
  // seed one piece's turns onto another.
  useEffect(() => {
    setThreadId(null);
    setThread([]);
    setReadyThreadPieceId(null);
    if (pieceId == null) return;
    let active = true;
    void api
      .resumeThread(pieceId)
      .then((resumed) => {
        if (!active) return;
        if (resumed) {
          setThreadId(resumed.thread_id);
          setThread((current) =>
            current.length === 0 ? seedThreadFromTurns(resumed.turns) : current,
          );
        }
        setReadyThreadPieceId(pieceId);
      })
      .catch(() => {
        // Persistence is best-effort; the workspace still answers without memory.
        if (active) setReadyThreadPieceId(pieceId);
      });
    return () => {
      active = false;
    };
  }, [api, pieceId]);

  const ask = useCallback(
    async (rawQuestion: string, source: BrainQuestionSource) => {
      const question = rawQuestion.trim();
      if (!question || asking || !threadReady) return;
      const generation = conversationGeneration.current;
      const askId = ++activeAskId.current;
      const askedPieceId = pieceId;
      const askedBlockId = context?.active_block?.block_id ?? null;
      setAsking(true);
      setError(null);
      try {
        const answer = await api.ask({
          question,
          source,
          piece_id: pieceId,
          thread_id: threadId,
          history: boundedHistory(thread),
          context,
          tools_consent: sessionToolsConsent === "allowed",
        });
        if (!isBrainAnswer(answer)) {
          throw new Error("The Assistant returned an invalid response.");
        }
        if (generation !== conversationGeneration.current) return;
        setThread((current) => [
          ...current,
          { id: `${answer.id}:${current.length}`, question, source, answer },
        ]);
        // Defense in depth: only a spoken answer can surface a backend action,
        // and the untrusted payload is narrowed again before Shell sees it.
        if (source === "voice" && onProposedAction) {
          const action = parseProposedAction(answer.proposed_action);
          if (action) {
            onProposedAction({
              answerId: answer.id,
              pieceId: askedPieceId,
              targetBlockId: askedBlockId,
              action,
            });
          }
        }
        if (source === "typed") setDraft("");
      } catch (cause) {
        if (generation === conversationGeneration.current) {
          setError(errorMessage(cause, "The Assistant could not answer."));
        }
      } finally {
        if (activeAskId.current === askId) setAsking(false);
      }
    },
    [
      api,
      asking,
      context,
      onProposedAction,
      pieceId,
      thread,
      threadId,
      threadReady,
    ],
  );

  const clearConversation = useCallback(async () => {
    const generation = ++conversationGeneration.current;
    activeAskId.current += 1;
    setAsking(false);
    setError(null);
    if (pieceId == null) {
      setThread([]);
      setThreadId(null);
      return;
    }
    try {
      await api.clearThread(pieceId);
      if (generation !== conversationGeneration.current) return;
      const resumed = await api.resumeThread(pieceId);
      if (generation !== conversationGeneration.current) return;
      setThreadId(resumed?.thread_id ?? null);
      setReadyThreadPieceId(pieceId);
      setThread([]);
    } catch (cause) {
      if (generation === conversationGeneration.current) {
        setError(errorMessage(cause, "Could not clear the conversation."));
      }
    }
  }, [api, pieceId]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ behavior: "auto", block: "nearest" });
  }, [thread.length]);

  useEffect(() => {
    if (
      !wakeQuestion ||
      asking ||
      !threadReady ||
      handledWakeId.current === wakeQuestion.id
    )
      return;
    handledWakeId.current = wakeQuestion.id;
    void ask(wakeQuestion.text, "voice");
  }, [ask, asking, threadReady, wakeQuestion]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft, "typed");
  };

  const online = status?.online === true;
  const statusLine = statusError
    ? `○ status unavailable — ${statusError}`
    : status == null
      ? `Checking ${ASSISTANT} configuration…`
      : online
        ? `● configured — ${status.provider ?? "provider"}`
        : `○ offline — ${status.reason ?? "no provider configured"}`;

  return (
    <section
      className="brain"
      data-testid="workspace-brain"
      aria-label={`${ASSISTANT} workspace`}
    >
      <header className="brain-head">
        <p
          className={`brain-status-line is-${online ? "online" : "offline"}`}
          role="status"
          data-online={online}
        >
          {statusLine}
        </p>
        <label className="brain-piece-picker">
          <span>Piece</span>
          <select
            aria-label="Piece thread"
            value={pieceId ?? ""}
            onChange={(event) =>
              changePiece(
                event.target.value ? Number(event.target.value) : null,
              )
            }
          >
            <option value="">General question</option>
            {pieces.map((piece) => (
              <option key={piece.id} value={piece.id}>
                {piece.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      {context && <CurrentContextStrip context={context} />}

      <section
        className="brain-transcript"
        aria-label="Conversation"
        aria-live="polite"
      >
        {thread.length === 0 && !asking && (
          <p className="brain-empty">
            Start with the failure, not a vague goal. Try “Why does the coda
            leap miss above 92 BPM?”
          </p>
        )}
        {thread.map((entry) => (
          <article className="brain-turn" key={entry.id}>
            <p className="brain-q">
              <span className="brain-who">
                {entry.source === "voice" ? "Voice" : "You"}
              </span>
              {entry.question}
            </p>
            <div className="brain-a">
              <p className="brain-a-text">{entry.answer.answer}</p>
              {entry.answer.citations.length > 0 && (
                <ul className="brain-chips" aria-label="Citations">
                  {entry.answer.citations.map((citation) => (
                    <li
                      className="brain-chip"
                      key={citation.source_id}
                      title={citation.excerpt}
                    >
                      <span className="brain-chip-id">
                        [{citation.source_id}]
                      </span>{" "}
                      {citation.label}
                    </li>
                  ))}
                </ul>
              )}
              {entry.answer.tool_provenance &&
                entry.answer.tool_provenance.length > 0 && (
                  <ul
                    className="brain-chips brain-tool-chips"
                    aria-label="Tools consulted"
                  >
                    {entry.answer.tool_provenance.map((tool) => (
                      <li
                        className="brain-chip"
                        key={tool.tool}
                        title={tool.summary}
                      >
                        {tool.tool}
                        {tool.args_human ? ` · ${tool.args_human}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              <span className="brain-provider">
                {PROVIDER_LABELS[entry.answer.provider]}
              </span>
              {entry.answer.grounding && (
                <Disclosure
                  className="brain-secondary"
                  summary={`Grounding (${entry.answer.grounding.knowledge_sources.length} sources)`}
                >
                  <GroundingReceipt
                    grounding={entry.answer.grounding}
                    provider={entry.answer.provider}
                  />
                </Disclosure>
              )}
              {entry.answer.methods.length > 0 && (
                <Disclosure
                  className="brain-secondary"
                  summary={`Methods (${entry.answer.methods.length})`}
                >
                  <div className="brain-methods">
                    {entry.answer.methods.map((method) => (
                      <article className="brain-method" key={method.id}>
                        <h3>{method.name}</h3>
                        <p>{method.why}</p>
                        <dl>
                          <div>
                            <dt>Dose</dt>
                            <dd>{method.dose}</dd>
                          </div>
                          <div>
                            <dt>Watch for</dt>
                            <dd>{method.watch_for}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </Disclosure>
              )}
              {entry.answer.intake_review && (
                <Disclosure
                  className="brain-secondary"
                  summary={`Review intake suggestion · ${entry.answer.intake_review.piece_title}`}
                >
                  <IntakeReviewCard
                    answerId={entry.answer.id}
                    review={entry.answer.intake_review}
                    api={api}
                  />
                </Disclosure>
              )}
            </div>
          </article>
        ))}
        {asking && (
          <p className="brain-thinking" role="status">
            Checking the library and your practice context…
          </p>
        )}
        <div ref={threadEnd} />
      </section>

      {sessionToolsConsent === "unset" && (
        <div className="brain-consent-card" role="note">
          <p>Assistant may read practice data this session?</p>
          <div className="brain-consent-actions">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                sessionToolsConsent = "allowed";
                rerenderForToolsConsent();
              }}
            >
              Allow
            </Button>
            <Button
              type="button"
              variant="text"
              onClick={() => {
                sessionToolsConsent = "declined";
                rerenderForToolsConsent();
              }}
            >
              Just answer without it
            </Button>
          </div>
        </div>
      )}

      <div className="brain-composer-wrap">
        {error && (
          <p className="brain-error" role="alert">
            {error}
          </p>
        )}
        <form
          className="brain-composer"
          aria-label="Ask the Assistant"
          onSubmit={submit}
        >
          <label htmlFor="brain-question">Ask Coda</label>
          <textarea
            id="brain-question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Describe the exact passage and what breaks…"
            rows={2}
            maxLength={8_000}
            disabled={asking || !threadReady}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="brain-composer-actions">
            {thread.length > 0 && (
              <Button
                variant="text"
                data-testid="brain-clear-conversation"
                onClick={() => void clearConversation()}
              >
                Clear conversation
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={asking || !threadReady || draft.trim().length === 0}
            >
              {threadReady ? "Ask" : "Loading memory…"}
            </Button>
          </div>
        </form>
        <p className="brain-privacy">
          Answers may be wrong. Sources and your verdict stay visible; your
          writing changes only when you press Save.
        </p>
      </div>

      <Disclosure
        className="brain-secondary brain-plan-disclosure"
        summary="Suggested next work"
      >
        <PlanPreview
          suggestions={plan}
          loading={planLoading}
          error={planError}
          onRefresh={refreshPlan}
          onSchedule={api.schedule}
        />
      </Disclosure>
    </section>
  );
}

function CurrentContextStrip({ context }: { context: PracticeBrainContext }) {
  const range = context.region
    ? `mm. ${context.region.m_start}–${context.region.m_end}`
    : context.active_block
      ? `mm. ${context.active_block.m_start}–${context.active_block.m_end}`
      : null;
  const chips = [
    context.piece_title,
    context.region?.name ?? null,
    range,
    context.current_page != null ? `page ${context.current_page}` : null,
    context.edition_label,
    context.active_block
      ? `active set · ${context.active_block.attempts_recorded}/${context.active_block.planned_reps} attempts`
      : null,
    context.today_plan ? "Today plan included" : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      className="brain-current-context"
      aria-label={`Current ${ASSISTANT} context`}
    >
      <strong>Coda sees</strong>
      <ul>
        {chips.map((chip, index) => (
          <li key={`${index}:${chip}`}>{chip}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Honest one-line account of where the retrieved book excerpts went. The
 * backend names the cause, so "nothing matched" never reads as "the content is
 * hidden from the assistant". Older payloads without a cause fall back to the
 * boolean, which cannot tell those two apart.
 */
export function knowledgeShareLabel(
  grounding: BrainGroundingSummary,
  provider: BrainProvider,
): string {
  if (provider === "offline") {
    return "Answered on this Mac — nothing was sent";
  }
  switch (grounding.knowledge_share_cause) {
    case "shared":
      return "Retrieved excerpts shared with provider";
    case "no_library":
      return "No knowledge books are indexed yet";
    case "no_matches":
      return "No book excerpts matched this question";
    case "sharing_disabled":
      return "Book excerpts are kept on this Mac (sharing is off in Settings)";
    case "offline":
      return "Answered on this Mac — nothing was sent";
    default:
      return grounding.knowledge_shared_with_provider
        ? "Retrieved excerpts shared with provider"
        : "No book excerpts matched this question";
  }
}

function GroundingReceipt({
  grounding,
  provider,
}: {
  grounding: BrainGroundingSummary;
  provider: BrainProvider;
}) {
  const sourceCount = grounding.knowledge_sources.length;
  const xmlLabel =
    grounding.musicxml_status === "ready"
      ? "MusicXML included"
      : grounding.musicxml_status === "not_requested"
        ? "MusicXML needs a selected section"
        : "MusicXML unavailable";
  const sharingLabel = knowledgeShareLabel(grounding, provider);
  const answerLocation = [
    grounding.piece_title,
    grounding.region_name,
    grounding.measure_range
      ? `mm. ${grounding.measure_range[0]}–${grounding.measure_range[1]}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="brain-evidence">
      {answerLocation && <strong>Answer context: {answerLocation}</strong>}
      <div className="brain-evidence-facts">
        <span>
          <span className="brain-num">{sourceCount}</span> knowledge{" "}
          {sourceCount === 1 ? "book" : "books"} indexed
        </span>
        <span>{xmlLabel}</span>
        <span>
          <span className="brain-num">{grounding.recent_rep_count}</span> recent{" "}
          {grounding.recent_rep_count === 1 ? "attempt" : "attempts"}
        </span>
      </div>
      <small>{sharingLabel}</small>
      {grounding.warnings.length > 0 && (
        <ul className="brain-warnings">
          {grounding.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanPreview({
  suggestions,
  loading,
  error,
  onRefresh,
  onSchedule,
}: {
  suggestions: WorkSuggestion[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onSchedule: BrainApi["schedule"];
}) {
  return (
    <div className="brain-plan">
      <div className="brain-plan-head">
        <p className="brain-plan-boundary">
          The rules own this order. The AI may explain it, but cannot rewrite
          it.
        </p>
        <Button
          variant="text"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          {loading ? "Checking…" : "Refresh"}
        </Button>
      </div>
      {error && <p className="brain-plan-empty">{error}</p>}
      {!loading && !error && suggestions.length === 0 && (
        <p className="brain-plan-empty">
          No unfinished, weak, missed, or spaced work is currently ranked.
        </p>
      )}
      {suggestions.length > 0 && (
        <ol className="brain-plan-list">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <strong>{suggestion.title}</strong>
              {suggestion.m_start != null && suggestion.m_end != null && (
                <span className="brain-num brain-plan-measures">
                  mm. {suggestion.m_start}–{suggestion.m_end}
                </span>
              )}
              <ul className="brain-plan-reasons">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {suggestion.goal_id != null && (
                <PlannerSchedule
                  suggestion={suggestion}
                  onSchedule={onSchedule}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PlannerSchedule({
  suggestion,
  onSchedule,
}: {
  suggestion: WorkSuggestion;
  onSchedule: BrainApi["schedule"];
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayLocal);
  const [minutes, setMinutes] = useState(20);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (suggestion.goal_id == null) return null;
  if (saved)
    return (
      <p className="brain-plan-saved" role="status">
        Added to Calendar.
      </p>
    );
  if (!open) {
    return (
      <Button variant="text" onClick={() => setOpen(true)}>
        Schedule
      </Button>
    );
  }

  return (
    <form
      className="brain-plan-schedule-form"
      aria-label={`Schedule ${suggestion.title}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(null);
        void onSchedule({
          goal_id: suggestion.goal_id!,
          title: suggestion.title,
          minutes,
          date,
        })
          .then(() => {
            setSaved(true);
          })
          .catch((cause) => {
            setError(
              errorMessage(cause, "Could not add this work to Calendar."),
            );
          })
          .finally(() => setSaving(false));
      }}
    >
      <label>
        <span>Date</span>
        <input
          aria-label={`Date for ${suggestion.title}`}
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label>
        <span>Minutes</span>
        <input
          aria-label={`Minutes for ${suggestion.title}`}
          type="number"
          min={1}
          max={240}
          required
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
        />
      </label>
      <Button type="submit" variant="primary" disabled={saving}>
        {saving ? "Adding…" : "Add to Calendar"}
      </Button>
      <Button
        type="button"
        variant="text"
        onClick={() => setOpen(false)}
        disabled={saving}
      >
        Cancel
      </Button>
      {error && (
        <p className="brain-plan-schedule-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function isBrainAnswer(value: unknown): value is BrainAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<BrainAnswer>;
  return (
    typeof answer.id === "string" &&
    typeof answer.answer === "string" &&
    (answer.provider === "claude" ||
      answer.provider === "gemini" ||
      answer.provider === "offline") &&
    Array.isArray(answer.citations) &&
    Array.isArray(answer.methods)
  );
}

function IntakeReviewCard({
  answerId,
  review,
  api,
}: {
  answerId: string;
  review: BrainIntakeReview;
  api: BrainApi;
}) {
  const [values, setValues] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      review.fields.map((field) => [field.field, field.proposed]),
    ),
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(review.fields.map((field) => [field.field, true])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const changes: IntakeChange[] = review.fields
    .filter((field) => selected[field.field])
    .map((field) => ({
      field: field.field,
      value: values[field.field] ?? null,
    }));

  const save = async () => {
    if (changes.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.applyIntakeReview({
        answer_id: answerId,
        piece_id: review.piece_id,
        changes,
      });
      setSaved(true);
    } catch (cause) {
      setSaveError(errorMessage(cause, "Could not save the intake changes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="brain-intake-review"
      aria-label={`Piece setup review for ${review.piece_title}`}
    >
      <p className="brain-intake-summary">{review.summary}</p>
      <div className="brain-intake-fields">
        {review.fields.map((field) => (
          <div className="brain-intake-field" key={field.field}>
            <label className="brain-intake-select">
              <input
                type="checkbox"
                checked={selected[field.field] ?? false}
                onChange={(event) =>
                  setSelected((current) => ({
                    ...current,
                    [field.field]: event.target.checked,
                  }))
                }
              />
              {field.label}
            </label>
            <div className="brain-intake-comparison">
              <div>
                <span>Current — unchanged</span>
                <p>{field.current || "Empty"}</p>
              </div>
              <label>
                <span>Suggestion</span>
                <textarea
                  aria-label={`Suggested ${field.label}`}
                  value={values[field.field] ?? ""}
                  disabled={!selected[field.field] || saved}
                  rows={3}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.field]: event.target.value || null,
                    }))
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      {saveError && (
        <p className="brain-error" role="alert">
          {saveError}
        </p>
      )}
      {saved ? (
        <Receipt status="success" message="Saved to intake." />
      ) : (
        <Button
          variant="primary"
          disabled={saving || changes.length === 0}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save suggested changes"}
        </Button>
      )}
    </div>
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return fallback;
}
