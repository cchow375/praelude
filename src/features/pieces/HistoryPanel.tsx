import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BlockRow } from "./BlockRow";
import type { BlockHistory, ProgressSummary, Region, RegionMastery } from "./types";

export interface HistoryGroup {
  region: Region | null;
  blocks: BlockHistory[];
  mastery: RegionMastery | null;
}

export type HistorySort = "recent" | "by-measure" | "most-practiced";

export function filterSortHistory(
  groups: HistoryGroup[],
  options: { query: string; sort: HistorySort },
): HistoryGroup[] {
  const query = options.query.trim().toLocaleLowerCase();
  const filtered = query
    ? groups.filter((group) => {
        const regionText = group.region
          ? `${group.region.name} ${group.region.m_start} ${group.region.m_end} mm.${group.region.m_start}-${group.region.m_end}`
          : "ungrouped no region";
        const blockText = group.blocks
          .map((block) => `${block.label ?? ""} ${block.m_start} ${block.m_end} mm.${block.m_start}-${block.m_end}`)
          .join(" ");
        return `${regionText} ${blockText}`.toLocaleLowerCase().includes(query);
      })
    : [...groups];
  return filtered.sort((a, b) => {
    if (options.sort === "by-measure") {
      const aStart = a.region?.m_start ?? Math.min(...a.blocks.map((block) => block.m_start));
      const bStart = b.region?.m_start ?? Math.min(...b.blocks.map((block) => block.m_start));
      return aStart - bStart;
    }
    if (options.sort === "most-practiced") {
      const reps = (group: HistoryGroup) => group.mastery?.reps ?? group.blocks.reduce((sum, block) => sum + block.reps_done, 0);
      return reps(b) - reps(a);
    }
    const when = (group: HistoryGroup) => Date.parse(group.mastery?.last_practiced ?? "") || 0;
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
    else byRegion.set(block.region_id, [...(byRegion.get(block.region_id) ?? []), block]);
  }
  const summaries = new Map(mastery.map((item) => [item.region_id, item]));
  const groups: HistoryGroup[] = regions
    .map((region) => ({
      region,
      blocks: byRegion.get(region.id) ?? [],
      mastery: summaries.get(region.id) ?? null,
    }))
    .filter((group) => group.blocks.length > 0);
  if (ungrouped.length) groups.push({ region: null, blocks: ungrouped, mastery: null });
  return groups;
}

function formatWhen(value: string | null | undefined) {
  if (!value) return "not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "today";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function HistoryPanel({ pieceId, refreshToken = 0 }: { pieceId: number; refreshToken?: number }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [blocks, setBlocks] = useState<BlockHistory[]>([]);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HistorySort>("recent");

  const load = useCallback(async () => {
    setError(null);
    const [regionResult, blockResult, summaryResult] = await Promise.allSettled([
      invoke<Region[]>("region_list", { pieceId }),
      invoke<BlockHistory[]>("rep_blocks_for_piece", { pieceId }),
      invoke<ProgressSummary>("progress_summary", { pieceId }),
    ]);
    if (regionResult.status === "fulfilled") setRegions(regionResult.value ?? []);
    if (blockResult.status === "fulfilled") setBlocks(blockResult.value ?? []);
    else setError(String(blockResult.reason));
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value ?? null);
    setLoading(false);
  }, [pieceId]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const groups = useMemo(
    () => groupBlocksByRegion(blocks, regions, summary?.per_region_mastery),
    [blocks, regions, summary],
  );
  const visibleGroups = useMemo(
    () => filterSortHistory(groups, { query, sort }),
    [groups, query, sort],
  );

  return (
    <section className="history-panel" aria-label="Practice history">
      <div className="history-heading">
        <div><span className="ck-label">Practice history</span><p>Organized by section. Open a section, then a block, to reach individual reps.</p></div>
        <span className="history-total">{blocks.length} block{blocks.length === 1 ? "" : "s"}</span>
      </div>
      {!loading && groups.length > 0 && (
        <div className="history-toolbar">
          <label className="history-search"><span className="history-search-icon" aria-hidden="true">⌕</span><input type="search" aria-label="Search practice history" placeholder="Section, label, or measure…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <select aria-label="Sort practice history" value={sort} onChange={(event) => setSort(event.target.value as HistorySort)}>
            <option value="recent">Most recent</option>
            <option value="by-measure">By measure</option>
            <option value="most-practiced">Most practiced</option>
          </select>
        </div>
      )}
      {loading ? <p className="history-empty">Loading history…</p> : groups.length === 0 ? <p className="history-empty">No practice blocks yet.</p> : visibleGroups.length === 0 ? <p className="history-empty">No sections match “{query}”.</p> : (
        <div className="history-groups">
          {visibleGroups.map((group) => {
            const region = group.region;
            const best = group.mastery?.best_bpm;
            return (
              <details className="history-group" key={region?.id ?? "ungrouped"}>
                <summary>
                  <span className="history-group-chevron" aria-hidden="true" />
                  <span className="history-group-range">{region ? `mm. ${region.m_start}–${region.m_end}` : "No region"}</span>
                  <span className="history-group-name">{region?.name ?? "Ungrouped"}</span>
                  <span className="history-group-meta">{group.blocks.length} block{group.blocks.length === 1 ? "" : "s"}{best != null ? ` · best ♩${best}` : ""} · last {formatWhen(group.mastery?.last_practiced)}</span>
                </summary>
                <div className="history-group-blocks">
                  {group.blocks.map((block) => <BlockRow key={block.block_id} block={block} regions={regions} onChanged={load} />)}
                </div>
              </details>
            );
          })}
        </div>
      )}
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
    </section>
  );
}
