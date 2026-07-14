import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { brainApi } from "./api";
import { todayLocal } from "../calendar/dates";
import type {
  BrainAnswer,
  BrainApi,
  BrainGroundingSummary,
  BrainIntakeReview,
  BrainProvider,
  BrainQuestionSource,
  IntakeChange,
  PracticeBrainContext,
  WakeQuestion,
  WorkSuggestion,
} from "./types";
import "./BrainWorkspace.css";

interface ThreadEntry {
  id: string;
  question: string;
  source: BrainQuestionSource;
  answer: BrainAnswer;
}

export interface BrainWorkspaceProps {
  api?: BrainApi;
  wakeQuestion?: WakeQuestion | null;
  compact?: boolean;
  practiceContext?: PracticeBrainContext | null;
}

const MAX_HISTORY_EXCHANGES = 6;
const MAX_HISTORY_CHARS = 2_000;

function boundedHistory(thread: ThreadEntry[]) {
  return thread.slice(-MAX_HISTORY_EXCHANGES).flatMap((entry) => [
    { role: "user" as const, content: entry.question.slice(0, MAX_HISTORY_CHARS) },
    { role: "assistant" as const, content: entry.answer.answer.slice(0, MAX_HISTORY_CHARS) },
  ]);
}

const PROVIDER_LABELS: Record<BrainProvider, string> = {
  claude: "Claude",
  gemini: "Gemini fallback",
  offline: "Offline library",
};

export function BrainWorkspace({
  api = brainApi,
  wakeQuestion = null,
  compact = false,
  practiceContext = null,
}: BrainWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkSuggestion[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const handledWakeId = useRef<number | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const planGeneration = useRef(0);

  const refreshPlan = useCallback(async () => {
    const generation = ++planGeneration.current;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const next = (await api.planPreview(practiceContext?.piece_id ?? null)) ?? [];
      if (generation === planGeneration.current) setPlan(next);
    } catch (cause) {
      if (generation === planGeneration.current) {
        setPlan([]);
        setPlanError(errorMessage(cause, "Pick a piece in Practice to load next work."));
      }
    } finally {
      if (generation === planGeneration.current) setPlanLoading(false);
    }
  }, [api, practiceContext?.piece_id]);

  useEffect(() => {
    void refreshPlan();
    return () => { planGeneration.current += 1; };
  }, [refreshPlan]);

  const ask = useCallback(async (rawQuestion: string, source: BrainQuestionSource) => {
    const question = rawQuestion.trim();
    if (!question || asking) return;
    setAsking(true);
    setError(null);
    try {
      const answer = await api.ask({
        question,
        source,
        piece_id: practiceContext?.piece_id ?? null,
        history: boundedHistory(thread),
        context: practiceContext,
      });
      if (!isBrainAnswer(answer)) {
        throw new Error("The practice brain returned an invalid response.");
      }
      setThread((current) => [
        ...current,
        { id: `${answer.id}:${current.length}`, question, source, answer },
      ]);
      if (source === "typed") setDraft("");
    } catch (cause) {
      setError(errorMessage(cause, "The practice brain could not answer."));
    } finally {
      setAsking(false);
    }
  }, [api, asking, practiceContext, thread]);

  useEffect(() => {
    if (!wakeQuestion || asking || handledWakeId.current === wakeQuestion.id) return;
    handledWakeId.current = wakeQuestion.id;
    void ask(wakeQuestion.text, "voice");
  }, [ask, asking, wakeQuestion]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ behavior: "auto", block: "nearest" });
  }, [thread.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft, "typed");
  };

  const latestProvider = thread[thread.length - 1]?.answer.provider;

  return (
    <main className={`brain-workspace ${compact ? "is-compact" : ""}`} data-testid="main-brain">
      <header className="brain-header">
        <div>
          <p className="brain-eyebrow">Practice brain</p>
          <h1>{compact ? "Ask about this practice." : "Ask what to do next."}</h1>
          {!compact && <p>Grounded methods, your practice context, and sources you can inspect.</p>}
        </div>
        {latestProvider && (
          <ProviderBadge provider={latestProvider} />
        )}
      </header>

      <PracticeGrounding context={practiceContext} />

      <section className="brain-thread" aria-label="Conversation" aria-live="polite">
        {compact ? (
          <details className="brain-compact-plan">
            <summary>Suggested next work</summary>
            <PlanPreview
              suggestions={plan}
              loading={planLoading}
              error={planError}
              onRefresh={refreshPlan}
              onSchedule={api.schedule}
            />
          </details>
        ) : (
          <PlanPreview
            suggestions={plan}
            loading={planLoading}
            error={planError}
            onRefresh={refreshPlan}
            onSchedule={api.schedule}
          />
        )}
        {thread.length === 0 && (
          <div className="brain-empty">
            <p className="brain-empty-title">Start with the failure, not a vague goal.</p>
            <p>Try “Why does the coda leap miss above 92 BPM?” or say “Coda” followed by your question.</p>
          </div>
        )}
        {thread.map((entry) => (
          <article className="brain-exchange" key={entry.id}>
            <div className="brain-question">
              <span>{entry.source === "voice" ? "Voice" : "You"}</span>
              <p>{entry.question}</p>
            </div>
            <div className="brain-answer">
              <div className="brain-answer-meta">
                <span>Coda</span>
                <ProviderBadge provider={entry.answer.provider} compact />
              </div>
              <p className="brain-answer-copy">{entry.answer.answer}</p>
              {entry.answer.grounding && (
                <GroundingReceipt
                  grounding={entry.answer.grounding}
                  provider={entry.answer.provider}
                />
              )}
              {entry.answer.methods.length > 0 && (
                <section className="brain-methods" aria-label="Practice methods">
                  {entry.answer.methods.map((method) => (
                    <article className="brain-method" key={method.id}>
                      <h2>{method.name}</h2>
                      <p>{method.why}</p>
                      <dl>
                        <div><dt>Dose</dt><dd>{method.dose}</dd></div>
                        <div><dt>Watch for</dt><dd>{method.watch_for}</dd></div>
                      </dl>
                    </article>
                  ))}
                </section>
              )}
              {entry.answer.citations.length > 0 && (
                <section className="brain-citations" aria-label="Grounding sources">
                  <h2>Grounding from the knowledge library</h2>
                  <ol>
                    {entry.answer.citations.map((citation) => (
                      <li key={citation.source_id}>
                        <span className="brain-citation-id">[{citation.source_id}]</span>{" "}
                        <span>
                          <strong>{citation.label}</strong> — {citation.excerpt}
                          {citation.locator && (
                            <small className="brain-citation-local">
                              {citation.locator}
                            </small>
                          )}
                          {citation.url && <small className="brain-citation-url">{citation.url}</small>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {entry.answer.intake_review && (
                <IntakeReviewCard
                  answerId={entry.answer.id}
                  review={entry.answer.intake_review}
                  api={api}
                />
              )}
            </div>
          </article>
        ))}
        {asking && <p className="brain-thinking" role="status">Checking the library and your practice context…</p>}
        <div ref={threadEnd} />
      </section>

      <div className="brain-composer-wrap">
        {error && <p className="brain-error" role="alert">{error}</p>}
        <form className="brain-composer" aria-label="Ask the practice brain" onSubmit={submit}>
          <label htmlFor="brain-question">Ask Coda</label>
          <textarea
            id="brain-question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Describe the exact passage and what breaks…"
            rows={2}
            maxLength={8_000}
            disabled={asking}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={asking || draft.trim().length === 0}>Ask</button>
        </form>
        <p className="brain-privacy">Answers may be wrong. Sources and your verdict stay visible; your writing changes only when you press Save.</p>
      </div>
    </main>
  );
}

function PracticeGrounding({ context }: { context: PracticeBrainContext | null }) {
  if (!context) {
    return (
      <section className="brain-grounding is-empty" aria-label="Practice grounding">
        <strong>No piece is active.</strong>
        <span>Open a piece or score for passage-specific grounding. General practice questions still work.</span>
      </section>
    );
  }

  return (
    <section className="brain-grounding" aria-label="Practice grounding">
      <span className="brain-grounding-kicker">Grounded in current app state</span>
      <strong>{context.piece_title}</strong>
      <span>
        {context.region
          ? `${context.region.name} · mm. ${context.region.m_start}–${context.region.m_end}`
          : context.surface === "score"
            ? `Score${context.current_page ? ` · page ${context.current_page}` : ""}`
            : "Piece details"}
      </span>
      {context.region?.notes && <small>{context.region.notes}</small>}
      {context.active_block && (
        <small>
          Active {context.active_block.focus} block · {context.active_block.bpm} BPM · {context.active_block.reps_done}/{context.active_block.planned_reps} reps
        </small>
      )}
    </section>
  );
}

function GroundingReceipt({
  grounding,
  provider,
}: {
  grounding: BrainGroundingSummary;
  provider: BrainProvider;
}) {
  const sourceCount = grounding.knowledge_sources.length;
  const xmlLabel = grounding.musicxml_status === "ready"
    ? "MusicXML included"
    : grounding.musicxml_status === "not_requested"
      ? "MusicXML needs a selected section"
      : "MusicXML unavailable";
  const sharingLabel = provider === "offline"
    ? "Stayed on this Mac"
    : grounding.knowledge_shared_with_provider
      ? "Retrieved excerpts shared with provider"
      : "Book excerpts stayed on this Mac";
  const answerLocation = [
    grounding.piece_title,
    grounding.region_name,
    grounding.measure_range
      ? `mm. ${grounding.measure_range[0]}–${grounding.measure_range[1]}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="brain-evidence" aria-label="Answer grounding">
      {answerLocation && <strong>Answer context: {answerLocation}</strong>}
      <div>
        <span>{sourceCount} knowledge {sourceCount === 1 ? "book" : "books"} indexed</span>
        <span>{xmlLabel}</span>
        <span>{grounding.recent_rep_count} recent {grounding.recent_rep_count === 1 ? "rep" : "reps"}</span>
      </div>
      <small>{sharingLabel}</small>
      {grounding.warnings.length > 0 && (
        <details>
          <summary>Grounding limits ({grounding.warnings.length})</summary>
          <ul>{grounding.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      )}
    </section>
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
    <section className="brain-plan" aria-label="Deterministic next work">
      <header>
        <div>
          <p className="brain-eyebrow">Next work</p>
          <h2>Ranked from your real practice graph</h2>
        </div>
        <button type="button" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </button>
      </header>
      <p className="brain-plan-boundary">The rules own this order. The AI may explain it, but cannot rewrite it.</p>
      {error && <p className="brain-plan-empty">{error}</p>}
      {!loading && !error && suggestions.length === 0 && (
        <p className="brain-plan-empty">No unfinished, weak, missed, or spaced work is currently ranked.</p>
      )}
      {suggestions.length > 0 && (
        <ol>
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <span className="brain-plan-rank" aria-hidden="true" />
              <div>
                <strong>{suggestion.title}</strong>
                {suggestion.m_start != null && suggestion.m_end != null && (
                  <span className="brain-plan-measures">mm. {suggestion.m_start}–{suggestion.m_end}</span>
                )}
                <ul>
                  {suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                {suggestion.goal_id != null && (
                  <PlannerSchedule suggestion={suggestion} onSchedule={onSchedule} />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
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
  if (saved) return <p className="brain-plan-saved" role="status">Added to Calendar.</p>;
  if (!open) {
    return (
      <button className="brain-plan-schedule" type="button" onClick={() => setOpen(true)}>
        Schedule
      </button>
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
        }).then(() => {
          setSaved(true);
        }).catch((cause) => {
          setError(errorMessage(cause, "Could not add this work to Calendar."));
        }).finally(() => setSaving(false));
      }}
    >
      <label><span>Date</span><input aria-label={`Date for ${suggestion.title}`} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Minutes</span><input aria-label={`Minutes for ${suggestion.title}`} type="number" min={1} max={240} required value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
      <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add to Calendar"}</button>
      <button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
      {error && <p className="brain-plan-schedule-error" role="alert">{error}</p>}
    </form>
  );
}

function ProviderBadge({ provider, compact = false }: { provider: BrainProvider; compact?: boolean }) {
  return (
    <span className={`brain-provider is-${provider} ${compact ? "is-compact" : ""}`}>
      <span aria-hidden="true" />
      {PROVIDER_LABELS[provider]}
    </span>
  );
}

function isBrainAnswer(value: unknown): value is BrainAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<BrainAnswer>;
  return typeof answer.id === "string"
    && typeof answer.answer === "string"
    && (answer.provider === "claude" || answer.provider === "gemini" || answer.provider === "offline")
    && Array.isArray(answer.citations)
    && Array.isArray(answer.methods);
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
    Object.fromEntries(review.fields.map((field) => [field.field, field.proposed])),
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(review.fields.map((field) => [field.field, true])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const changes: IntakeChange[] = review.fields
    .filter((field) => selected[field.field])
    .map((field) => ({ field: field.field, value: values[field.field] ?? null }));

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
    <section className="brain-intake-review" aria-label={`Intake review for ${review.piece_title}`}>
      <div className="brain-intake-heading">
        <div>
          <p className="brain-intake-kicker">Intake review · {review.piece_title}</p>
          <h2>Review before anything changes</h2>
        </div>
        <span>Draft only</span>
      </div>
      <p>{review.summary}</p>
      <div className="brain-intake-fields">
        {review.fields.map((field) => (
          <div className="brain-intake-field" key={field.field}>
            <label className="brain-intake-select">
              <input
                type="checkbox"
                checked={selected[field.field] ?? false}
                onChange={(event) => setSelected((current) => ({
                  ...current,
                  [field.field]: event.target.checked,
                }))}
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
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [field.field]: event.target.value || null,
                  }))}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      {saveError && <p className="brain-error" role="alert">{saveError}</p>}
      {saved ? (
        <p className="brain-intake-saved" role="status">Saved to intake.</p>
      ) : (
        <button
          type="button"
          className="brain-intake-save"
          disabled={saving || changes.length === 0}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save suggested changes"}
        </button>
      )}
    </section>
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return fallback;
}
