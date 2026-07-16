import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  authoritativeMeasureRange,
  confirmCalibratedMapping,
  createTargetDraft,
  unknownMapping,
  validateMeasureRange,
  withTargetDraftDetails,
  withTargetMapping,
} from "../draft";
import type {
  EditionIdentity,
  MappingCandidate,
  PersistentPdfSelectionAnchor,
  TargetDraft,
  TargetMappingState,
} from "../model";
import {
  createPersistentSelectionAnchor,
  type AnchorError,
  type DragError,
} from "../selection";
import {
  validateAtomicTargetSavePayload,
  type AtomicTargetSavePayload,
} from "../savePayload";
import {
  TargetDraftOverlay,
  type PageGeometryResolver,
} from "./TargetDraftOverlay";
import "./TargetDraftEditor.css";

export interface ConfirmationIdentity {
  confirmation_id: string;
  confirmed_at: string;
}

export interface TargetDraftEditorProps {
  draftId: string;
  pieceId: number;
  edition: EditionIdentity;
  pageNumber: number;
  /** Product policy is explicit; this component does not invent a confidence cutoff. */
  minimumCandidateConfidence: number;
  resolveMapping: (anchor: PersistentPdfSelectionAnchor) => TargetMappingState;
  onSave: (payload: AtomicTargetSavePayload) => void | Promise<void>;
  onCancel: () => void;
  /** Live ScoreView supplies its real-page selection through this seam. */
  initialAnchor?: PersistentPdfSelectionAnchor | null;
  onSelectionChange?: (anchor: PersistentPdfSelectionAnchor) => void;
  externalScoreSurface?: boolean;
  externalError?: string | null;
  geometryForEvent?: PageGeometryResolver;
  createConfirmationIdentity?: () => ConfirmationIdentity;
  scoreContent?: ReactNode;
}

function defaultConfirmationIdentity(): ConfirmationIdentity {
  const generated = globalThis.crypto?.randomUUID?.() ?? `atlas-confirm-${Date.now()}`;
  return { confirmation_id: generated, confirmed_at: new Date().toISOString() };
}

function mappingCopy(mapping: TargetMappingState): TargetMappingState {
  if (mapping.status === "unknown") {
    return {
      ...mapping,
      ...(mapping.candidate
        ? {
            candidate: {
              ...mapping.candidate,
              candidate_range: { ...mapping.candidate.candidate_range },
              calibration_point_ids: [...mapping.candidate.calibration_point_ids],
            },
          }
        : {}),
    };
  }
  if (mapping.status === "exact_compatible") {
    return {
      ...mapping,
      asserted_range: { ...mapping.asserted_range },
      evidence: { ...mapping.evidence },
    };
  }
  return {
    ...mapping,
    asserted_range: { ...mapping.asserted_range },
    evidence: {
      ...mapping.evidence,
      candidate_range: { ...mapping.evidence.candidate_range },
      calibration_point_ids: [...mapping.evidence.calibration_point_ids],
    },
  };
}

function candidateOf(mapping: TargetMappingState): MappingCandidate | null {
  return mapping.status === "unknown" ? mapping.candidate ?? null : null;
}

function statusCopy(
  mapping: TargetMappingState,
  minimumCandidateConfidence: number,
): { title: string; detail: string; tone: string } {
  if (mapping.status === "exact_compatible") {
    return {
      title: "Exact score match",
      detail: `Compatible MusicXML · mm. ${mapping.asserted_range.m_start}–${mapping.asserted_range.m_end}`,
      tone: "exact",
    };
  }
  if (mapping.status === "calibrated_user_confirmed") {
    return {
      title: "Mapping confirmed",
      detail: `User-verified · mm. ${mapping.asserted_range.m_start}–${mapping.asserted_range.m_end}`,
      tone: "confirmed",
    };
  }
  if (mapping.candidate) {
    const eligible = mapping.candidate.confidence >= minimumCandidateConfidence;
    return {
      title: eligible ? "Calibration candidate" : "Low-confidence candidate",
      detail: eligible
        ? "Review or correct the suggested measures."
        : "Add stronger calibration before asserting measures.",
      tone: eligible ? "candidate" : "unknown",
    };
  }
  return {
    title: "Location only",
    detail: "The score mark is safe to keep as a draft, but its measures are unknown.",
    tone: "unknown",
  };
}

function boundedConfidenceThreshold(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function TargetDraftEditor({
  draftId,
  pieceId,
  edition,
  pageNumber,
  minimumCandidateConfidence,
  resolveMapping,
  onSave,
  onCancel,
  initialAnchor = null,
  onSelectionChange,
  externalScoreSurface = false,
  externalError = null,
  geometryForEvent,
  createConfirmationIdentity = defaultConfirmationIdentity,
  scoreContent,
}: TargetDraftEditorProps) {
  const titleId = useId();
  const instructionsId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<TargetDraft | null>(null);
  const [mapping, setMapping] = useState<TargetMappingState>(
    unknownMapping("Draw a score location to begin."),
  );
  const [candidate, setCandidate] = useState<MappingCandidate | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [hands, setHands] = useState("");
  const [method, setMethod] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [numericX, setNumericX] = useState("10");
  const [numericY, setNumericY] = useState("15");
  const [numericWidth, setNumericWidth] = useState("30");
  const [numericHeight, setNumericHeight] = useState("12");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveGenerationRef.current += 1;
    };
  }, []);

  const threshold = boundedConfidenceThreshold(minimumCandidateConfidence);
  const candidateEligible = Boolean(
    candidate && threshold !== null && candidate.confidence >= threshold,
  );

  const reset = () => {
    setDraft(null);
    setMapping(unknownMapping("Draw a score location to begin."));
    setCandidate(null);
    setReviewConfirmed(false);
    setTitle("");
    setNote("");
    setHands("");
    setMethod("");
    setRangeStart("");
    setRangeEnd("");
    setNumericX("10");
    setNumericY("15");
    setNumericWidth("30");
    setNumericHeight("12");
    setError(null);
  };

  const acceptSelection = (anchor: PersistentPdfSelectionAnchor) => {
    setError(null);
    const created = createTargetDraft({
      draft_id: draftId,
      piece_id: pieceId,
      edition,
      anchor,
    });
    if (!created.ok) {
      setDraft(null);
      setMapping(unknownMapping("The score edition changed; draw this target again on the visible edition."));
      setCandidate(null);
      setReviewConfirmed(false);
      setError(created.message);
      return;
    }
    let resolved: TargetMappingState;
    try {
      resolved = mappingCopy(resolveMapping(anchor));
    } catch {
      resolved = unknownMapping("Mapping could not be resolved for this selection.");
    }
    const nextDraft = withTargetMapping(created.value, resolved);
    const nextCandidate = candidateOf(resolved);
    const range = resolved.status === "unknown"
      ? nextCandidate?.candidate_range ?? null
      : resolved.asserted_range;
    setDraft(nextDraft);
    setMapping(resolved);
    setCandidate(nextCandidate);
    setRangeStart(range ? String(range.m_start) : "");
    setRangeEnd(range ? String(range.m_end) : "");
    setReviewConfirmed(false);
    onSelectionChange?.(anchor);
  };

  useEffect(() => {
    if (initialAnchor) acceptSelection(initialAnchor);
    // Revalidate the same anchor if the live edition identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnchor, edition.edition_fingerprint, edition.edition_id]);

  const onSelectionError = (
    _code: DragError | AnchorError,
    message: string,
  ) => setError(message);

  const useNumericSelection = () => {
    const values = [numericX, numericY, numericWidth, numericHeight].map(Number);
    if (!values.every(Number.isFinite)) {
      setError("Enter finite page percentages.");
      return;
    }
    const [x, y, width, height] = values.map((value) => value / 100);
    const anchor = createPersistentSelectionAnchor(edition, [{
      page: pageNumber,
      x,
      y,
      w: width,
      h: height,
    }]);
    if (!anchor.ok) {
      setError(anchor.message);
      return;
    }
    acceptSelection(anchor.value);
  };

  const editCandidateRange = (field: "start" | "end", value: string) => {
    if (field === "start") setRangeStart(value);
    else setRangeEnd(value);
    setReviewConfirmed(false);
    if (candidate) {
      setMapping(unknownMapping("Corrected candidate needs confirmation.", candidate));
    }
  };

  const confirmMapping = () => {
    setError(null);
    if (mapping.status === "exact_compatible" || mapping.status === "calibrated_user_confirmed") {
      setReviewConfirmed(true);
      return;
    }
    if (!candidate || !candidateEligible) {
      setError("This mapping is not strong enough to assert measures yet.");
      return;
    }
    const range = validateMeasureRange({
      m_start: Number(rangeStart),
      m_end: Number(rangeEnd),
    });
    if (!range.ok) {
      setError(range.message);
      return;
    }
    const identity = createConfirmationIdentity();
    const confirmed = confirmCalibratedMapping(candidate, {
      confirmation_id: identity.confirmation_id,
      confirmed_by: "user",
      confirmed_at: identity.confirmed_at,
      confirmed_range: range.value,
      rationale: "User reviewed the calibrated PDF-to-MusicXML candidate.",
    });
    if (!confirmed.ok) {
      setError(confirmed.message);
      return;
    }
    setMapping(confirmed.value);
    setReviewConfirmed(true);
  };

  const candidatePayload = useMemo(() => {
    if (!draft || mapping.status === "unknown") return null;
    const detailed = withTargetDraftDetails(withTargetMapping(draft, mapping), {
      title,
      note,
      hands,
      method,
    });
    return validateAtomicTargetSavePayload({
      piece_id: detailed.piece_id,
      command_id: draftId,
      title: detailed.title,
      note: detailed.note,
      hands: detailed.hands,
      method: detailed.method,
      edition: detailed.edition,
      anchor: detailed.anchor,
      mapping_evidence: detailed.mapping,
      asserted_measure_range: authoritativeMeasureRange(detailed.mapping),
    });
  }, [draft, hands, mapping, method, note, title]);

  const canSave = Boolean(reviewConfirmed && candidatePayload?.ok);
  const status = statusCopy(mapping, threshold ?? 1);

  const save = async () => {
    if (!reviewConfirmed || !candidatePayload?.ok || savingRef.current) return;
    savingRef.current = true;
    const generation = ++saveGenerationRef.current;
    setSaving(true);
    setError(null);
    try {
      await onSave(candidatePayload.value);
    } catch (caught) {
      if (mountedRef.current && generation === saveGenerationRef.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (mountedRef.current && generation === saveGenerationRef.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const visibleError = externalError ?? error;

  return (
    <section
      className="atlas-target-draft"
      aria-labelledby={titleId}
      aria-describedby={visibleError ? errorId : undefined}
      aria-busy={saving}
    >
      <header className="atlas-target-heading">
        <div>
          <span className="atlas-target-kicker">New practice target</span>
          <h2 id={titleId}>Mark the music first.</h2>
          <p id={instructionsId}>Drag over one PDF page, or open Keyboard selection below.</p>
        </div>
        <span className="atlas-target-page">p. {pageNumber}</span>
      </header>

      <div className={`atlas-target-layout ${externalScoreSurface ? "is-external" : ""}`}>
        {!externalScoreSurface && <div className="atlas-target-score-page">
          <div className="atlas-target-score-content" aria-hidden={scoreContent ? undefined : true}>
            {scoreContent ?? <span>PDF page surface</span>}
          </div>
          <TargetDraftOverlay
            pageNumber={pageNumber}
            edition={edition}
            selectedAnchor={draft?.anchor ?? null}
            instructionsId={instructionsId}
            geometryForEvent={geometryForEvent}
            disabled={saving}
            onSelection={acceptSelection}
            onSelectionError={onSelectionError}
          />
        </div>}

        <div className="atlas-target-fields">
          <div
            className="atlas-mapping-status"
            data-status={mapping.status}
            data-tone={status.tone}
            role="status"
            aria-live="polite"
          >
            <span className="atlas-mapping-dot" aria-hidden="true" />
            <span><strong>{status.title}</strong><small>{status.detail}</small></span>
          </div>

          <div className="atlas-target-meta-grid">
            <label>
              <span>Title <em>optional</em></span>
              <input aria-label="Target title" disabled={saving} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>Hands <em>optional</em></span>
              <input aria-label="Target hands" disabled={saving} value={hands} onChange={(event) => setHands(event.target.value)} placeholder="LH, RH, together" />
            </label>
            <label>
              <span>Method <em>optional</em></span>
              <input aria-label="Target method" disabled={saving} value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Rhythms, blocked…" />
            </label>
            <label className="is-wide">
              <span>Note <em>optional</em></span>
              <textarea aria-label="Target note" disabled={saving} value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
            </label>
          </div>

          {candidate && (
            <fieldset className="atlas-range-review">
              <legend>Suggested measures</legend>
              <label>
                <span>From</span>
                <input
                  aria-label="Candidate start measure"
                  type="number"
                  min="1"
                  disabled={saving}
                  value={rangeStart}
                  readOnly={!candidateEligible}
                  onChange={(event) => editCandidateRange("start", event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  aria-label="Candidate end measure"
                  type="number"
                  min="1"
                  disabled={saving}
                  value={rangeEnd}
                  readOnly={!candidateEligible}
                  onChange={(event) => editCandidateRange("end", event.target.value)}
                />
              </label>
              <span className="atlas-confidence">{Math.round(candidate.confidence * 100)}% confidence</span>
            </fieldset>
          )}

          {draft && mapping.status !== "unknown" && !candidate && (
            <p className="atlas-exact-range">
              Measures {mapping.asserted_range.m_start}–{mapping.asserted_range.m_end}
            </p>
          )}

          {draft && (
            <button
              type="button"
              className="atlas-confirm-mapping"
              disabled={saving || (mapping.status === "unknown" && !candidateEligible)}
              onClick={confirmMapping}
            >
              {mapping.status === "exact_compatible"
                ? reviewConfirmed ? "Exact range confirmed" : "Confirm exact range"
                : mapping.status === "calibrated_user_confirmed"
                  ? "Range confirmed"
                  : candidateEligible
                    ? "Confirm corrected range"
                    : candidate
                      ? "More calibration required"
                      : "Mapping required"}
            </button>
          )}

          {candidatePayload && !candidatePayload.ok && (
            <p className="atlas-validation-note">{candidatePayload.message}</p>
          )}

          <details className="atlas-keyboard-selection">
            <summary>Keyboard selection</summary>
            <p>Enter percentages of page {pageNumber}.</p>
            <div className="atlas-geometry-grid">
              <label><span>Left %</span><input aria-label="Selection left percent" disabled={saving} type="number" min="0" max="100" value={numericX} onChange={(event) => setNumericX(event.target.value)} /></label>
              <label><span>Top %</span><input aria-label="Selection top percent" disabled={saving} type="number" min="0" max="100" value={numericY} onChange={(event) => setNumericY(event.target.value)} /></label>
              <label><span>Width %</span><input aria-label="Selection width percent" disabled={saving} type="number" min="0.5" max="100" value={numericWidth} onChange={(event) => setNumericWidth(event.target.value)} /></label>
              <label><span>Height %</span><input aria-label="Selection height percent" disabled={saving} type="number" min="0.5" max="100" value={numericHeight} onChange={(event) => setNumericHeight(event.target.value)} /></label>
            </div>
            <button type="button" disabled={saving} onClick={useNumericSelection}>Use numeric selection</button>
          </details>

          {visibleError && <p className="atlas-target-error" id={errorId} role="alert">{visibleError}</p>}

          <div className="atlas-target-actions">
            <button type="button" className="is-quiet" disabled={saving} onClick={() => { reset(); onCancel(); }}>Cancel</button>
            <button type="button" className="is-quiet" disabled={saving || !draft} onClick={reset}>Reset draft</button>
            <button type="button" className="is-primary" disabled={saving || !canSave} onClick={() => void save()}>{saving ? "Saving target…" : "Save target"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
