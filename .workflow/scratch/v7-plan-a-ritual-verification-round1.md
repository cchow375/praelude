# Plan A tasks 5-8 (A3 photo calendar, A4 animations) — adversarial verification round 1 (2026-08-24)

Verified at `v7/plan-a-ritual` @ `676d883`. Gates independently reproduced: vitest 2262 passed/1
skipped, cargo 914 passed/0 failed, clippy --all-targets clean, tsc clean. Deltas exact (+27
vitest, +10 rust), zero tests removed, zero .skip/.todo/.only/#[ignore] added. tokens.css diff
empty; no raw hex in any added CSS.

## CONFIRMED
- **Animations genuinely cannot block input.** `pointer-events: none` is on `.completion-fx`
  itself — the `position:fixed; inset:0; z-index:45` element that actually covers — and
  pointer-events inherits, so the mark cannot intercept either. Mutating it to `auto` fails a
  test, so the assertion has teeth. FX_DURATION_MS 1100 < 1.5s; a second moment during the
  first clears the in-flight timer; unmount mid-animation clears it. No Math.random/Date.now,
  no new Audio/AudioContext, prefers-reduced-motion is pure CSS with no matchMedia.
- **Capture card is genuinely skippable.** Esc on the card root with autofocus; the Skip button
  is always rendered and never disabled, including while busy; camera denial falls back to a
  drop zone + file picker with no spinner, no error state, no dead end; no window.confirm.
- **Photos are files, not blobs, in the durable dir.** app_data_dir (not the evictable
  app_cache_dir); row holds only day/rel_path/content_hash/created_at; a second save overwrites
  in place (no orphan); an orphaned file is invisible (row-driven); a row whose file is missing
  is filtered out and the cell falls back to bars.
- devMock routes all five commands through the real invoke seam with a DAY_PHOTOS.clear() on
  install.

## REFUTED
1. **A photo DELETES the day's earned evidence.** CalendarWorkspace.tsx:481-484 gates bars on
   `!photo`; :530 gates the replacement caption on `doneMinutes > 0`. Probe, identical fixtures:
   no photo → "45 planned · 0 done" present; photo with 45 planned/0 done → bars ABSENT and
   caption NONE; photo with 45/38 → "38 done" survives, "45 planned" erased. The code comment
   claiming "the planned-vs-done numbers survive as one caption line" is false. Reachable: end a
   session with a plan but no completed work, accept the photo.
2. **Path traversal in `day_photo_delete`** (lib.rs:1554-1566). No `date::is_valid` before
   `remove_file(dir.join(format!("{day}.jpg")))`, unlike save/read/thumbs. The row-delete
   rejects afterwards and returns Err, but the files are already gone. Proven on a real temp
   filesystem with `day = "../important-backup"`: the victim outside day-photos was deleted.
   No UI caller today, but it is a registered command reachable from the webview.
3. **The rollover ritual loses days two independent ways.** (a) sessions/mod.rs:243 uses ONE
   setting slot, so two rollovers before a launch permanently overwrite the first (probe:
   2026-08-21 unrecoverable). (b) React.StrictMode (main.tsx:28) double-invokes the mount effect
   at Shell.tsx:861-874, whose destructive read-and-clear consumes the setting on call #1 and
   discards the day because its closure sees `alive === false`; call #2 gets null. Probe: card
   NEVER rendered, slot consumed, day gone. Production builds strip the double-invoke, but it
   destroys the day in dev and makes the feature undemoable.
4. **`detectMoment` fires repeatedly and celebrates unearned mastery.** completionFx.tsx:44-50's
   `set_state === "mastered"` branch has no edge detection, so it is true for every pair
   including a snapshot against itself whenever set_state is "mastered" but mastery_status is
   NOT satisfied — a real, intentional state (store/practice_v2.rs:1329-1332; reproduced inside
   the repo's own rep/mod.rs:4614 test). Shell.tsx:421-425 runs it on every rep.snap identity
   change: ten identical polls fired nine celebrations. The visual cites `set_state` while
   contradicting the authoritative `mastery_status` — the same earned-only violation class that
   refuted the galaxy.

## Surviving mutants
| mutation | result |
|---|---|
| `.completion-fx` pointer-events none → auto | KILLED |
| detectMoment returns "set_complete" unconditionally | KILLED |
| **delete the `!photo &&` gate (bars AND photo both render)** | **SURVIVED — 2262 tests green** |
| Esc handler `if (false && …)` | KILLED |
| **day_photo_save writes "deadbeef" instead of sha256_hex** | **SURVIVED — 914 green** |
The bars-XOR-photo contract is entirely unguarded: the only test rendering a photo passes
`historyDays: []`, so there is no progress for the gate to suppress. `content_hash` is never
read back anywhere, and `day_photo_read` rebuilds the path from `row.day`, ignoring the stored
`rel_path` — two write-only fields.

## Other defects
- DayPhotoCapture.tsx:110 and :116 have no `.catch`: a failed save is an unhandled rejection
  with no feedback and a silently lost ritual.
- Esc only fires while focus is inside the card (a fixed corner panel, not a focus-trapping
  modal), so one click elsewhere disables the key path. Skip remains one click.
- devMock `day_photo_prompt` returns a hardcoded null, so the read-and-clear semantics are never
  exercised through the seam; the mock's save also accepts any day string while the real command
  validates.

## Rulings (orchestrator)
A photo is ADDITIVE, never destructive — both planned and done stay in the DOM. Celebrations
fire only on a genuine transition, with `mastery_status` authoritative. Validate then canonicalize
before any filesystem removal. Pending days become a capped LIST, and the prompt read becomes a
PEEK that clears only when the user acts — which fixes StrictMode and crash-between-read-and-clear
together. content_hash and rel_path become load-bearing (verify on read) or go away.
