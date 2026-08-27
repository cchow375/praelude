import type { RepOpenArgs, SetFocusContextInput } from "../rep/useRep";

export const ROTATION_ADD_EVENT = "ck:rotation-add";
export const ROTATION_STORAGE_KEY = "ck.rotation.v1";

export interface RotationTarget {
  key: string;
  piece_id: number;
  region_id: number;
  piece_title: string;
  label: string;
  m_start: number;
  m_end: number;
  sound_target: string | null;
}

export interface RotationSettings {
  targets: RotationTarget[];
  station_minutes: number;
  shuffle: boolean;
}

export const DEFAULT_ROTATION_SETTINGS: RotationSettings = {
  targets: [],
  station_minutes: 5,
  shuffle: false,
};

const MAX_ROTATION_TARGETS = 100;
const MAX_PIECE_TITLE_CHARS = 200;
const MAX_LABEL_CHARS = 300;
const MAX_SOUND_TARGET_CHARS = 2_000;
const MAX_MEASURE_NUMBER = 0xffff_ffff;

export function rotationTargetKey(pieceId: number, regionId: number): string {
  return `${pieceId}:${regionId}`;
}

export function addRotationTarget(target: RotationTarget): void {
  window.dispatchEvent(
    new CustomEvent<RotationTarget>(ROTATION_ADD_EVENT, { detail: target }),
  );
}

/**
 * localStorage and CustomEvent payloads are untrusted runtime data. Rebuild a
 * target field-by-field so malformed ranges, stale keys, and accidental giant
 * strings can never reach the practice-open seam.
 */
export function validateRotationTarget(value: unknown): RotationTarget | null {
  if (value == null || typeof value !== "object") return null;
  const candidate = value as Partial<RotationTarget>;
  if (
    !Number.isSafeInteger(candidate.piece_id) ||
    Number(candidate.piece_id) < 1 ||
    !Number.isSafeInteger(candidate.region_id) ||
    Number(candidate.region_id) < 1 ||
    !Number.isSafeInteger(candidate.m_start) ||
    Number(candidate.m_start) < 1 ||
    !Number.isSafeInteger(candidate.m_end) ||
    Number(candidate.m_end) < Number(candidate.m_start) ||
    Number(candidate.m_end) > MAX_MEASURE_NUMBER
  ) {
    return null;
  }

  const pieceId = Number(candidate.piece_id);
  const regionId = Number(candidate.region_id);
  const pieceTitle =
    typeof candidate.piece_title === "string" ? candidate.piece_title.trim() : "";
  const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
  const soundTarget =
    candidate.sound_target == null
      ? null
      : typeof candidate.sound_target === "string"
        ? candidate.sound_target.trim()
        : undefined;
  if (
    candidate.key !== rotationTargetKey(pieceId, regionId) ||
    pieceTitle.length < 1 ||
    pieceTitle.length > MAX_PIECE_TITLE_CHARS ||
    label.length < 1 ||
    label.length > MAX_LABEL_CHARS ||
    soundTarget === undefined ||
    (soundTarget != null && soundTarget.length > MAX_SOUND_TARGET_CHARS)
  ) {
    return null;
  }

  return {
    key: rotationTargetKey(pieceId, regionId),
    piece_id: pieceId,
    region_id: regionId,
    piece_title: pieceTitle,
    label,
    m_start: Number(candidate.m_start),
    m_end: Number(candidate.m_end),
    sound_target: soundTarget || null,
  };
}

export function readRotationSettings(
  storage: Pick<Storage, "getItem"> = localStorage,
): RotationSettings {
  try {
    const raw = storage.getItem(ROTATION_STORAGE_KEY);
    if (!raw) return DEFAULT_ROTATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RotationSettings>;
    const seen = new Set<string>();
    const targets: RotationTarget[] = [];
    if (Array.isArray(parsed.targets)) {
      for (const value of parsed.targets) {
        const target = validateRotationTarget(value);
        if (!target || seen.has(target.key)) continue;
        seen.add(target.key);
        targets.push(target);
        if (targets.length >= MAX_ROTATION_TARGETS) break;
      }
    }
    const stationMinutes = Number(parsed.station_minutes);
    return {
      targets,
      station_minutes:
        Number.isFinite(stationMinutes) && stationMinutes >= 1 && stationMinutes <= 60
          ? Math.round(stationMinutes)
          : DEFAULT_ROTATION_SETTINGS.station_minutes,
      shuffle: parsed.shuffle === true,
    };
  } catch {
    return DEFAULT_ROTATION_SETTINGS;
  }
}

export function writeRotationSettings(
  value: RotationSettings,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(ROTATION_STORAGE_KEY, JSON.stringify(value));
}

export function shuffleRotation(
  targets: RotationTarget[],
  random: () => number = Math.random,
): RotationTarget[] {
  const next = [...targets];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function rotationOpenRequest(
  target: RotationTarget,
  requiredCleanStreak: number,
): { args: RepOpenArgs; context: SetFocusContextInput } {
  return {
    args: {
      piece_id: target.piece_id,
      region_id: target.region_id,
      m_start: target.m_start,
      m_end: target.m_end,
      label: target.label,
      start_bpm: null,
      target_bpm: null,
      planned_reps: null,
      required_clean_streak: requiredCleanStreak,
      increment: null,
      variants: [],
      focus: target.sound_target ? "phrasing" : "memory",
      use_metronome: false,
    },
    context: {
      intention: target.sound_target || "Retrieve this passage without a long re-entry.",
      judging_axis: target.sound_target || "Reliable recall after switching",
      method: "timed rotation",
      planned_seconds: null,
    },
  };
}
