import { useState } from "react";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { EditableField } from "../../components/EditableField";
import { useCrud } from "../rep/useCrud";
import type { BlockHistory, Region } from "./types";

const COLORS = ["#5b5bd6", "#2f8f5b", "#a86f16", "#c93d45", "#8a5bc7"];

export function RegionEditor({
  region,
  regions,
  blocks = [],
  onChanged,
}: {
  region: Region;
  regions: Region[];
  blocks?: BlockHistory[];
  onChanged: () => void | Promise<void>;
}) {
  const crud = useCrud();
  const [open, setOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [splitAt, setSplitAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function split() {
    const measure = Number(splitAt);
    if (!Number.isInteger(measure) || measure <= region.m_start || measure > region.m_end) {
      setError(`Choose a measure from ${region.m_start + 1} to ${region.m_end}.`);
      return;
    }
    await run(async () => {
      const created = await crud.regionCreate({
        piece_id: region.piece_id,
        name: `${region.name} · part 2`,
        m_start: measure,
        m_end: region.m_end,
        kind: region.kind,
      });
      await crud.regionUpdate(region.id, { m_end: measure - 1 });
      for (const block of blocks.filter((item) => item.m_start >= measure)) {
        await crud.blockUpdate(block.block_id, { region_id: created.id });
      }
    });
    setSplitAt("");
  }

  return (
    <div className="region-editor">
      <button type="button" className="region-manage-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Done" : "Manage section"}
      </button>
      {open && (
        <div className="region-editor-body">
          <div className="region-editor-row region-editor-name">
            <span className="ck-label">Name</span>
            <EditableField value={region.name} ariaLabel="region name" onSave={(name) => run(() => crud.regionUpdate(region.id, { name }))} />
          </div>
          <div className="region-editor-row">
            <span className="ck-label">Color</span>
            <div className="region-colors">
              {COLORS.map((color) => <button key={color} type="button" aria-label={`Set region color ${color}`} className={region.color === color ? "region-color is-on" : "region-color"} style={{ backgroundColor: color }} onClick={() => void run(() => crud.regionUpdate(region.id, { color }))} />)}
              <button type="button" className="region-color-clear" onClick={() => void run(() => crud.regionUpdate(region.id, { color: null }))}>Clear</button>
            </div>
          </div>
          {regions.some((item) => item.id !== region.id) && (
            <div className="region-editor-row">
              <label><span className="ck-label">Merge into</span><select aria-label="Merge target" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Choose section…</option>{regions.filter((item) => item.id !== region.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <button type="button" disabled={!mergeTarget} onClick={() => void run(() => crud.regionMerge(Number(mergeTarget), region.id))}>Merge</button>
            </div>
          )}
          {region.m_end > region.m_start && (
            <div className="region-editor-row">
              <label><span className="ck-label">Split before measure</span><input aria-label="Split measure" type="number" min={region.m_start + 1} max={region.m_end} value={splitAt} onChange={(event) => setSplitAt(event.target.value)} /></label>
              <button type="button" onClick={() => void split()}>Split</button>
            </div>
          )}
          <ConfirmDelete label={`Delete this section? Its ${blocks.length} blocks will move to Ungrouped.`} onConfirm={() => run(() => crud.regionDelete(region.id))}>
            <button type="button" className="region-delete">Delete section</button>
          </ConfirmDelete>
          {error && <p className="ck-inline-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
