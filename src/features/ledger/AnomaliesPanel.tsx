import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./AnomaliesPanel.css";

/** One disclosed anomaly row, mirroring the Rust `AnomalyEntry` wire shape. */
export interface AnomalyEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  review_state: string;
  detail: Record<string, unknown>;
  created_ts: string;
  reviewed_ts: string | null;
}

/** Every anomaly of one kind. Mirrors the Rust `AnomalyGroup`. */
export interface AnomalyGroup {
  kind: string;
  severity: string;
  count: number;
  rows: AnomalyEntry[];
}

/** The full disclosure payload. Mirrors the Rust `AnomalyReport`. */
export interface AnomalyReport {
  generated_at: string;
  total: number;
  groups: AnomalyGroup[];
}

/**
 * Plain-language disclosure copy per anomaly kind. Every entry stays inside the
 * authority boundary: these are observations about the *shape* of stored data
 * from the migration/backfill, never a judgment of how the human played. Each
 * "why" explains why the observation is disclosed rather than silently repaired.
 */
const EXPLANATIONS: Record<string, { label: string; what: string; why: string }> = {
  incomplete_event_provenance: {
    label: "Legacy events without full provenance",
    what: "These practice events were recorded before the app tracked how each command entered the ledger, so their input source and command identity are unknown.",
    why: "The events are kept exactly as they happened. The app cannot invent a provenance it never captured, so it discloses the gap instead of guessing.",
  },
  same_second_attempt_burst: {
    label: "Attempts recorded in the same second",
    what: "Two or more attempts on one set share an identical timestamp.",
    why: "This may be intentional rapid drilling, or a legacy import that stored attempts at one-second resolution. The app cannot tell which, so it surfaces the overlap rather than merging or dropping any attempt.",
  },
  duplicate_candidate: {
    label: "Duplicate-looking set pairs",
    what: "A newer set covers the same piece, measures, and label as an earlier one.",
    why: "These may be genuine repeats of the same passage on different days, or an accidental double-entry. The app will not guess which, so both sets are kept and only the resemblance is disclosed.",
  },
  abandoned_legacy_set: {
    label: "Abandoned legacy sets",
    what: "These sets were marked “abandoned” in an earlier version of the app.",
    why: "The status is preserved as historical fact. Nothing is deleted; the app only notes that the set was left unfinished.",
  },
  empty_set: {
    label: "Sets with no recorded attempts",
    what: "These sets exist but have zero attempts logged against them.",
    why: "An empty set may have been planned and never played, or created by a legacy import. The record is kept as-is and simply flagged.",
  },
  attempt_overrun: {
    label: "More attempts than planned",
    what: "A set recorded more attempts than its planned count.",
    why: "Practising past a plan is normal. The app records every real attempt and notes only that the count exceeded the plan — it never caps or discards attempts.",
  },
  nonpositive_range: {
    label: "Non-positive measure range",
    what: "A target or set has a start or end measure below 1.",
    why: "This is a data-shape error from legacy measure numbering, not a practice event. The range is disclosed unchanged for a later audited correction.",
  },
  reversed_range: {
    label: "Reversed measure range",
    what: "A target or set has its start measure after its end measure.",
    why: "The stored numbers are out of order — a legacy data-entry shape, nothing about the playing. It is surfaced for a later audited correction, never auto-flipped.",
  },
  invalid_planned_attempts: {
    label: "Negative planned attempts",
    what: "A set stored a negative planned-attempt count.",
    why: "A plan can never be negative; this is a legacy data-shape error. It is disclosed as-is for a later audited correction.",
  },
};

/** Human noun for an anomaly's entity type. `target` is the app's Region. */
const ENTITY_NOUN: Record<string, string> = {
  piece: "Piece",
  target: "Region",
  set: "Set",
  attempt: "Attempt",
  session: "Session",
  event: "Event",
};

function entityLabel(entry: AnomalyEntry): string {
  const noun = ENTITY_NOUN[entry.entity_type] ?? entry.entity_type;
  return `${noun} ${entry.entity_id}`;
}

function fallbackExplanation(kind: string) {
  return {
    label: kind.replace(/_/g, " "),
    what: "A data-shape observation recorded by the migration.",
    why: "It is disclosed as-is, never silently repaired.",
  };
}

function formatDetailValue(value: unknown): string {
  if (value == null) return "unknown";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "The anomaly disclosure could not be loaded.";
}

const SEVERITY_LABEL: Record<string, string> = {
  error: "Data error",
  warning: "Needs a human eye",
  info: "For the record",
};

/**
 * Read-only disclosure of migration/backfill-observed data anomalies. Anomalies
 * are projected, never repaired: this panel explains what each shape means and
 * why the app discloses rather than fixes it. No write actions live here.
 */
export function AnomaliesPanel() {
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<AnomalyReport>("anomalies_list");
      setReport(next ?? { generated_at: "", total: 0, groups: [] });
    } catch (reason) {
      setReport(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = report?.total ?? 0;

  return (
    <details className="anomalies-panel" data-testid="ledger-anomalies">
      <summary>
        <span className="anomalies-chevron" aria-hidden="true" />
        <span className="anomalies-summary-title">Data anomalies</span>
        <span className="anomalies-summary-meta">
          {loading ? "Reading…" : total === 0 ? "None disclosed" : `${total} disclosed`}
        </span>
      </summary>

      <div className="anomalies-body">
        <p className="anomalies-preamble">
          These are observations about the <em>shape</em> of stored practice data, recorded when the
          database was migrated. They are disclosed honestly, never silently repaired — the app does
          not judge how you played, and it will not guess at a correction it cannot be sure of.
        </p>

        {error && (
          <p className="anomalies-error" role="status" data-testid="anomalies-error">
            {error}
          </p>
        )}

        {!error && !loading && total === 0 && (
          <p className="anomalies-empty" data-testid="anomalies-empty">
            No anomalies disclosed for this database.
          </p>
        )}

        {!error && report && total > 0 && (
          <div className="anomalies-groups">
            {report.groups.map((group) => {
              const copy = EXPLANATIONS[group.kind] ?? fallbackExplanation(group.kind);
              return (
                <details
                  className="anomalies-group"
                  key={group.kind}
                  data-testid={`anomaly-group-${group.kind}`}
                >
                  <summary>
                    <span className="anomalies-chevron" aria-hidden="true" />
                    <span className="anomalies-group-title">{copy.label}</span>
                    <span
                      className={`anomalies-badge anomalies-badge-${group.severity}`}
                      data-testid={`anomaly-severity-${group.kind}`}
                    >
                      {SEVERITY_LABEL[group.severity] ?? group.severity}
                    </span>
                    <span
                      className="anomalies-group-count"
                      data-testid={`anomaly-count-${group.kind}`}
                    >
                      {group.count}
                    </span>
                  </summary>
                  <div className="anomalies-group-body">
                    <p className="anomalies-what">
                      <strong>What this means.</strong> {copy.what}
                    </p>
                    <p className="anomalies-why">
                      <strong>Why it is disclosed, not repaired.</strong> {copy.why}
                    </p>
                    <ul
                      className="anomalies-rows"
                      data-testid={`anomaly-rows-${group.kind}`}
                    >
                      {group.rows.map((row) => (
                        <li key={row.id} className="anomalies-row">
                          <span className="anomalies-row-entity">{entityLabel(row)}</span>
                          <span className="anomalies-row-detail">
                            {Object.entries(row.detail).map(([field, value]) => (
                              <span className="anomalies-fact" key={field}>
                                <span className="anomalies-fact-key">{field.replace(/_/g, " ")}</span>
                                <span className="anomalies-fact-value">{formatDetailValue(value)}</span>
                              </span>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
