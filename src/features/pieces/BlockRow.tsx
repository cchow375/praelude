import { useState } from "react";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { EditableField } from "../../components/EditableField";
import { EditableNumber } from "../../components/EditableNumber";
import { useCrud } from "../rep/useCrud";
import type { BlockHistory, Rep } from "./types";

interface BlockRowProps {
  block: BlockHistory;
  onChanged: () => void;
  regions?: { id: number; name: string }[];
}

export function BlockRow({ block, onChanged, regions = [] }: BlockRowProps) {
  const crud = useCrud();
  const [expanded, setExpanded] = useState(false);
  const [reps, setReps] = useState<Rep[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function change(patch: Parameters<typeof crud.blockUpdate>[1]) {
    setError(null);
    try {
      await crud.blockUpdate(block.block_id, patch);
      onChanged();
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }

  async function loadReps() {
    setExpanded((value) => !value);
    if (!expanded) {
      try {
        setReps((await crud.repsForBlock(block.block_id)) ?? []);
      } catch (reason) {
        setError(String(reason));
      }
    }
  }

  async function refreshReps() {
    setReps((await crud.repsForBlock(block.block_id)) ?? []);
    onChanged();
  }

  return (
    <article className="history-block">
      <div className="history-block-summary">
        <button
          type="button"
          className="history-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} block ${block.block_id}`}
          onClick={loadReps}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span className="history-range">
          mm. <EditableNumber value={block.m_start} min={1} ariaLabel="start measure" onSave={(m_start) => change({ m_start: m_start! })} />–<EditableNumber value={block.m_end} min={1} ariaLabel="end measure" onSave={(m_end) => change({ m_end: m_end! })} />
        </span>
        <EditableField
          value={block.label ?? ""}
          placeholder="Add label"
          ariaLabel="block label"
          onSave={(label) => change({ label: label || null })}
        />
        {block.focus === "tempo" && (
          <span className="history-tempo">
            ♩ <EditableNumber value={block.start_bpm} min={1} allowNull ariaLabel="start bpm" onSave={(start_bpm) => change({ start_bpm })} />
            {block.bpm != null && block.bpm !== block.start_bpm ? ` → ${block.bpm}` : ""}
          </span>
        )}
        <span className="history-count">{block.reps_done}/{block.planned_reps}</span>
        <span className="history-verdicts" aria-label="Verdict counts">
          <span className="is-clean">{block.verdicts.clean}</span>
          <span className="is-flawed">{block.verdicts.flawed}</span>
          <span className="is-failed">{block.verdicts.failed}</span>
        </span>
        <ConfirmDelete
          label={`Delete this block and its ${block.reps_done} reps?`}
          onConfirm={async () => {
            await crud.blockDelete(block.block_id);
            onChanged();
          }}
        >
          <button type="button" className="history-delete" aria-label={`Delete block ${block.block_id}`}>×</button>
        </ConfirmDelete>
      </div>

      <div className="history-block-controls">
        <label>
          Focus
          <select value={block.focus} aria-label="block focus" onChange={(event) => void change({ focus: event.target.value })}>
            {['tempo', 'notes', 'phrasing', 'dynamics', 'memory', 'hands', 'other'].map((focus) => <option key={focus}>{focus}</option>)}
          </select>
        </label>
        <label className="history-check">
          <input type="checkbox" checked={block.use_metronome} onChange={(event) => void change({ use_metronome: event.target.checked })} /> metronome
        </label>
        <label>
          Planned reps <EditableNumber value={block.planned_reps} min={1} ariaLabel="planned reps" onSave={(planned_reps) => change({ planned_reps: planned_reps! })} />
        </label>
        {regions.length > 0 && <label>Region <select value={block.region_id ?? ""} onChange={(event) => void change({ region_id: event.target.value ? Number(event.target.value) : null })}><option value="">Ungrouped</option>{regions.map((region) => <option value={region.id} key={region.id}>{region.name}</option>)}</select></label>}
      </div>

      {expanded && (
        <ul className="history-reps">
          {reps.length === 0 ? <li className="history-empty">No reps logged.</li> : reps.map((rep, index) => (
            <li key={rep.id} className="history-rep">
              <span className="history-rep-index">{index + 1}</span>
              <select
                aria-label={`Rep ${index + 1} verdict`}
                value={rep.verdict}
                onChange={async (event) => {
                  await crud.repUpdate(rep.id, { verdict: event.target.value as Rep["verdict"] });
                  await refreshReps();
                }}
              >
                <option value="clean">Clean</option>
                <option value="flawed">Sloppy</option>
                <option value="failed">Again</option>
              </select>
              <span className="history-rep-bpm">{block.focus === "tempo" ? `♩ ${rep.bpm}` : block.focus}</span>
              <EditableField value={rep.note ?? ""} placeholder="Add note" ariaLabel={`Rep ${index + 1} note`} onSave={async (note) => { await crud.repUpdate(rep.id, { note: note || null }); await refreshReps(); }} />
              <ConfirmDelete label="Delete this rep?" onConfirm={async () => { await crud.repDelete(rep.id); await refreshReps(); }}>
                <button type="button" className="history-delete" aria-label={`Delete rep ${index + 1}`}>×</button>
              </ConfirmDelete>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
    </article>
  );
}
