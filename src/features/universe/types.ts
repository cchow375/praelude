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
}

export interface UniverseTotals {
  focused_seconds: number;
  active_days_28: number;
  regions_practiced: number;
  regions_revisited: number;
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
}

export interface UniversePiece {
  piece_id: number;
  title: string;
  composer: string | null;
  focused_seconds: number;
  active_days_28: number;
  regions_total: number;
  regions_practiced: number;
  regions_revisited: number;
  quality_brightness: number;
  last_practiced: string | null;
  region_signals: RegionSignal[];
}

export interface UniverseSnapshot {
  generated_at: string;
  definitions: UniverseDefinition[];
  traces: UniverseTraces;
  totals: UniverseTotals;
  pieces: UniversePiece[];
}

export interface PracticePieceContext {
  piece_id: number;
  title: string;
}
