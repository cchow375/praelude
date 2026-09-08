import { useState } from "react";
import { createCommandId } from "../../services/commandId";
import { VariantLibraryDelete } from "./VariantLibraryDelete";
import { normalizeVariantName, variantNameKey, VARIANT_PRESETS, type RoutineStage, type useVariantLibrary } from "./useVariantLibrary";
import "./variantLibrary.css";

type LibraryState = ReturnType<typeof useVariantLibrary>;
export function VariantLibraryControls({ state, stages, onApply }: {
  state: LibraryState; stages: RoutineStage[]; onApply: (stages: RoutineStage[]) => void;
}) {
  const { library, busy, error, saved, save, reload } = state;
  const [manage, setManage] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [routineName, setRoutineName] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const disabled = !library || busy;
  const all = [...VARIANT_PRESETS, ...(library?.custom_variants ?? []).map(name => ({ name, label: name }))];
  const addCustom = async () => {
    if (!library) return;
    const name = normalizeVariantName(customName);
    if (!name || name.length > 80) { setValidation("Enter a variant name of 1–80 characters."); return; }
    if (all.some(item => variantNameKey(item.name) === variantNameKey(name))) {
      setValidation("That variant already exists. Turn on Show to display it."); return;
    }
    setValidation(null);
    if (await save({ ...library, custom_variants: [...library.custom_variants, name] })) setCustomName("");
  };
  const saveRoutine = async (replaceId?: string) => {
    if (!library) return;
    const name = normalizeVariantName(routineName);
    if (!name || name.length > 80) { setValidation("Enter a routine name of 1–80 characters."); return; }
    if (!stages.length || stages.length > 64 || stages.some(s => !normalizeVariantName(s.name) || s.name.length > 80 || !Number.isInteger(s.clean_streak) || s.clean_streak < 1 || s.clean_streak > 100)) {
      setValidation("Choose 1–64 stages, each with a name and 1–100 consecutive cleans."); return;
    }
    if (!replaceId && library.routines.some(r => variantNameKey(r.name) === variantNameKey(name))) {
      setValidation("That routine exists. Use Replace with current sequence to update it."); return;
    }
    setValidation(null);
    const routine = { id: replaceId ?? createCommandId("variant-routine"), name, stages: stages.map(s => ({ ...s, name: normalizeVariantName(s.name) })) };
    const routines = replaceId ? library.routines.map(r => r.id === replaceId ? routine : r) : [...library.routines, routine];
    if (await save({ ...library, routines })) setRoutineName("");
  };
  return <div className="variant-library">
    {!!library?.routines.length && <section className="variant-routines" aria-label="Saved routines">
      <span className="ck-label">Routines</span>
      <div className="ck-chip-row">{library.routines.map(routine => <button key={routine.id} type="button" className="ck-chip"
        title={routine.stages.map(s => `${s.name} (${s.clean_streak})`).join(" → ")}
        onClick={() => onApply(routine.stages.map(s => ({ ...s })))}>{routine.name}</button>)}</div>
      <small>Choose a routine to replace this set’s sequence.</small>
    </section>}
    <button className="ck-chip" type="button" aria-expanded={manage} onClick={() => setManage(value => !value)}>Manage variants</button>
    {error && <div role="alert">{error} <button type="button" className="ck-chip" disabled={busy} onClick={() => void reload()}>Reload library</button><small>Your current sequence and typed names are kept.</small></div>}
    <button className="ck-chip" type="button" aria-expanded={routineOpen || manage} onClick={() => setRoutineOpen(value => !value)}>Save sequence as routine</button>
    {(routineOpen || manage) && <div className="variant-library-manager">
      <div className="variant-library-add"><label className="ck-field"><span className="ck-label">Save current sequence as a routine</span><input className="ck-input" aria-label="Routine name" maxLength={80} value={routineName} placeholder="e.g. Rhythm & touch" onChange={e => setRoutineName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void saveRoutine(); } }}/></label>
        <button className="ck-chip" type="button" disabled={disabled || !stages.length || !routineName.trim()} onClick={() => void saveRoutine()}>Save routine</button></div>
      <small>Build the sequence below first. Order and each stage’s clean count are saved.</small>
      {library?.routines.map(r => <div className="variant-library-routine" key={r.id}><div><strong>{r.name}</strong><small>{r.stages.map(s => `${s.name} (${s.clean_streak})`).join(" → ")}</small></div>
        <button type="button" className="ck-chip" disabled={disabled || !stages.length || !routineName.trim()} onClick={() => void saveRoutine(r.id)}>Replace {r.name} with current sequence</button>
        <VariantLibraryDelete name={`Delete routine ${r.name}`} label={`Delete “${r.name}”? The current sequence is kept.`} busy={busy} onDelete={() => save({ ...library, routines: library.routines.filter(item => item.id !== r.id) })} /></div>)}
      <small>To replace a routine, enter its desired name above and choose Replace.</small>
    </div>}
    {manage && <div className="variant-library-manager">
      <p className="ck-tuning-note">Saved across pieces and app restarts. Hide a variant to remove its shortcut; existing sequences stay intact.</p>
      {!library && !error && <p role="status">Loading library…</p>}
      <div className="variant-library-add"><label className="ck-field"><span className="ck-label">New saved variant</span><input className="ck-input" aria-label="Saved variant name" maxLength={80} value={customName} onChange={e => setCustomName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addCustom(); } }}/></label>
        <button className="ck-chip" type="button" disabled={disabled || !customName.trim()} onClick={() => void addCustom()}>Save to library</button></div>
      <div className="variant-library-visibility" aria-label="Variant visibility">{all.map(item => <div key={item.name} className="variant-library-item">
        <label><input type="checkbox" aria-label={`Show ${item.label}`} disabled={disabled} checked={!library?.hidden_variants.some(n => variantNameKey(n) === variantNameKey(item.name))}
          onChange={e => { if (library) void save({ ...library, hidden_variants: e.target.checked ? library.hidden_variants.filter(n => variantNameKey(n) !== variantNameKey(item.name)) : [...library.hidden_variants, item.name] }); }}/><span>{item.label}</span></label>
        {library?.custom_variants.includes(item.name) && <VariantLibraryDelete name={`Delete saved variant ${item.label}`} label={`Delete “${item.label}”? Existing routines and sequences are kept.`} busy={busy} onDelete={() => save({ ...library, custom_variants: library.custom_variants.filter(n => n !== item.name), hidden_variants: library.hidden_variants.filter(n => variantNameKey(n) !== variantNameKey(item.name)) })} />}
      </div>)}</div>
    </div>}
    {validation && <p role="alert">{validation}</p>}
    {(busy || saved) && <span role="status">{busy ? "Saving…" : "Saved"}</span>}
  </div>;
}
