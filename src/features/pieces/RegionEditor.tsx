import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { useCrud } from "../rep/useCrud";
import type { BlockHistory, Region } from "./types";

export const REGION_COLORS = [
  "#5b5bd6",
  "#2f8f5b",
  "#a86f16",
  "#c93d45",
  "#8a5bc7",
  "#2f7ea8",
  "#c05a5a",
];

/**
 * The one editor for a Tricky Section. `Region` is the canonical record used by
 * Score, Details, Calendar links, Brain context, and practice history. The UI
 * deliberately edits note + measures together so those screens cannot drift.
 */
export function RegionEditor({
  region,
  regions,
  blocks = [],
  onChanged,
  alwaysOpen = false,
}: {
  region: Region;
  regions: Region[];
  blocks?: BlockHistory[];
  onChanged: () => void | Promise<void>;
  alwaysOpen?: boolean;
}) {
  const crud = useCrud();
  const [open, setOpen] = useState(alwaysOpen);
  const [note, setNote] = useState(region.name);
  const [start, setStart] = useState(String(region.m_start));
  const [end, setEnd] = useState(String(region.m_end));
  const [mergeTarget, setMergeTarget] = useState("");
  const [splitAt, setSplitAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote(region.name);
    setStart(String(region.m_start));
    setEnd(String(region.m_end));
  }, [region.m_end, region.m_start, region.name]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (reason) {
      setError(messageOf(reason));
      throw reason;
    }
  }

  const nextStart = Number(start);
  const nextEnd = Number(end);
  const fieldsValid = note.trim().length > 0
    && note.trim().length <= 500
    && Number.isInteger(nextStart)
    && Number.isInteger(nextEnd)
    && nextStart >= 1
    && nextEnd >= nextStart;
  const dirty = note.trim() !== region.name
    || nextStart !== region.m_start
    || nextEnd !== region.m_end;

  async function saveFields() {
    if (!fieldsValid || !dirty || saving) return;
    setSaving(true);
    try {
      await run(() => crud.regionUpdate(region.id, {
        name: note.trim(),
        m_start: nextStart,
        m_end: nextEnd,
      }));
    } finally {
      setSaving(false);
    }
  }

  async function split() {
    const measure = Number(splitAt);
    if (!Number.isInteger(measure) || measure <= region.m_start || measure > region.m_end) {
      setError(`Choose a measure from ${region.m_start + 1} to ${region.m_end}.`);
      return;
    }
    await run(() => crud.regionSplit(region.id, measure));
    setSplitAt("");
  }

  const body = (
    <div className="region-editor-body">
      <form
        className="region-canonical-fields"
        aria-label={`Edit tricky section ${region.name}`}
        onSubmit={(event) => { event.preventDefault(); void saveFields(); }}
      >
        <label className="region-note-field">
          <span className="ck-label">Note / label</span>
          <input
            className="ck-input"
            aria-label="Tricky section note"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="region-measure-fields">
          <label>
            <span className="ck-label">From measure</span>
            <input aria-label="Tricky section start measure" type="number" min="1" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span className="ck-label">To measure</span>
            <input aria-label="Tricky section end measure" type="number" min={Math.max(1, nextStart || 1)} value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        <button className="region-save" type="submit" disabled={!fieldsValid || !dirty || saving}>
          {saving ? "Saving…" : "Save note + measures"}
        </button>
      </form>

      <div className="region-editor-row">
        <span className="ck-label">Shared color</span>
        <div className="region-colors" aria-label="Tricky section color">
          {REGION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Set tricky section color ${color}`}
              className={region.color === color ? "region-color is-on" : "region-color"}
              style={{ backgroundColor: color }}
              onClick={() => void run(() => crud.regionUpdate(region.id, { color })).catch(() => undefined)}
            />
          ))}
          <button type="button" className="region-color-clear" onClick={() => void run(() => crud.regionUpdate(region.id, { color: null })).catch(() => undefined)}>Clear</button>
        </div>
        <small>The same color identifies this note in Details and on every saved score annotation.</small>
      </div>

      {!alwaysOpen && regions.some((item) => item.id !== region.id) && (
        <div className="region-editor-row region-advanced-row">
          <label>
            <span className="ck-label">Merge this into</span>
            <select aria-label="Merge target" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
              <option value="">Choose tricky section…</option>
              {regions.filter((item) => item.id !== region.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <ConfirmDelete label={`Merge “${region.name}” into the selected section? Its practice blocks, linked Calendar work, and compatible score annotations will move there.`} onConfirm={() => run(() => crud.regionMerge(Number(mergeTarget), region.id))}>
            <button type="button" disabled={!mergeTarget}>Merge</button>
          </ConfirmDelete>
        </div>
      )}

      {!alwaysOpen && region.m_end > region.m_start && (
        <div className="region-editor-row region-advanced-row">
          <label>
            <span className="ck-label">Split before measure</span>
            <input aria-label="Split measure" type="number" min={region.m_start + 1} max={region.m_end} value={splitAt} onChange={(event) => setSplitAt(event.target.value)} />
          </label>
          <ConfirmDelete label={`Split “${region.name}” before measure ${splitAt || "…"}? Practice blocks beginning at or after that measure will move to the new half. All score boxes, highlights, and notes for this section will be cleared because their geometry cannot be divided safely; remap both halves afterward.`} onConfirm={split}>
            <button type="button" disabled={!splitAt}>Split</button>
          </ConfirmDelete>
        </div>
      )}

      <ConfirmDelete
        label={`Delete “${region.name}”? Its score boxes, highlights, and annotations will be deleted. Its ${blocks.length} practice block${blocks.length === 1 ? "" : "s"} will stay in history as Ungrouped. Any linked Calendar work will stay but lose this section link.`}
        onConfirm={() => run(() => crud.regionDelete(region.id))}
      >
        <button type="button" className="region-delete">Delete tricky section</button>
      </ConfirmDelete>
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
    </div>
  );

  return (
    <div className={`region-editor ${alwaysOpen ? "is-always-open" : ""}`} style={{ "--region-color": region.color ?? "var(--accent)" } as React.CSSProperties}>
      {!alwaysOpen && (
        <button type="button" className="region-manage-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Close editor" : "Edit note, measures, color or delete"}
        </button>
      )}
      {(open || alwaysOpen) && body}
    </div>
  );
}

/** Details-side list. It includes empty Regions too, so a newly entered tricky
 * section never disappears merely because no practice block exists yet. */
export function TrickySectionsPanel({
  pieceId,
  refreshToken = 0,
  onChanged,
}: {
  pieceId: number;
  refreshToken?: number;
  onChanged?: () => void;
}) {
  const crud = useCrud();
  const [regions, setRegions] = useState<Region[]>([]);
  const [blocks, setBlocks] = useState<BlockHistory[]>([]);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextRegions, nextBlocks] = await Promise.all([
        invoke<Region[]>("region_list", { pieceId }),
        invoke<BlockHistory[]>("rep_blocks_for_piece", { pieceId }),
      ]);
      setRegions(nextRegions ?? []);
      setBlocks(nextBlocks ?? []);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [pieceId]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const blocksByRegion = useMemo(() => {
    const map = new Map<number, BlockHistory[]>();
    for (const block of blocks) {
      if (block.region_id != null) map.set(block.region_id, [...(map.get(block.region_id) ?? []), block]);
    }
    return map;
  }, [blocks]);

  const changed = async () => {
    await load();
    onChanged?.();
  };

  const create = async () => {
    const mStart = Number(start);
    const mEnd = Number(end);
    if (!note.trim() || !Number.isInteger(mStart) || !Number.isInteger(mEnd) || mStart < 1 || mEnd < mStart) {
      setError("Enter a note and a valid measure range.");
      return;
    }
    setError(null);
    try {
      const created = await crud.regionCreate({ piece_id: pieceId, name: note.trim(), m_start: mStart, m_end: mEnd, kind: "hard_spot" });
      await crud.regionUpdate(created.id, { color: REGION_COLORS[regions.length % REGION_COLORS.length] });
      setNote("");
      setStart(String(mEnd + 1));
      setEnd(String(mEnd + 1));
      setAdding(false);
      await changed();
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  return (
    <section className="tricky-sections-panel" aria-label="Tricky sections">
      <div className="piece-section-heading">
        <div>
          <span className="ck-label">Tricky sections</span>
          <p>One shared note, measure range, color, score annotation, and practice history.</p>
        </div>
        <button type="button" className="ck-add" onClick={() => setAdding((value) => !value)}>{adding ? "Cancel" : "+ Add"}</button>
      </div>
      {adding && (
        <form className="tricky-section-add" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label><span className="ck-label">What is tricky?</span><input autoFocus className="ck-input" aria-label="New tricky section note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <label><span className="ck-label">From</span><input aria-label="New tricky section start measure" type="number" min="1" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label><span className="ck-label">To</span><input aria-label="New tricky section end measure" type="number" min="1" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <button type="submit">Create section</button>
        </form>
      )}
      {loading ? <p className="history-empty">Loading tricky sections…</p> : regions.length === 0 ? (
        <p className="history-empty">No tricky sections yet. Add one here or from the score.</p>
      ) : (
        <div className="tricky-section-list">
          {regions.map((region) => (
            <article className="tricky-section-card" key={region.id} style={{ "--region-color": region.color ?? "var(--accent)" } as React.CSSProperties}>
              <div className="tricky-section-card-head">
                <span className="tricky-section-dot" aria-hidden="true" />
                <strong>{region.name}</strong>
                <span>mm. {region.m_start}–{region.m_end}</span>
                <small>{blocksByRegion.get(region.id)?.length ?? 0} practice blocks</small>
              </div>
              <RegionEditor region={region} regions={regions} blocks={blocksByRegion.get(region.id) ?? []} onChanged={changed} />
            </article>
          ))}
        </div>
      )}
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
    </section>
  );
}

function messageOf(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
