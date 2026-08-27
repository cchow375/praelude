import type {
  RepOpenArgs,
  RepSnapshot,
  SetFocusContextInput,
} from "../rep/useRep";

export type WarmupCategory =
  | "scales"
  | "arpeggios"
  | "independence"
  | "octaves"
  | "chords"
  | "rotation"
  | "trills";

export type WarmupTarget =
  | "velocity"
  | "evenness"
  | "octaves"
  | "voicing"
  | "endurance"
  | "rotation"
  | "coordination"
  | "trills";

export interface KeyboardFigureSpec {
  /** Pitch classes (C=0 … B=11) highlighted in the compact keyboard figure. */
  pitchClasses: number[];
  /** Optional short motion cue rendered below the keyboard. */
  motion?: string;
}

export interface WarmupDefinition {
  id: string;
  name: string;
  category: WarmupCategory;
  targets: WarmupTarget[];
  description: string;
  howTo: string;
  keyboard: KeyboardFigureSpec;
  defaultBpm: { min: number; max: number };
  defaultCleanStreak: number;
}

export interface WarmupRoutineItem {
  catalog_id: string;
  bpm: number;
  clean_streak: number;
}

export interface WarmupRoutine {
  id: number;
  name: string;
  items: WarmupRoutineItem[];
  created_at: string;
  updated_at: string;
}

export interface WarmupSystemPiece {
  piece_id: number;
  title: string;
}

export interface WarmupApi {
  listRoutines(): Promise<WarmupRoutine[]>;
  saveRoutine(input: {
    id?: number | null;
    name: string;
    items: WarmupRoutineItem[];
  }): Promise<WarmupRoutine>;
  deleteRoutine(id: number): Promise<void>;
  systemPiece(): Promise<WarmupSystemPiece>;
}

export interface WarmupWorkspaceProps {
  activeRep: RepSnapshot | null;
  onOpenBlock: (
    args: RepOpenArgs,
    context?: SetFocusContextInput | null,
  ) => Promise<RepSnapshot>;
  onRoutineComplete?: () => void;
  api?: WarmupApi;
}
