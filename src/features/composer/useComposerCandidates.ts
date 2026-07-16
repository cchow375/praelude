import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { commandErrorMessage } from "../../services/command";
import type { DailyWork } from "../calendar/types";
import type { BlockHistory, PieceSummary, Region } from "../pieces/types";
import type { RetentionCheckView } from "../retention";
import type { ComposerCandidate } from "./domain";

export interface ComposerCandidateSnapshot {
  readonly pieces: readonly PieceSummary[];
  readonly regions_by_piece: ReadonlyMap<number, readonly Region[]>;
  readonly blocks_by_piece: ReadonlyMap<number, readonly BlockHistory[]>;
  readonly due_retention: readonly RetentionCheckView[];
  readonly planned_work: readonly DailyWork[];
}

export interface ComposerCandidateApi {
  readonly pieces: () => Promise<PieceSummary[]>;
  readonly regions: (pieceId: number) => Promise<Region[]>;
  readonly blocks: (pieceId: number) => Promise<BlockHistory[]>;
  readonly retention: (asOfDate: string) => Promise<RetentionCheckView[]>;
  readonly work: (date: string) => Promise<DailyWork[]>;
}

export const nativeComposerCandidateApi: ComposerCandidateApi = {
  pieces: () => invoke<PieceSummary[]>("pieces_list"),
  regions: (pieceId) => invoke<Region[]>("region_list", { pieceId }),
  blocks: (pieceId) => invoke<BlockHistory[]>("rep_blocks_for_piece", { pieceId }),
  retention: (asOfDate) => invoke<RetentionCheckView[]>("retention_due", { asOfDate }),
  work: (date) => invoke<DailyWork[]>("daily_work_list", {
    from: date,
    to: date,
    pieceId: null,
  }),
};

function attempts(block: BlockHistory): number {
  return block.attempts_recorded ?? block.tries ?? block.reps_done;
}

function latestBlockByRegion(blocks: readonly BlockHistory[]): Map<number, BlockHistory> {
  const latest = new Map<number, BlockHistory>();
  for (const block of blocks) {
    if (block.region_id == null || latest.has(block.region_id)) continue;
    latest.set(block.region_id, block);
  }
  return latest;
}

/**
 * Converts only explicit durable evidence into composer options. It does not
 * calculate mastery, infer a target from an unlinked set, or create work.
 */
export function buildComposerCandidates(
  snapshot: ComposerCandidateSnapshot,
): ComposerCandidate[] {
  const pieceById = new Map(snapshot.pieces.map((piece) => [piece.id, piece]));
  const regionById = new Map<number, Region>();
  for (const regions of snapshot.regions_by_piece.values()) {
    for (const region of regions) regionById.set(region.id, region);
  }
  const candidates: ComposerCandidate[] = [];

  for (const check of snapshot.due_retention) {
    const region = regionById.get(check.region_id);
    const piece = region ? pieceById.get(region.piece_id) : null;
    if (!region || !piece) continue;
    candidates.push({
      id: `retention:${check.id}`,
      piece_ref: String(piece.id),
      target_ref: String(region.id),
      piece_label: piece.title,
      target_label: region.name,
      kind: "due_retention",
      due_on: check.due_date,
      priority: 100,
      estimated_minutes: 4,
      evidence: [{
        evidence_id: `retention-check:${check.id}`,
        evidence_type: "due_retention_check",
        source_ref: { source_type: "retention_check", source_id: String(check.id) },
        observed_at: check.updated_ts,
        detail: `Due ${check.due_date}; historical condition remains evidence only.`,
      }],
    });
  }

  for (const piece of snapshot.pieces) {
    const regions = snapshot.regions_by_piece.get(piece.id) ?? [];
    const blocks = snapshot.blocks_by_piece.get(piece.id) ?? [];
    const latest = latestBlockByRegion(blocks);
    for (const region of regions) {
      const block = latest.get(region.id);
      if (!block) continue;
      const hasError = block.verdicts.failed > 0 || block.verdicts.flawed > 0;
      const unresolved = block.mastery_verified === true
        && block.mastery_status !== "satisfied";
      if (!hasError && !unresolved) continue;
      const kind = hasError ? "recent_failure" : "unresolved_target";
      const recovery = block.recovery_remaining ?? 0;
      candidates.push({
        id: `${kind}:set:${block.block_id}`,
        piece_ref: String(piece.id),
        target_ref: String(region.id),
        piece_label: piece.title,
        target_label: region.name,
        kind,
        priority: recovery > 0 ? 95 : hasError ? 82 : 72,
        estimated_minutes: recovery > 0 ? 8 : 6,
        evidence: [{
          evidence_id: `set:${block.block_id}`,
          evidence_type: kind,
          source_ref: { source_type: "practice_set", source_id: String(block.block_id) },
          detail: `${attempts(block)} attempts; ${block.verdicts.flawed} sloppy; ${block.verdicts.failed} again; ${recovery} recovery remaining.`,
        }],
      });
    }
  }

  for (const work of snapshot.planned_work) {
    if (work.status !== "planned" || !pieceById.has(work.piece_id)) continue;
    const targetRef = work.region_id == null ? `goal:${work.goal_id}` : String(work.region_id);
    candidates.push({
      id: `planned-work:${work.id}`,
      piece_ref: String(work.piece_id),
      target_ref: targetRef,
      piece_label: work.piece_title,
      target_label: work.title,
      kind: "planned_work",
      priority: Math.max(40, 70 - work.sort_order),
      estimated_minutes: work.planned_minutes,
      evidence: [{
        evidence_id: `daily-work:${work.id}`,
        evidence_type: "planned_daily_work",
        source_ref: { source_type: "daily_work", source_id: String(work.id) },
        observed_at: work.updated_ts,
        detail: `${work.planned_minutes} minutes scheduled for ${work.scheduled_date}.`,
      }],
    });
  }

  return candidates;
}

export interface UseComposerCandidates {
  readonly candidates: readonly ComposerCandidate[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => Promise<void>;
}

export function useComposerCandidates({
  active,
  asOfDate,
  api = nativeComposerCandidateApi,
}: {
  readonly active: boolean;
  readonly asOfDate: string;
  readonly api?: ComposerCandidateApi;
}): UseComposerCandidates {
  const [candidates, setCandidates] = useState<ComposerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!active) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const [pieces, dueRetention, plannedWork] = await Promise.all([
        api.pieces(),
        api.retention(asOfDate),
        api.work(asOfDate),
      ]);
      const graphs = await Promise.all((pieces ?? []).map(async (piece) => {
        const [regions, blocks] = await Promise.all([
          api.regions(piece.id),
          api.blocks(piece.id),
        ]);
        return { pieceId: piece.id, regions: regions ?? [], blocks: blocks ?? [] };
      }));
      if (!mounted.current || request !== generation.current) return;
      setCandidates(buildComposerCandidates({
        pieces: pieces ?? [],
        regions_by_piece: new Map(graphs.map((entry) => [entry.pieceId, entry.regions])),
        blocks_by_piece: new Map(graphs.map((entry) => [entry.pieceId, entry.blocks])),
        due_retention: dueRetention ?? [],
        planned_work: plannedWork ?? [],
      }));
    } catch (reason) {
      if (!mounted.current || request !== generation.current) return;
      setCandidates([]);
      setError(commandErrorMessage(reason, "The session draft evidence could not be loaded."));
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [active, api, asOfDate]);

  useEffect(() => {
    if (active) void reload();
    else {
      generation.current += 1;
      setCandidates([]);
      setLoading(false);
      setError(null);
    }
  }, [active, reload]);

  return { candidates, loading, error, reload };
}
