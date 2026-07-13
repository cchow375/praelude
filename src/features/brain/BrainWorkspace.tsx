import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { brainApi } from "./api";
import type {
  BrainAnswer,
  BrainApi,
  BrainIntakeReview,
  BrainProvider,
  BrainQuestionSource,
  IntakeChange,
  WakeQuestion,
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
}

const PROVIDER_LABELS: Record<BrainProvider, string> = {
  claude: "Claude",
  gemini: "Gemini fallback",
  offline: "Offline library",
};

export function BrainWorkspace({ api = brainApi, wakeQuestion = null }: BrainWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledWakeId = useRef<number | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (rawQuestion: string, source: BrainQuestionSource) => {
    const question = rawQuestion.trim();
    if (!question || asking) return;
    setAsking(true);
    setError(null);
    try {
      const answer = await api.ask({ question, source });
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
  }, [api, asking]);

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
    <main className="brain-workspace" data-testid="main-brain">
      <header className="brain-header">
        <div>
          <p className="brain-eyebrow">Practice brain</p>
          <h1>Ask what to do next.</h1>
          <p>Grounded methods, your practice context, and sources you can inspect.</p>
        </div>
        {latestProvider && (
          <ProviderBadge provider={latestProvider} />
        )}
      </header>

      <section className="brain-thread" aria-label="Conversation" aria-live="polite">
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
                <section className="brain-citations" aria-label="Sources">
                  <h2>Sources</h2>
                  <ol>
                    {entry.answer.citations.map((citation) => (
                      <li key={citation.source_id}>
                        <span className="brain-citation-id">[{citation.source_id}]</span>{" "}
                        <span>
                          <strong>{citation.label}</strong> — {citation.excerpt}
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
