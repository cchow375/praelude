import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { commandErrorMessage } from "../../services/command";
import { BlockRow } from "./BlockRow";
import type {
  BlockHistory,
  ProgressSummary,
  Region,
  RegionMastery,
} from "./types";

export interface HistoryGroup {
  region: Region | null;
  /** A non-null block.region_id whose Region metadata was unavailable. */
  unavailableRegionId?: number;
  blocks: BlockHistory[];
  mastery: RegionMastery | null;
}

export type HistorySort = "recent" | "by-measure" | "most-practiced";
export type HistoryFocus = "all" | BlockHistory["focus"];
export type HistoryEvidence =
  "all" | "mastered" | "unresolved" | "recovery" | "errors" | "legacy";

const INITIAL_VISIBLE_GROUPS = 10;

function hasGenuineMasteryBasis(block: BlockHistory): boolean {
  // Missing means the established consecutive-clean projection used by older
  // app builds/fixtures. Explicit total attempts is volume completion only.
  return block.mastery_basis !== "total_attempts";
}

function blockMatchesEvidence(
  block: BlockHistory,
  evidence: HistoryEvidence,
): boolean {
  if (evidence === "all") return true;
  if (evidence === "mastered") {
    return (
      hasGenuineMasteryBasis(block) &&
      block.mastery_verified === true &&
      block.mastery_status === "satisfied"
    );
  }
  if (evidence === "unresolved") {
    return (
      block.mastery_verified === true && block.mastery_status !== "satisfied"
    );
  }
  if (evidence === "recovery") {
    return (block.recovery_remaining ?? 0) > 0 || (block.reset_count ?? 0) > 0;
  }
  if (evidence === "errors") {
    return block.verdicts.flawed > 0 || block.verdicts.failed > 0;
  }
  return (
    block.mastery_verified !== true ||
    block.mastery_status === "unverified_legacy"
  );
}

export function filterSortHistory(
  groups: HistoryGroup[],
  options: {
    query: string;
    sort: HistorySort;
    focus?: HistoryFocus;
    evidence?: HistoryEvidence;
  },
): HistoryGroup[] {
  const query = options.query.trim().toLocaleLowerCase();
  const focus = options.focus ?? "all";
  const evidence = options.evidence ?? "all";
  const filtered = groups.flatMap((group) => {
    const matchingBlocks = group.blocks.filter(
      (block) =>
        (focus === "all" || block.focus === focus) &&
        blockMatchesEvidence(block, evidence),
    );
    if (matchingBlocks.length === 0) return [];
    if (query) {
      const regionText = group.region
        ? `${group.region.name} ${group.region.m_start} ${group.region.m_end} mm.${group.region.m_start}-${group.region.m_end}`
        : group.unavailableRegionId != null
          ? "section metadata unavailable"
          : "ungrouped no region";
      const blockText = matchingBlocks
        .map(
          (block) =>
            `${block.label ?? ""} ${block.m_start} ${block.m_end} mm.${block.m_start}-${block.m_end}`,
        )
        .join(" ");
      if (!`${regionText} ${blockText}`.toLocaleLowerCase().includes(query))
        return [];
    }
    return [{ ...group, blocks: matchingBlocks }];
  });
  return filtered.sort((a, b) => {
    if (options.sort === "by-measure") {
      const aStart =
        a.region?.m_start ??
        Math.min(...a.blocks.map((block) => block.m_start));
      const bStart =
        b.region?.m_start ??
        Math.min(...b.blocks.map((block) => block.m_start));
      return aStart - bStart;
    }
    if (options.sort === "most-practiced") {
      const attempts = (group: HistoryGroup) =>
        group.mastery?.reps ??
        group.blocks.reduce(
          (sum, block) =>
            sum + (block.attempts_recorded ?? block.tries ?? block.reps_done),
          0,
        );
      return attempts(b) - attempts(a);
    }
    const when = (group: HistoryGroup) =>
      Date.parse(group.mastery?.last_practiced ?? "") || 0;
    return when(b) - when(a);
  });
}

export function groupBlocksByRegion(
  blocks: BlockHistory[],
  regions: Region[],
  mastery: RegionMastery[] = [],
): HistoryGroup[] {
  const byRegion = new Map<number, BlockHistory[]>();
  const ungrouped: BlockHistory[] = [];
  for (const block of blocks) {
    if (block.region_id == null) ungrouped.push(block);
    else
      byRegion.set(block.region_id, [
        ...(byRegion.get(block.region_id) ?? []),
        block,
      ]);
  }
  const summaries = new Map(mastery.map((item) => [item.region_id, item]));
  const availableRegionIds = new Set(regions.map((region) => region.id));
  const groups: HistoryGroup[] = regions
    .map((region) => ({
      region,
      blocks: byRegion.get(region.id) ?? [],
      mastery: summaries.get(region.id) ?? null,
    }))
    .filter((group) => group.blocks.length > 0);
  // Never discard practice evidence just because its section metadata is
  // missing or region_list failed. Keep one stable, deterministic fallback
  // group per foreign key and distinguish it from genuinely ungrouped sets.
  const unavailableRegionIds = [...byRegion.keys()]
    .filter((regionId) => !availableRegionIds.has(regionId))
    .sort((left, right) => left - right);
  for (const regionId of unavailableRegionIds) {
    groups.push({
      region: null,
      unavailableRegionId: regionId,
      blocks: byRegion.get(regionId) ?? [],
      mastery: summaries.get(regionId) ?? null,
    });
  }
  if (ungrouped.length)
    groups.push({ region: null, blocks: ungrouped, mastery: null });
  return groups;
}

function formatWhen(value: string | null | undefined) {
  if (!value) return "not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "today";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function HistoryPanel({
  pieceId,
  refreshToken = 0,
}: {
  pieceId: number;
  refreshToken?: number;
}) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [blocks, setBlocks] = useState<BlockHistory[]>([]);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HistorySort>("recent");
  const [focus, setFocus] = useState<HistoryFocus>("all");
  const [evidence, setEvidence] = useState<HistoryEvidence>("all");
  const [visibleGroupCount, setVisibleGroupCount] = useState(
    INITIAL_VISIBLE_GROUPS,
  );
  const mounted = useRef(false);
  const loadGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (mounted.current) {
      // A piece switch and an explicit refresh are new data generations. Clear
      // every prior projection up front so no old region/summary can be paired
      // with a newly resolved block list.
      setLoading(true);
      setError(null);
      setRegions([]);
      setBlocks([]);
      setSummary(null);
    }
    const [regionResult, blockResult, summaryResult] = await Promise.allSettled(
      [
        invoke<Region[]>("region_list", { pieceId }),
        invoke<BlockHistory[]>("rep_blocks_for_piece", { pieceId }),
        invoke<ProgressSummary>("progress_summary", { pieceId }),
      ],
    );
    if (!mounted.current || loadGeneration.current !== generation) return;
    setRegions(
      regionResult.status === "fulfilled" ? (regionResult.value ?? []) : [],
    );
    setBlocks(
      blockResult.status === "fulfilled" ? (blockResult.value ?? []) : [],
    );
    setSummary(
      summaryResult.status === "fulfilled"
        ? (summaryResult.value ?? null)
        : null,
    );
    const failures: string[] = [];
    if (regionResult.status === "rejected") {
      failures.push(
        commandErrorMessage(
          regionResult.reason,
          "Practice sections could not be loaded.",
        ),
      );
    }
    if (blockResult.status === "rejected") {
      failures.push(
        commandErrorMessage(
          blockResult.reason,
          "Practice sets could not be loaded.",
        ),
      );
    }
    if (summaryResult.status === "rejected") {
      failures.push(
        commandErrorMessage(
          summaryResult.reason,
          "The progress summary could not be loaded.",
        ),
      );
    }
    setError(failures.length > 0 ? failures.join(" ") : null);
    setLoading(false);
  }, [pieceId]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load, refreshToken]);

  const groups = useMemo(
    () => groupBlocksByRegion(blocks, regions, summary?.per_region_mastery),
    [blocks, regions, summary],
  );
  const visibleGroups = useMemo(
    () => filterSortHistory(groups, { query, sort, focus, evidence }),
    [evidence, focus, groups, query, sort],
  );
  const renderedGroups = visibleGroups.slice(0, visibleGroupCount);

  useEffect(() => {
    setVisibleGroupCount(INITIAL_VISIBLE_GROUPS);
  }, [evidence, focus, pieceId, query, sort]);

  return (
    <section className="history-panel" aria-label="Practice history">
      <div className="history-heading">
        <div>
          <span className="ck-label">Practice history</span>
          <p>
            Organized by section. Attempts are evidence; only an explicit
            verified streak is mastery.
          </p>
        </div>
        <span className="history-total">
          {blocks.length} set{blocks.length === 1 ? "" : "s"}
        </span>
      </div>
      {!loading && groups.length > 0 && (
        <div className="history-toolbar">
          <label className="history-search">
            <span className="history-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              aria-label="Search practice history"
              placeholder="Section, label, or measure…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="history-filter">
            <span>Focus</span>
            <select
              aria-label="Filter practice history by focus"
              value={focus}
              onChange={(event) => setFocus(event.target.value as HistoryFocus)}
            >
              <option value="all">All focus</option>
              <option value="tempo">Tempo</option>
              <option value="notes">Notes</option>
              <option value="phrasing">Phrasing</option>
              <option value="dynamics">Dynamics</option>
              <option value="memory">Memory</option>
              <option value="hands">Hands</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="history-filter">
            <span>Evidence</span>
            <select
              aria-label="Filter practice history by evidence"
              value={evidence}
              onChange={(event) =>
                setEvidence(event.target.value as HistoryEvidence)
              }
            >
              <option value="all">All evidence</option>
              <option value="mastered">Mastery verified</option>
              <option value="unresolved">Unresolved</option>
              <option value="recovery">Recovery/reset</option>
              <option value="errors">Contains errors</option>
              <option value="legacy">Legacy/unverified</option>
            </select>
          </label>
          <select
            aria-label="Sort practice history"
            value={sort}
            onChange={(event) => setSort(event.target.value as HistorySort)}
          >
            <option value="recent">Most recent</option>
            <option value="by-measure">By measure</option>
            <option value="most-practiced">Most practiced</option>
          </select>
        </div>
      )}
      {loading ? (
        <p className="history-empty">Loading history…</p>
      ) : groups.length === 0 ? (
        <p className="history-empty">No practice sets yet.</p>
      ) : visibleGroups.length === 0 ? (
        <p className="history-empty">
          {query
            ? `No sections match “${query}”.`
            : "No sections match these filters."}
        </p>
      ) : (
        <div className="history-groups">
          {renderedGroups.map((group) => {
            const region = group.region;
            const unavailableRegionId = group.unavailableRegionId;
            const best = group.mastery?.best_bpm;
            const fallbackStart = Math.min(
              ...group.blocks.map((block) => block.m_start),
            );
            const fallbackEnd = Math.max(
              ...group.blocks.map((block) => block.m_end),
            );
            const fallbackRange =
              fallbackStart === fallbackEnd
                ? `m. ${fallbackStart}`
                : `mm. ${fallbackStart}–${fallbackEnd}`;
            const groupKey =
              region != null
                ? `region-${region.id}`
                : unavailableRegionId != null
                  ? `unavailable-region-${unavailableRegionId}`
                  : "ungrouped";
            return (
              <details className="history-group" key={groupKey}>
                <summary>
                  <span className="history-group-chevron" aria-hidden="true" />
                  <span className="history-group-range">
                    {region
                      ? `mm. ${region.m_start}–${region.m_end}`
                      : unavailableRegionId != null
                        ? fallbackRange
                        : "No region"}
                  </span>
                  <span className="history-group-name ck-fit">
                    {region?.name ??
                      (unavailableRegionId != null
                        ? "Section metadata unavailable"
                        : "Ungrouped")}
                  </span>
                  <span className="history-group-meta">
                    {group.blocks.length} set
                    {group.blocks.length === 1 ? "" : "s"}
                    {best != null ? ` · best ♩${best}` : ""} · last{" "}
                    {formatWhen(group.mastery?.last_practiced)}
                  </span>
                </summary>
                <div className="history-group-blocks">
                  {group.blocks.map((block) => (
                    <BlockRow
                      key={block.block_id}
                      block={block}
                      regions={regions}
                      onChanged={load}
                    />
                  ))}
                </div>
              </details>
            );
          })}
          {renderedGroups.length < visibleGroups.length && (
            <button
              type="button"
              className="history-show-more"
              onClick={() =>
                setVisibleGroupCount((count) => count + INITIAL_VISIBLE_GROUPS)
              }
            >
              Show{" "}
              {Math.min(
                INITIAL_VISIBLE_GROUPS,
                visibleGroups.length - renderedGroups.length,
              )}{" "}
              more sections
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
