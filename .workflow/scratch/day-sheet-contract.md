# Day-sheet backend contract (branch lane/c-daysheet-backend, commit 720abac)

Commands (Tauri invoke, JS camelCase args → Rust snake_case):

- `day_sheet_get({ date })` → `DaySheet | null`
- `day_sheet_save({ date, bodyJson })` → `DaySheet` (bodyJson is a JSON STRING)
- `piece_plan_get({ pieceId })` → `PiecePlan | null`
- `piece_plan_save({ pieceId, bodyText })` → `PiecePlan`
  Errors: rejected promise with plain string.

Types:

- `DaySheet = { date: string, body: NotebookLine[], updated_at: string /* RFC3339 Z */ }`
  (get/save RETURN parsed body array; save TAKES body_json string)
- `PiecePlan = { piece_id: number, body_text: string, updated_at: string }`

NotebookLine JSON (internally tagged `type`, snake_case; unknown type/field REJECTED):

- {"type":"text","text":string}
- {"type":"piece","piece_id":number} // >=1
- {"type":"item","text":string,"checked":bool,"piece_id"?:number} // checked defaults false
- {"type":"block","minutes":number,"piece_id"?:number} // minutes 1..=1440
- {"type":"lesson_notes","text":string}
- {"type":"lesson_prep","bring":number[],"want":string} // bring = piece_ids >=1, max 200
- {"type":"goal_ref","goal_id":number} // >=1

Bounds: ≤2000 lines/sheet; ≤8000 chars per text field; piece_plan body ≤40000 chars.
Empty sheet `"[]"` valid. Save stores canonical re-serialization (null optionals skipped) —
editor must reconcile from the RETURNED body. No-row get → null → render blank sheet (daily
reset semantics; no auto-carry-over). localStorage todayPlan one-time migration = frontend work,
NOT done. SCHEMA_VERSION now 11 — any other lane bumping schema must coordinate.
