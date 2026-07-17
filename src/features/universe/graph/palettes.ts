/**
 * The ONLY color in CodaKiller lives here: each piece-system gets one stable
 * palette (seeded by piece id) that glows against pure-black space. `core` is
 * the hot centre, `body` the mid fill, `edge` the outer falloff, `signal` the
 * accent used for orbits/satellites. These read as light-on-black; they are the
 * app's single deliberate exception to the monochrome chrome discipline.
 */
export interface SystemPalette {
  core: string;
  body: string;
  edge: string;
  signal: string;
}

export const SYSTEM_PALETTES: readonly SystemPalette[] = [
  { core: "#fff1ad", body: "#e8ad43", edge: "#8e5128", signal: "#ffd76b" },
  { core: "#c4fff0", body: "#37c7ab", edge: "#126d70", signal: "#70ead2" },
  { core: "#d7f1ff", body: "#50a9dc", edge: "#245a91", signal: "#8fd8ff" },
  { core: "#ffe0c7", body: "#e97d50", edge: "#8e3d32", signal: "#ffad7e" },
  { core: "#e7ffc0", body: "#8bc65a", edge: "#416d3a", signal: "#b9ed7d" },
  { core: "#fff4c9", body: "#dfbd55", edge: "#80682c", signal: "#ffe18a" },
  { core: "#c9f7ff", body: "#43b8c9", edge: "#216b79", signal: "#82e4ed" },
  { core: "#ffe2bb", body: "#d98e47", edge: "#7f4a2c", signal: "#ffc47b" },
] as const;

export function paletteAt(index: number): SystemPalette {
  return SYSTEM_PALETTES[
    ((index % SYSTEM_PALETTES.length) + SYSTEM_PALETTES.length) %
      SYSTEM_PALETTES.length
  ];
}
