export interface UniverseDefinition {
  signal: string;
  label: string;
  definition: string;
}

export interface UniverseTraces {
  source: string;
  practice_event_kinds: string[];
  idle_threshold_seconds: number;
  active_window_start: string;
  active_window_end: string;
  quality_formula: string;
  maturity_formula?: string;
}

export interface UniverseTotals {
  /** Backward-compatible all-history focused total. */
  focused_seconds: number;
  /** Monotonic all-history focus, including archived repertoire and technique. */
  lifetime_focused_seconds: number;
  active_days_28: number;
  /** Qualifying days across the current database's retained history. */
  lifetime_active_days: number;
  /** Longest configured-threshold qualifying-day run. */
  best_streak_days: number;
  regions_practiced: number;
  regions_revisited: number;
  /** All-history revisited targets, including archived repertoire. */
  revisited_targets: number;
  mastered_targets?: number;
  recovered_targets?: number;
  practice_sessions?: number;
}

export interface UniverseTechnique {
  focused_seconds: number;
  active_days_28: number;
  completed_warmups: number;
  practice_sessions: number;
  last_practiced: string | null;
}

export interface RegionSignal {
  region_id: number;
  name: string;
  kind: string;
  focused_seconds: number;
  active_days_28: number;
  practiced: boolean;
  revisited: boolean;
  quality_brightness: number;
  last_practiced: string | null;
  practice_events: number;
  rated_rep_events: number;
  clean_rep_events: number;
  distinct_practice_dates: number;
  mastery_contracts_completed?: number;
  recovery_resets?: number;
  recovered?: boolean;
  open_recovery_debt?: number;
  practice_sessions?: number;
}

export interface UniversePiece {
  piece_id: number;
  title: string;
  composer: string | null;
  /** Unix seconds when archived. Archived pieces remain historical evidence. */
  archived_at?: number | null;
  focused_seconds: number;
  active_days_28: number;
  regions_total: number;
  regions_practiced: number;
  regions_revisited: number;
  mastered_targets?: number;
  recovered_targets?: number;
  open_recovery_debt?: number;
  practice_sessions?: number;
  earned_maturity?: number;
  quality_brightness: number;
  last_practiced: string | null;
  region_signals: RegionSignal[];
}

export interface UniverseSnapshot {
  generated_at: string;
  definitions: UniverseDefinition[];
  traces: UniverseTraces;
  totals: UniverseTotals;
  /** Separate hidden-system-piece aggregate; never a repertoire entry. */
  technique?: UniverseTechnique;
  pieces: UniversePiece[];
}

export interface PracticePieceContext {
  piece_id: number;
  title: string;
}
