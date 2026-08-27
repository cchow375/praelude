import { describe, expect, it } from "vitest";
import {
  filterWarmups,
  warmupById,
  WARMUP_CATALOG,
  WARMUP_TARGETS,
} from "./catalog";

describe("warmup catalog", () => {
  it("ships a broad, unique, fully described catalog", () => {
    expect(WARMUP_CATALOG).toHaveLength(118);
    expect(new Set(WARMUP_CATALOG.map((entry) => entry.id)).size).toBe(118);
    for (const entry of WARMUP_CATALOG) {
      expect(entry.name.trim()).not.toBe("");
      expect(entry.description.trim()).not.toBe("");
      expect(entry.howTo.trim()).not.toBe("");
      expect(entry.targets.length).toBeGreaterThan(0);
      expect(entry.keyboard.pitchClasses.length).toBeGreaterThan(0);
      expect(entry.defaultBpm.min).toBeGreaterThanOrEqual(20);
      expect(entry.defaultBpm.max).toBeGreaterThan(entry.defaultBpm.min);
      expect(entry.defaultCleanStreak).toBeGreaterThan(0);
    }
  });

  it("includes melodic-minor scales and minor arpeggios in all 12 keys", () => {
    const melodicMinor = WARMUP_CATALOG.filter((entry) =>
      entry.id.startsWith("melodic-minor-scale-"),
    );
    const minorArpeggios = WARMUP_CATALOG.filter((entry) =>
      entry.id.startsWith("minor-arpeggio-"),
    );
    expect(melodicMinor).toHaveLength(12);
    expect(minorArpeggios).toHaveLength(12);
    expect(melodicMinor.map((entry) => entry.id)).toContain(
      "melodic-minor-scale-b",
    );
    expect(minorArpeggios.map((entry) => entry.id)).toContain(
      "minor-arpeggio-db",
    );
    expect(melodicMinor[0].keyboard.motion).toContain(
      "natural minor descending",
    );
    expect(minorArpeggios[0].keyboard.pitchClasses).toEqual([0, 3, 7]);
  });

  it("covers every target with multiple choices rather than imposing one routine", () => {
    for (const target of WARMUP_TARGETS) {
      expect(filterWarmups("", target.id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("finds repertoire-shaped requests across name, target, and instruction", () => {
    expect(
      filterWarmups("octave jumps", "all").map((entry) => entry.id),
    ).toContain("octave-jumps");
    expect(filterWarmups("sotto voce", "all")).toEqual([]);
    expect(filterWarmups("thumb", "all").length).toBeGreaterThan(1);
    expect(filterWarmups("", "trills").map((entry) => entry.id)).toContain(
      "trill-pairs",
    );
    expect(filterWarmups("sixths", "all").map((entry) => entry.id)).toContain(
      "double-sixths-prepared",
    );
    expect(
      filterWarmups("diminished seventh", "all").map((entry) => entry.id),
    ).toContain("diminished-seventh-inversions");
    expect(filterWarmups("cadence", "all").map((entry) => entry.id)).toContain(
      "major-cadence-progression",
    );
  });

  it("returns null for stale routine ids", () => {
    expect(warmupById("major-scale-c")?.name).toBe("C major scale");
    expect(warmupById("removed-warmup")).toBeNull();
  });
});
