import { VARIANT_PRESETS, normalizeVariantName, variantNameKey, type VariantLibrary } from "../features/rep/useVariantLibrary";

// Isolated browser fixture only. The installed app persists through SQLite.
let saved: VariantLibrary;
export function resetVariantLibraryMock() {
  saved = { revision: 0, custom_variants: [], hidden_variants: [], routines: [] };
}
resetVariantLibraryMock();
export function getVariantLibraryMock(): VariantLibrary {
  return structuredClone(saved);
}
export function saveVariantLibraryMock(input: VariantLibrary): VariantLibrary {
  const next = structuredClone(input);
  if (!next || !Number.isSafeInteger(next.revision) || next.revision < 0 || next.revision >= Number.MAX_SAFE_INTEGER) throw new Error("Variant library revision is out of range.");
  if (next.revision !== saved.revision) throw new Error("Variant library changed elsewhere. Reload it before saving again.");
  if (!Array.isArray(next.custom_variants) || !Array.isArray(next.hidden_variants) || !Array.isArray(next.routines) || next.custom_variants.length > 100 || next.routines.length > 100) throw new Error("The library supports up to 100 custom variants and 100 routines.");
  const name = (raw: string) => {
    if (typeof raw !== "string") throw new Error("A name is required.");
    const value = normalizeVariantName(raw);
    if (!value || [...value].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error("Variant and routine names must contain 1–80 characters.");
    return value;
  };
  const known = new Map(VARIANT_PRESETS.map(item => [variantNameKey(item.name), item.name]));
  next.custom_variants = next.custom_variants.map(raw => {
    const value = name(raw), key = variantNameKey(value);
    if (known.has(key)) throw new Error(`Variant name already exists: ${value}`);
    known.set(key, value);
    return value;
  });
  const hidden = new Set<string>();
  next.hidden_variants = next.hidden_variants.map(raw => {
    const key = variantNameKey(name(raw));
    if (!known.has(key) || hidden.has(key)) throw new Error("Hidden variants must be unique names from the variant library.");
    hidden.add(key);
    return known.get(key)!;
  });
  const ids = new Set<string>(), names = new Set<string>();
  next.routines = next.routines.map(routine => {
    if (typeof routine.id !== "string" || !routine.id || routine.id.trim() !== routine.id || [...routine.id].length > 80 || ids.has(routine.id) || /[\u0000-\u001f\u007f-\u009f]/.test(routine.id)) throw new Error("Routine IDs must be unique, nonempty IDs of at most 80 characters.");
    ids.add(routine.id);
    const title = name(routine.name), key = variantNameKey(title);
    if (names.has(key)) throw new Error(`Routine name already exists: ${title}`);
    names.add(key);
    if (!Array.isArray(routine.stages) || !routine.stages.length || routine.stages.length > 64) throw new Error("Each routine needs 1–64 stages.");
    return { id: routine.id, name: title, stages: routine.stages.map(stage => {
      if (!Number.isInteger(stage.clean_streak) || stage.clean_streak < 1 || stage.clean_streak > 100) throw new Error("Each routine stage needs a clean streak of 1–100.");
      return { name: name(stage.name), clean_streak: stage.clean_streak };
    }) };
  });
  saved = { ...next, revision: next.revision + 1 };
  return getVariantLibraryMock();
}
