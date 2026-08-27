import { describe, expect, it } from "vitest";
import {
  attentionList,
  blockState,
  composerSortKey,
  BLOCK_STATE_LABEL,
  BLOCK_STATE_ORDER,
  daysSince,
  findPiece,
  findRegion,
  groupByComposer,
  pieceAttention,
  selectionExists,
  selectionExists as selectionExistsAlias,
  STALE_AFTER_DAYS,
  UNATTRIBUTED,
} from "./repertoire";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";

const NOW = "2026-07-31T12:00:00Z";

function region(overrides: Partial<RegionSignal> = {}): RegionSignal {
  return {
    region_id: 1,
    name: "Opening",
    kind: "section",
    focused_seconds: 0,
    active_days_28: 0,
    practiced: false,
    revisited: false,
    quality_brightness: 0.9,
    last_practiced: null,
    practice_events: 0,
    rated_rep_events: 0,
    clean_rep_events: 0,
    distinct_practice_dates: 0,
    ...overrides,
  };
}

function piece(overrides: Partial<UniversePiece> = {}): UniversePiece {
  return {
    piece_id: 1,
    title: "Untitled",
    composer: "Chopin",
    focused_seconds: 0,
    active_days_28: 0,
    regions_total: 0,
    regions_practiced: 0,
    regions_revisited: 0,
    quality_brightness: 0.9,
    last_practiced: NOW,
    region_signals: [],
    ...overrides,
  };
}

function snapshot(pieces: UniversePiece[]): UniverseSnapshot {
  return {
    generated_at: NOW,
    definitions: [],
    traces: {
      source: "test",
      practice_event_kinds: [],
      idle_threshold_seconds: 300,
      active_window_start: "2026-07-03",
      active_window_end: "2026-07-31",
      quality_formula: "test",
    },
    totals: {
      focused_seconds: 0,
      active_days_28: 0,
      regions_practiced: 0,
      regions_revisited: 0,
    },
    pieces,
  };
}

function iso(daysAgo: number): string {
  return new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
}

describe("blockState", () => {
  it("reports an untouched region", () => {
    expect(blockState(region())).toBe("untouched");
  });

  it("reports practiced, then revisited, then verified mastery", () => {
    expect(blockState(region({ practiced: true }))).toBe("practiced");
    expect(blockState(region({ practiced: true, revisited: true }))).toBe(
      "revisited",
    );
    expect(
      blockState(
        region({
          practiced: true,
          revisited: true,
          mastery_contracts_completed: 1,
        }),
      ),
    ).toBe("mastered");
  });

  it("lets open recovery debt outrank verified mastery", () => {
    // A region you have to win back is the actionable fact, whatever it earned
    // before — otherwise recovery debt would be invisible on a mastered region.
    expect(
      blockState(
        region({
          practiced: true,
          mastery_contracts_completed: 3,
          open_recovery_debt: 1,
        }),
      ),
    ).toBe("recovering");
  });

  it("treats missing optional counters as zero", () => {
    expect(
      blockState(region({ practiced: true, mastery_contracts_completed: 0 })),
    ).toBe("practiced");
    expect(blockState(region({ open_recovery_debt: 0 }))).toBe("untouched");
  });

  it("labels every state it can return", () => {
    for (const state of BLOCK_STATE_ORDER) {
      expect(BLOCK_STATE_LABEL[state]).toBeTruthy();
    }
    expect(BLOCK_STATE_ORDER).toHaveLength(5);
  });
});

describe("daysSince", () => {
  it("counts whole elapsed days", () => {
    expect(daysSince(iso(0), NOW)).toBe(0);
    expect(daysSince(iso(1), NOW)).toBe(1);
    expect(daysSince(iso(37), NOW)).toBe(37);
  });

  it("floors part-days, so 23 hours ago is still today", () => {
    expect(daysSince("2026-07-30T13:00:00Z", NOW)).toBe(0);
  });

  it("never returns a negative age for a future stamp", () => {
    expect(daysSince("2027-01-01T00:00:00Z", NOW)).toBe(0);
  });

  it("returns null for missing or unparseable stamps", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince(undefined, NOW)).toBeNull();
    expect(daysSince(iso(2), null)).toBeNull();
    expect(daysSince("not a date", NOW)).toBeNull();
    expect(daysSince(iso(2), "not a date")).toBeNull();
  });
});

describe("pieceAttention", () => {
  it("stays silent for a piece practised recently", () => {
    expect(pieceAttention(piece({ last_practiced: iso(2) }), NOW)).toBeNull();
  });

  it("flags a piece that has never been practised", () => {
    expect(pieceAttention(piece({ last_practiced: null }), NOW)).toEqual({
      kind: "never",
      days: null,
      regions: 0,
      label: "Never practiced",
    });
  });

  it("flags a piece only once it is past the stale threshold", () => {
    expect(
      pieceAttention(piece({ last_practiced: iso(STALE_AFTER_DAYS - 1) }), NOW),
    ).toBeNull();
    const stale = pieceAttention(
      piece({ last_practiced: iso(STALE_AFTER_DAYS) }),
      NOW,
    );
    expect(stale).toEqual({
      kind: "stale",
      days: STALE_AFTER_DAYS,
      regions: 0,
      label: `Rested ${STALE_AFTER_DAYS} days`,
    });
  });

  it("singularises a one-day and one-region reason", () => {
    // STALE_AFTER_DAYS is 14, so a 1-day rest is never stale; the singular form
    // is exercised through the recovery reason instead.
    expect(pieceAttention(piece({ open_recovery_debt: 1 }), NOW)?.label).toBe(
      "1 region in recovery",
    );
    expect(pieceAttention(piece({ open_recovery_debt: 4 }), NOW)?.label).toBe(
      "4 regions in recovery",
    );
  });

  it("puts recovery debt ahead of staleness and of never-practised", () => {
    expect(
      pieceAttention(
        piece({ open_recovery_debt: 2, last_practiced: iso(60) }),
        NOW,
      ),
    ).toMatchObject({ kind: "recovering", regions: 2, days: 60 });
    expect(
      pieceAttention(
        piece({ open_recovery_debt: 2, last_practiced: null }),
        NOW,
      ),
    ).toMatchObject({ kind: "recovering", days: null });
  });

  it("cannot judge staleness without a reference stamp", () => {
    expect(pieceAttention(piece({ last_practiced: iso(90) }), null)).toBeNull();
  });

  it("keeps archived history out of active attention", () => {
    expect(
      pieceAttention(
        piece({
          archived_at: 1_787_000_000,
          last_practiced: null,
          open_recovery_debt: 4,
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("attentionList", () => {
  it("orders recovery debt, then the coldest, then the never-started", () => {
    const entries = attentionList(
      [
        piece({ piece_id: 1, title: "Cold", last_practiced: iso(20) }),
        piece({ piece_id: 2, title: "Never", last_practiced: null }),
        piece({ piece_id: 3, title: "Colder", last_practiced: iso(90) }),
        piece({ piece_id: 4, title: "Debt", open_recovery_debt: 1 }),
        piece({ piece_id: 5, title: "Fresh", last_practiced: iso(1) }),
      ],
      NOW,
    );
    expect(entries.map((entry) => entry.piece.title)).toEqual([
      "Debt",
      "Colder",
      "Cold",
      "Never",
    ]);
  });

  it("orders competing recovery debts by size, then by title", () => {
    const entries = attentionList(
      [
        piece({ piece_id: 1, title: "Beta", open_recovery_debt: 1 }),
        piece({ piece_id: 2, title: "Alpha", open_recovery_debt: 1 }),
        piece({ piece_id: 3, title: "Worst", open_recovery_debt: 5 }),
      ],
      NOW,
    );
    expect(entries.map((entry) => entry.piece.title)).toEqual([
      "Worst",
      "Alpha",
      "Beta",
    ]);
  });

  it("is empty when nothing wants work", () => {
    expect(attentionList([piece({ last_practiced: iso(0) })], NOW)).toEqual([]);
    expect(attentionList([], NOW)).toEqual([]);
  });

  it("does not depend on input order", () => {
    const pieces = [
      piece({ piece_id: 1, title: "Cold", last_practiced: iso(20) }),
      piece({ piece_id: 2, title: "Never", last_practiced: null }),
      piece({ piece_id: 3, title: "Debt", open_recovery_debt: 2 }),
    ];
    const forward = attentionList(pieces, NOW).map((e) => e.piece.piece_id);
    const backward = attentionList([...pieces].reverse(), NOW).map(
      (e) => e.piece.piece_id,
    );
    expect(backward).toEqual(forward);
  });
});

describe("groupByComposer", () => {
  it("gathers pieces under their composer, alphabetically", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, title: "Scherzo No. 2", composer: "Chopin" }),
      piece({ piece_id: 2, title: "The White Peacock", composer: "Griffes" }),
      piece({ piece_id: 3, title: "Ballade No. 1", composer: "Chopin" }),
    ]);
    expect(groups.map((group) => group.composer)).toEqual([
      "Chopin",
      "Griffes",
    ]);
    expect(groups[0].pieces.map((p) => p.title)).toEqual([
      "Ballade No. 1",
      "Scherzo No. 2",
    ]);
  });

  it("sorts case-insensitively without depending on host locale rules", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, composer: "bach" }),
      piece({ piece_id: 2, composer: "Albeniz" }),
    ]);
    expect(groups.map((group) => group.composer)).toEqual(["Albeniz", "bach"]);
  });

  it("files a composer under the surname, the way a musician's shelf is", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, composer: "Frédéric Chopin" }),
      piece({ piece_id: 2, composer: "Charles Tomlinson Griffes" }),
      piece({ piece_id: 3, composer: "Ludwig van Beethoven" }),
    ]);
    expect(groups.map((group) => group.composer)).toEqual([
      "Ludwig van Beethoven",
      "Frédéric Chopin",
      "Charles Tomlinson Griffes",
    ]);
  });

  it("breaks a shared surname by the full displayed name", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, composer: "Wilhelm Bach" }),
      piece({ piece_id: 2, composer: "Johann Bach" }),
    ]);
    expect(groups.map((group) => group.composer)).toEqual([
      "Johann Bach",
      "Wilhelm Bach",
    ]);
  });

  it("uses the whole name as the sort key for a mononym", () => {
    expect(composerSortKey("Liszt")).toBe("liszt");
    expect(composerSortKey("  Ludwig  van   Beethoven  ")).toBe("beethoven");
    expect(composerSortKey("")).toBe("");
  });

  it("puts pieces with no composer last, under one heading", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, title: "Sketch", composer: null }),
      piece({ piece_id: 2, title: "Blank", composer: "   " }),
      piece({ piece_id: 3, title: "Named", composer: "Zelenka" }),
    ]);
    expect(groups.map((group) => group.composer)).toEqual([
      "Zelenka",
      UNATTRIBUTED,
    ]);
    expect(groups[1].pieces.map((p) => p.title)).toEqual(["Blank", "Sketch"]);
  });

  it("trims composer names so spacing never splits a group", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, composer: "Chopin" }),
      piece({ piece_id: 2, composer: " Chopin " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pieces).toHaveLength(2);
  });

  it("breaks a title tie by piece id so the order is total", () => {
    const groups = groupByComposer([
      piece({ piece_id: 9, title: "Etude" }),
      piece({ piece_id: 4, title: "Etude" }),
    ]);
    expect(groups[0].pieces.map((p) => p.piece_id)).toEqual([4, 9]);
  });

  it("lays out identically whatever order the snapshot arrives in", () => {
    const pieces = [
      piece({ piece_id: 1, title: "Scherzo No. 2", composer: "Chopin" }),
      piece({ piece_id: 2, title: "The White Peacock", composer: "Griffes" }),
      piece({ piece_id: 3, title: "Ballade No. 1", composer: "Chopin" }),
      piece({ piece_id: 4, title: "Sketch", composer: null }),
    ];
    const shape = (input: UniversePiece[]) =>
      groupByComposer(input).map((group) => [
        group.composer,
        group.key,
        group.pieces.map((p) => p.piece_id),
      ]);
    expect(shape([...pieces].reverse())).toEqual(shape(pieces));
    expect(shape([pieces[2], pieces[0], pieces[3], pieces[1]])).toEqual(
      shape(pieces),
    );
  });

  it("does not mutate the caller's array", () => {
    const pieces = [
      piece({ piece_id: 2, title: "Zeta" }),
      piece({ piece_id: 1, title: "Alpha" }),
    ];
    groupByComposer(pieces);
    expect(pieces.map((p) => p.piece_id)).toEqual([2, 1]);
  });

  it("derives a DOM-safe key from the composer name, not from position", () => {
    const groups = groupByComposer([
      piece({ piece_id: 1, composer: "Charles Tomlinson Griffes" }),
      piece({ piece_id: 2, composer: "!!!" }),
    ]);
    const keys = groups.map((group) => group.key);
    expect(keys).toContain("charles-tomlinson-griffes");
    // A name with no alphanumerics still yields a usable, non-empty id.
    expect(keys.every((key) => /^[a-z0-9-]+$/.test(key))).toBe(true);
  });

  it("returns nothing for an empty repertoire", () => {
    expect(groupByComposer([])).toEqual([]);
  });
});

describe("selection lookups", () => {
  const CHOPIN = piece({
    piece_id: 7,
    region_signals: [region({ region_id: 11 }), region({ region_id: 12 })],
  });
  const SNAP = snapshot([CHOPIN]);

  it("finds a piece and a region", () => {
    expect(findPiece(SNAP, 7)?.piece_id).toBe(7);
    expect(findRegion(CHOPIN, 12)?.region_id).toBe(12);
  });

  it("returns null rather than throwing on a miss", () => {
    expect(findPiece(SNAP, 99)).toBeNull();
    expect(findPiece(null, 7)).toBeNull();
    expect(findRegion(CHOPIN, 99)).toBeNull();
    expect(findRegion(null, 11)).toBeNull();
  });

  it("says whether a selection still resolves", () => {
    expect(selectionExists(SNAP, { kind: "piece", pieceId: 7 })).toBe(true);
    expect(
      selectionExists(SNAP, { kind: "block", pieceId: 7, regionId: 11 }),
    ).toBe(true);
    expect(selectionExists(SNAP, { kind: "piece", pieceId: 8 })).toBe(false);
    expect(
      selectionExists(SNAP, { kind: "block", pieceId: 7, regionId: 99 }),
    ).toBe(false);
    expect(selectionExists(SNAP, null)).toBe(false);
    expect(selectionExistsAlias(null, { kind: "piece", pieceId: 7 })).toBe(
      false,
    );
  });
});
