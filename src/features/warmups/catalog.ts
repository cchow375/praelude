import type { WarmupCategory, WarmupDefinition, WarmupTarget } from "./types";

const KEYS = [
  { slug: "c", name: "C", root: 0 },
  { slug: "db", name: "D♭", root: 1 },
  { slug: "d", name: "D", root: 2 },
  { slug: "eb", name: "E♭", root: 3 },
  { slug: "e", name: "E", root: 4 },
  { slug: "f", name: "F", root: 5 },
  { slug: "gb", name: "G♭", root: 6 },
  { slug: "g", name: "G", root: 7 },
  { slug: "ab", name: "A♭", root: 8 },
  { slug: "a", name: "A", root: 9 },
  { slug: "bb", name: "B♭", root: 10 },
  { slug: "b", name: "B", root: 11 },
] as const;

function pcs(root: number, intervals: number[]): number[] {
  return intervals.map((step) => (root + step) % 12);
}

function keyed(
  idPrefix: string,
  label: (key: (typeof KEYS)[number]) => string,
  category: WarmupCategory,
  targets: WarmupTarget[],
  description: string,
  howTo: string,
  intervals: number[],
  motion: string,
  bpm: { min: number; max: number },
  streak = 3,
): WarmupDefinition[] {
  return KEYS.map((key) => ({
    id: `${idPrefix}-${key.slug}`,
    name: label(key),
    category,
    targets,
    description,
    howTo,
    keyboard: { pitchClasses: pcs(key.root, intervals), motion },
    defaultBpm: bpm,
    defaultCleanStreak: streak,
  }));
}

const majorScales = keyed(
  "major-scale",
  (key) => `${key.name} major scale`,
  "scales",
  ["evenness", "velocity", "coordination"],
  "Four-octave parallel scale with an unforced, even pulse.",
  "Begin slowly. Listen for identical depth and timing from every finger; add speed only after the turnarounds stay loose.",
  [0, 2, 4, 5, 7, 9, 11],
  "parallel · 4 octaves",
  { min: 48, max: 144 },
);

const harmonicMinorScales = keyed(
  "harmonic-minor-scale",
  (key) => `${key.name} harmonic-minor scale`,
  "scales",
  ["evenness", "coordination"],
  "Four-octave harmonic-minor scale with special attention to the augmented second.",
  "Keep the thumb passages quiet and prepare the raised seventh before it arrives. Do not lunge across the augmented second.",
  [0, 2, 3, 5, 7, 8, 11],
  "parallel · 4 octaves",
  { min: 44, max: 132 },
);

const contraryMotion = keyed(
  "contrary-major",
  (key) => `${key.name} major contrary motion`,
  "independence",
  ["coordination", "evenness"],
  "Contrary-motion scale that exposes unequal hands without adding repertoire complexity.",
  "Start together from the tonic, mirror the hands, and make both thumbs arrive without an accent.",
  [0, 2, 4, 5, 7, 9, 11],
  "contrary motion · 2 octaves",
  { min: 40, max: 112 },
);

const majorArpeggios = keyed(
  "major-arpeggio",
  (key) => `${key.name} major arpeggio`,
  "arpeggios",
  ["rotation", "evenness", "coordination"],
  "Four-octave major arpeggio led by lateral travel rather than finger stretching.",
  "Move the arm toward the next position early. Let the thumb pass with a small forearm rotation and no elbow jab.",
  [0, 4, 7],
  "root position · 4 octaves",
  { min: 40, max: 120 },
);

const dominantSevenths = keyed(
  "dominant-seventh",
  (key) => `${key.name} dominant-seventh arpeggio`,
  "arpeggios",
  ["rotation", "coordination", "evenness"],
  "Dominant-seventh arpeggio for lateral travel and four-note chord geography.",
  "Group the notes by harmony rather than by individual fingers; hear the chord before beginning each ascent.",
  [0, 4, 7, 10],
  "root position · 4 octaves",
  { min: 36, max: 108 },
);

const melodicMinorScales = keyed(
  "melodic-minor-scale",
  (key) => `${key.name} melodic-minor scale`,
  "scales",
  ["evenness", "coordination", "velocity"],
  "Four-octave classical melodic minor: raised sixth and seventh ascending, natural minor descending.",
  "Name the direction before playing it. Prepare the raised sixth and seventh on the ascent, then release them on the descent without changing the pulse.",
  // A static pitch-class figure cannot encode direction. Highlight the honest
  // union of the ascending and descending collections; the motion cue below
  // states exactly which form belongs to each direction.
  [0, 2, 3, 5, 7, 8, 9, 10, 11],
  "raised 6/7 ascending · natural minor descending · 4 octaves",
  { min: 42, max: 132 },
);

const minorArpeggios = keyed(
  "minor-arpeggio",
  (key) => `${key.name} minor arpeggio`,
  "arpeggios",
  ["rotation", "evenness", "coordination"],
  "Four-octave minor-triad arpeggio with relaxed lateral travel through every register.",
  "Hear the minor triad before beginning. Move the arm toward each next position early and keep the thumb passage compact rather than stretching for it.",
  [0, 3, 7],
  "root position · 4 octaves",
  { min: 38, max: 116 },
);

const hanon: WarmupDefinition[] = Array.from({ length: 20 }, (_, index) => ({
  id: `hanon-${index + 1}`,
  name: `Hanon ${index + 1}`,
  category: "independence" as const,
  targets: ["evenness", "coordination", "endurance"] as WarmupTarget[],
  description: `Five-finger travelling pattern ${index + 1}, used as a neutral coordination check rather than a speed contest.`,
  howTo:
    "Use a light, close touch. Stop before fatigue changes the hand shape; transpose or vary articulation only when the base pattern is even.",
  keyboard: {
    pitchClasses: [0, 2, 4, 5, 7],
    motion: `pattern ${index + 1} · ascending then descending`,
  },
  defaultBpm: { min: 52, max: 120 },
  defaultCleanStreak: 3,
}));

const technique: WarmupDefinition[] = [
  {
    id: "octave-repeated-relaxed",
    name: "Repeated octaves — rebound",
    category: "octaves",
    targets: ["octaves", "rotation", "endurance"],
    description:
      "Repeated octave attacks built from release and rebound, never held tension.",
    howTo:
      "Play short groups of four. Release fully after each group and stop immediately if the forearm hardens.",
    keyboard: { pitchClasses: [0], motion: "1–5 / 1–4 · grouped in fours" },
    defaultBpm: { min: 48, max: 112 },
    defaultCleanStreak: 3,
  },
  {
    id: "octave-jumps",
    name: "Octave jumps — silent landing",
    category: "octaves",
    targets: ["octaves", "coordination"],
    description:
      "Prepared octave leaps that train distance without a last-second grab.",
    howTo:
      "Release, travel, arrive on the surface, then play. Keep the preparatory landing silent and repeat at several distances.",
    keyboard: {
      pitchClasses: [0, 7],
      motion: "release → travel → land → play",
    },
    defaultBpm: { min: 36, max: 84 },
    defaultCleanStreak: 4,
  },
  {
    id: "broken-octaves",
    name: "Broken octaves",
    category: "octaves",
    targets: ["octaves", "rotation", "evenness"],
    description: "Alternating octave notes with a compact rotational impulse.",
    howTo:
      "Let the forearm rotate between thumb and fifth finger. Keep both notes equal and the wrist centered.",
    keyboard: { pitchClasses: [0], motion: "1–5 alternating" },
    defaultBpm: { min: 48, max: 132 },
    defaultCleanStreak: 3,
  },
  {
    id: "blocked-chord-voicing",
    name: "Blocked-chord voicing",
    category: "chords",
    targets: ["voicing", "coordination"],
    description:
      "Balanced chord landings with one deliberately projected voice.",
    howTo:
      "Prepare the whole chord on the key surface. Choose one voice to sing and keep the remaining notes close and quiet.",
    keyboard: {
      pitchClasses: [0, 4, 7],
      motion: "top · middle · bass voice rotations",
    },
    defaultBpm: { min: 36, max: 72 },
    defaultCleanStreak: 3,
  },
  {
    id: "chord-inversions",
    name: "Chord inversions — connected",
    category: "chords",
    targets: ["voicing", "evenness", "coordination"],
    description:
      "Root, first, and second inversions connected with minimal motion.",
    howTo:
      "Keep common tones close to the keys and move only the fingers that change. Listen for one continuous harmonic line.",
    keyboard: { pitchClasses: [0, 4, 7], motion: "root → first → second" },
    defaultBpm: { min: 40, max: 88 },
    defaultCleanStreak: 3,
  },
  {
    id: "held-note-independence",
    name: "Held-note finger independence",
    category: "independence",
    targets: ["coordination", "evenness", "trills"],
    description:
      "One finger rests while the others play a quiet five-note pattern.",
    howTo:
      "The held note stays supported, not clamped. Move the free fingers slowly enough that the wrist remains neutral.",
    keyboard: { pitchClasses: [0, 2, 4, 5, 7], motion: "hold one · move four" },
    defaultBpm: { min: 36, max: 72 },
    defaultCleanStreak: 3,
  },
  {
    id: "trill-pairs",
    name: "Trill pairs",
    category: "trills",
    targets: ["trills", "rotation", "evenness"],
    description: "Short measured trills across several finger pairs.",
    howTo:
      "Begin with two-note bursts, then four, then one beat. Use a tiny rotational assist and keep the non-playing fingers loose.",
    keyboard: { pitchClasses: [0, 2], motion: "2 · 4 · 8-note bursts" },
    defaultBpm: { min: 40, max: 96 },
    defaultCleanStreak: 4,
  },
  {
    id: "double-thirds",
    name: "Double thirds — prepared pairs",
    category: "independence",
    targets: ["coordination", "evenness"],
    description:
      "Slow paired thirds with deliberate release between hand shapes.",
    howTo:
      "Prepare each pair on the surface and release after playing. Favor alignment and quiet thumbs over speed.",
    keyboard: {
      pitchClasses: [0, 2, 4, 5, 7, 9],
      motion: "paired thirds · one octave",
    },
    defaultBpm: { min: 30, max: 72 },
    defaultCleanStreak: 3,
  },
  {
    id: "wrist-circles-chords",
    name: "Chord-release wrist circles",
    category: "rotation",
    targets: ["rotation", "voicing"],
    description:
      "A release drill for chordal repertoire and repeated sonorities.",
    howTo:
      "Play one chord, release into a small outward circle, and return to the surface without lifting the shoulder.",
    keyboard: {
      pitchClasses: [0, 4, 7],
      motion: "play → release → circle → return",
    },
    defaultBpm: { min: 30, max: 60 },
    defaultCleanStreak: 3,
  },
  {
    id: "chromatic-scale",
    name: "Chromatic scale — compact thumbs",
    category: "scales",
    targets: ["velocity", "evenness", "coordination"],
    description:
      "Chromatic scale with quiet thumbs and minimal vertical motion.",
    howTo:
      "Keep fingers close to the keys. Group by destination rather than accenting every thumb crossing.",
    keyboard: {
      pitchClasses: Array.from({ length: 12 }, (_, n) => n),
      motion: "parallel · 4 octaves",
    },
    defaultBpm: { min: 52, max: 152 },
    defaultCleanStreak: 3,
  },
];

// Repertoire-shaped additions requested in the acceptance pass. These remain
// honest code-native diagrams: highlighted pitch classes show the notes in the
// written C example, while the motion caption states the actual sequence. They
// do not pretend to be notation, fingering, or an animated hand model.
const expandedTechnique: WarmupDefinition[] = [
  {
    id: "double-sixths-prepared",
    name: "Double sixths — prepared pairs",
    category: "independence",
    targets: ["coordination", "evenness", "voicing"],
    description:
      "Slow paired sixths that separate clean preparation from release and travel.",
    howTo:
      "Prepare both notes on the key surface, play without squeezing, then release before moving to the next pair. Keep the upper and lower voices equally intentional.",
    keyboard: {
      pitchClasses: [0, 2, 4, 5, 7, 9, 11],
      motion: "C-major pairs · C–A, D–B, E–C · transpose",
    },
    defaultBpm: { min: 28, max: 68 },
    defaultCleanStreak: 3,
  },
  {
    id: "diminished-seventh-inversions",
    name: "Diminished sevenths — four inversions",
    category: "arpeggios",
    targets: ["rotation", "coordination", "evenness"],
    description:
      "One diminished-seventh collection begun from each chord tone, blocked before it is broken.",
    howTo:
      "Place and hear each inversion as a chord first. Then break it with lateral arm travel; the equal interval pattern is not permission to stretch or guess.",
    keyboard: {
      pitchClasses: [0, 3, 6, 9],
      motion: "C–E♭–G♭–A · four starts · blocked then broken",
    },
    defaultBpm: { min: 32, max: 96 },
    defaultCleanStreak: 3,
  },
  {
    id: "triad-inversions-voiced",
    name: "Triad inversions — rotating voice",
    category: "chords",
    targets: ["voicing", "coordination", "evenness"],
    description:
      "Root position and both inversions repeated with a different projected voice each pass.",
    howTo:
      "Prepare the full shape, choose the voice before playing, and release before changing inversion. Transpose only after all three voices stay deliberate in C.",
    keyboard: {
      pitchClasses: [0, 4, 7],
      motion: "root → first → second · top / middle / bass voice",
    },
    defaultBpm: { min: 32, max: 76 },
    defaultCleanStreak: 3,
  },
  {
    id: "major-cadence-progression",
    name: "Major cadence progression — voiced",
    category: "chords",
    targets: ["voicing", "coordination"],
    description:
      "A compact I–IV–V7–I progression that trains harmonic arrival and economical voice-leading.",
    howTo:
      "Hear each function before playing it. Keep common tones close, lead the outer voices deliberately, and transpose only when the progression connects without a hand-shape grab.",
    keyboard: {
      pitchClasses: [0, 2, 4, 5, 7, 11],
      motion: "C example · I → IV6/4 → V7 → I · transpose",
    },
    defaultBpm: { min: 32, max: 72 },
    defaultCleanStreak: 3,
  },
];

export const WARMUP_CATALOG: WarmupDefinition[] = [
  ...majorScales,
  ...harmonicMinorScales,
  ...contraryMotion,
  ...majorArpeggios,
  ...dominantSevenths,
  ...hanon,
  ...technique,
  ...expandedTechnique,
  // Appended after the original catalog so saved routine ids keep the same
  // catalog-backed measure identity used by the hidden warmup practice piece.
  ...melodicMinorScales,
  ...minorArpeggios,
];

export const WARMUP_TARGETS: Array<{ id: WarmupTarget; label: string }> = [
  { id: "velocity", label: "Velocity" },
  { id: "evenness", label: "Evenness" },
  { id: "octaves", label: "Octaves" },
  { id: "voicing", label: "Chords & voicing" },
  { id: "endurance", label: "Endurance" },
  { id: "rotation", label: "Wrist & rotation" },
  { id: "coordination", label: "Coordination" },
  { id: "trills", label: "Trills" },
];

export function warmupById(id: string): WarmupDefinition | null {
  return WARMUP_CATALOG.find((warmup) => warmup.id === id) ?? null;
}

export function filterWarmups(
  query: string,
  target: WarmupTarget | "all",
): WarmupDefinition[] {
  const needle = query.trim().toLocaleLowerCase();
  return WARMUP_CATALOG.filter((warmup) => {
    if (target !== "all" && !warmup.targets.includes(target)) return false;
    if (!needle) return true;
    return [
      warmup.name,
      warmup.category,
      warmup.description,
      warmup.howTo,
      ...warmup.targets,
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  });
}
