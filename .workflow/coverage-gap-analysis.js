export const meta = {
  name: "coverage-gap-analysis",
  description:
    "Analyze Praelude test coverage: untested code + edge-case/error/integration gaps in tested code, with test skeletons",
  phases: [{ title: "Untested code" }, { title: "Gap analysis" }],
};

const GAP_SCHEMA = {
  type: "object",
  properties: {
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "repo-relative path" },
          symbol: {
            type: "string",
            description: "function/class/component/hook name",
          },
          area: {
            type: "string",
            enum: [
              "untested-function",
              "edge-case",
              "error-handling",
              "integration",
            ],
          },
          summary: {
            type: "string",
            description: "one sentence: what is untested and why it matters",
          },
          test_skeleton: {
            type: "string",
            description:
              "runnable-shaped test skeleton (vitest or #[cfg(test)] Rust, matching the file language), following this repo's existing conventions",
          },
        },
        required: ["file", "area", "summary", "test_skeleton"],
      },
    },
    false_positives: {
      type: "array",
      items: { type: "string" },
      description:
        "files you were told were untested but found ARE covered (e.g. by a differently-named test file) - name the file and the test file that covers it",
    },
  },
  required: ["gaps"],
};

const FRONTEND_CONVENTIONS = `
Repo: Praelude (Tauri v2, Rust + React/TS). Frontend tests use vitest + @testing-library/react.
Conventions observed in this repo's existing tests:
- Tauri IPC is mocked via: vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invokeMock(...args) })) with invokeMock = vi.fn(), reset in beforeEach.
- Hooks are tested with renderHook/act/waitFor from @testing-library/react.
- Rejections from invoke() are often swallowed by hooks (fire-and-forget persistence) - tests assert the swallow doesn't throw and state stays sane.
- Timers: tests use vi.useFakeTimers()/vi.setSystemTime() for date logic, or real setTimeout with await new Promise(resolve => setTimeout(resolve, N)) for debounce/persist timers.
- Some modules are tested indirectly through src/devMock/tauriDevMock.*.test.ts (seam tests hitting window.__TAURI_INTERNALS__.invoke), not a same-named sibling test file. Before declaring a file "untested", grep the test suite (rg -l "<exported symbol or file basename>" src) for indirect coverage and report it as a false_positive instead if found.
- Pure type-only files (types.ts with only interfaces/type exports, or index.ts that only re-exports) do not need tests - skip them, don't invent busywork tests.
`;

const RUST_CONVENTIONS = `
Repo: Praelude (Tauri v2, Rust backend under src-tauri/src). Rust tests use inline #[cfg(test)] mod tests { use super::*; ... } at the bottom of the same file, run via \`cargo test\`.
Conventions observed in this repo's existing tests:
- In-memory SQLite for store tests: Connection::open_in_memory().unwrap(), then run the same migrations the real Store runs.
- Fake/deterministic collaborators are hand-rolled structs implementing the relevant trait, e.g. a FixedClock implementing PracticeClock (stores a Mutex<String>, .set() to advance), and a RecEmitter implementing StateEmitter (Mutex<Vec<(String, Value)>>) to assert emitted events.
- Golden rule per project docs: "Deterministic hot loop" for voice/intent routing (regex intent router) - the LLM brain is only for open questions. Tests for intent/voice modules should assert deterministic regex-based routing, not mock an LLM.
- "User is the sensor; the app is the memory" - audio/stt modules must never infer musical correctness from audio; tests should confirm no such inference is attempted, only speech-driven state transitions.
`;

async function analyzeBatch(files, langNote, phaseName, label) {
  return agent(
    `You are auditing test coverage for the Praelude codebase in the current repository (src-tauri = Rust backend, src = React/TS frontend).

${langNote}

These files currently have NO matching test file by naive sibling-name lookup (e.g. foo.ts has no foo.test.ts):
${files.map((f) => `- ${f}`).join("\n")}

For EACH file:
1. Read it in full.
2. Verify it is genuinely untested: grep the relevant test directory for any test that imports/exercises this file's exports (tests are sometimes named differently, e.g. quotes.honesty.test.ts covers quotes.ts, or a dev-mock seam test covers a mock module). If you find real coverage, add the file to false_positives with the covering test file's path, and do NOT report gaps for it.
3. If genuinely untested and it contains real logic (not just types/re-exports), identify the untested functions/classes/hooks/components, meaningful edge cases (empty input, boundary values, concurrent/rapid calls, unmount-during-async, malformed IPC payloads, etc.), and any missing error-handling coverage (rejected promises, invalid state transitions, validation failures).
4. For each gap, write a concrete test skeleton (vitest/RTL or Rust #[cfg(test)], matching the file's language) that follows this repo's existing conventions - runnable-shaped (real imports, real mock setup, a specific assertion), not just a comment placeholder.

Skip files that are pure type declarations or pure re-export barrels (types.ts with only interfaces, index.ts with only \`export * from\`) - note them as "no logic, skip" in false_positives instead of inventing busywork.

Report via the required schema.`,
    { label, phase: phaseName, schema: GAP_SCHEMA, effort: "high" },
  );
}

async function gapAnalyzeCritical(
  files,
  langNote,
  extraContext,
  phaseName,
  label,
) {
  return agent(
    `You are auditing test coverage GAPS in ALREADY-TESTED, high-stakes Praelude modules in the current repository.

${langNote}
${extraContext}

Files to audit (each already has a test file/suite, so do not report "the file has no tests" - instead find what's MISSING from the existing suite):
${files.map((f) => `- ${f}`).join("\n")}

For each file:
1. Read the source file in full.
2. Read its existing test file(s) (Rust: the #[cfg(test)] mod tests block at the bottom of the same file; TS: the sibling .test.ts(x), and any *.honesty.test.ts / seam tests that cover it indirectly).
3. Diff mentally: which exported functions/public methods/components have ZERO test coverage? Which covered functions are missing edge cases (empty/null/zero/negative/boundary values, concurrent or out-of-order calls, unmount-mid-async, malformed/partial persisted data, clock/timezone boundaries, retry/dedupe/idempotency paths)? Which error paths (invalid input, DB constraint violations, rejected IPC calls, malformed JSON, expired/stale state) are never exercised? Are there integration seams (e.g. this module's interaction with an adjacent module, or a full round-trip through persistence) that only unit tests cover in isolation, missing an end-to-end path?
4. Only report genuine gaps you can point to concretely - do not pad with trivial or already-covered cases. Prioritize gaps that could hide a real bug (data loss, incorrect state transition, silent failure) over cosmetic ones.
5. For each gap, write a concrete test skeleton matching this repo's existing conventions (see above) - runnable-shaped, not a placeholder comment.

Report via the required schema.`,
    { label, phase: phaseName, schema: GAP_SCHEMA, effort: "high" },
  );
}

phase("Untested code");

const untestedResults = await parallel([
  () =>
    analyzeBatch(
      [
        "src/App.tsx",
        "src/main.tsx",
        "src/shell/terms.ts",
        "src/devMock/tauriDevMock.ts",
        "src/content/quotes.ts",
        "src/features/settings/SettingsIcons.tsx",
        "src/features/today/todayPlan.ts",
        "src/features/today/format.ts",
        "src/features/today/menuIcons.tsx",
        "src/features/retention/useRetention.ts",
        "src/features/rep/pausedSets.ts",
      ],
      FRONTEND_CONVENTIONS,
      "Untested code",
      "untested:frontend-1",
    ),
  () =>
    analyzeBatch(
      [
        "src/features/notebook/DaySheetStore.tsx",
        "src/features/notebook/notebookIcons.tsx",
        "src/features/notebook/useAutosavedDocument.ts",
        "src/features/notebook/daySheetOps.ts",
        "src/features/dock/DockProvider.tsx",
        "src/features/metronome/MetronomeIcons.tsx",
        "src/features/composer/domain/models.ts",
        "src/features/score/marks/api.ts",
        "src/features/score/atlas/result.ts",
        "src/features/score/atlas/model.ts",
        "src/features/voice/fixtures/tierAReplay.ts",
      ],
      FRONTEND_CONVENTIONS,
      "Untested code",
      "untested:frontend-2",
    ),
  () =>
    analyzeBatch(
      [
        "src/ui/index.ts",
        "src/features/calendar/types.ts",
        "src/features/retention/types.ts",
        "src/features/retention/index.ts",
        "src/features/composer/index.ts",
        "src/features/pieces/types.ts",
        "src/features/score/types.ts",
        "src/features/brain/types.ts",
        "src/features/tutorials/types.ts",
        "src/features/universe/types.ts",
        "src/features/composer/domain/index.ts",
        "src/features/score/atlas/index.ts",
        "src/features/voice/domain/index.ts",
        "src/features/score/atlas/ui/index.ts",
      ],
      FRONTEND_CONVENTIONS,
      "Untested code",
      "untested:frontend-3",
    ),
  () =>
    analyzeBatch(
      ["src-tauri/src/store/practice_loop.rs"],
      RUST_CONVENTIONS +
        "\nThis is a 1874-line file with ~35 functions covering V2.4 focus-loop, durable operation receipts, accepted recovery, safety, and retention persistence - core practice-session state machine logic. It currently has ZERO #[cfg(test)] block. Check whether Store methods that delegate into it are covered indirectly by tests elsewhere in src-tauri/src/rep/mod.rs or src-tauri/src/store/mod.rs (grep for it), but this file itself owns direct unit-testable pure functions (e.g. validate_timestamp, validate_date, validate_retention_condition) that deserve direct coverage.",
      "Untested code",
      "untested:rust-practice_loop",
    ),
  () =>
    analyzeBatch(
      [
        "src-tauri/src/store/v8_backfill.rs",
        "src-tauri/src/stt/mod.rs",
        "src-tauri/src/main.rs",
      ],
      RUST_CONVENTIONS +
        "\nmain.rs is a 6-line entry point (likely just calls into lib.rs) - if it truly has no testable logic, note it as no-logic/skip rather than forcing a test.",
      "Untested code",
      "untested:rust-misc",
    ),
]);

phase("Gap analysis");

const gapResults = await parallel([
  () =>
    gapAnalyzeCritical(
      [
        "src-tauri/src/audio/mod.rs",
        "src-tauri/src/audio/clock.rs",
        "src-tauri/src/audio/mixer.rs",
        "src-tauri/src/metronome.rs",
      ],
      RUST_CONVENTIONS,
      '\nCONTEXT: NOTES.md flags src-tauri/src/audio as a "read before touching" hard-won-gotchas area. This is real-time audio scheduling/mixing/metronome timing - a classic source of off-by-one-sample, drift, and race-condition bugs that unit tests often miss.',
      "Gap analysis",
      "gap:audio-metronome",
    ),
  () =>
    gapAnalyzeCritical(
      [
        "src-tauri/src/stt/supervisor.rs",
        "src-tauri/src/tts/mod.rs",
        "src-tauri/src/tts/say.rs",
        "src-tauri/src/tts/gemini.rs",
      ],
      RUST_CONVENTIONS,
      '\nCONTEXT: speech recognition supervisor + TTS providers (macOS say + Gemini). Golden rule: "user is the sensor" - speech is never used to infer musical correctness. Look for gaps in supervisor restart/crash-recovery logic, provider fallback/error handling, and any untested boundary between STT events and app state.',
      "Gap analysis",
      "gap:stt-tts",
    ),
  () =>
    gapAnalyzeCritical(
      ["src-tauri/src/rep/mod.rs", "src-tauri/src/rep/ladder.rs"],
      RUST_CONVENTIONS,
      "\nCONTEXT: rep/mod.rs is the largest module in the backend (4464 lines) - core rep-recording/mastery-ladder logic. It already has substantial tests; focus on finding genuinely UNCOVERED branches (mastery streak edge cases, ladder regression/promotion boundaries, concurrent rep submission, invalid verdict transitions) rather than re-describing what is already well covered.",
      "Gap analysis",
      "gap:rep-ladder",
    ),
  () =>
    gapAnalyzeCritical(
      ["src-tauri/src/store/migrations.rs", "src-tauri/src/store/mod.rs"],
      RUST_CONVENTIONS,
      "\nCONTEXT: schema migrations (currently v13, mid-flight to v14 per project docs) plus the core Store. A missed migration edge case (partial-apply, out-of-order version, migrating a DB from an old app version) can corrupt a user's real practice history - this is the highest-blast-radius module in the app. Prioritize gaps around migration idempotency, downgrade/rollback safety, and migrating from EVERY historical schema version, not just the latest.",
      "Gap analysis",
      "gap:store-migrations",
    ),
  () =>
    gapAnalyzeCritical(
      [
        "src-tauri/src/voice_loop.rs",
        "src-tauri/src/intent/mod.rs",
        "src-tauri/src/intent/numbers.rs",
      ],
      RUST_CONVENTIONS,
      '\nCONTEXT: "Deterministic hot loop (regex intent router); the LLM brain is for open questions only" is a golden project rule. voice_loop.rs (2203 lines) and the intent router are the deterministic path that must never depend on an LLM. Look for untested regex-router ambiguities (two intents that could both match an utterance), number-parsing edge cases (numbers.rs: spoken fractions, ranges, ordinals), and voice-loop state machine transitions under rapid/garbled/interrupted speech.',
      "Gap analysis",
      "gap:voice-intent",
    ),
  () =>
    gapAnalyzeCritical(
      [
        "src-tauri/src/brain/mod.rs",
        "src-tauri/src/brain/provider.rs",
        "src-tauri/src/brain/corpus.rs",
      ],
      RUST_CONVENTIONS,
      '\nCONTEXT: the LLM "brain" layer (provider abstraction over Claude/Gemini/offline, and the quote/corpus honesty-gated knowledge base). Look for gaps in provider fallback when a provider errors/times out, malformed provider responses, and corpus lookup edge cases (quote not found, source file missing, whitespace-normalization boundary cases already covered on the TS side in quoteMatch.ts - check whether the Rust-side equivalent has matching coverage).',
      "Gap analysis",
      "gap:brain",
    ),
  () =>
    gapAnalyzeCritical(
      ["src-tauri/src/store/practice_v2.rs", "src-tauri/src/store/crud.rs"],
      RUST_CONVENTIONS,
      "",
      "Gap analysis",
      "gap:store-practice-crud",
    ),
  () =>
    gapAnalyzeCritical(
      [
        "src/features/rep/useRep.ts",
        "src/features/session/useSession.ts",
        "src/features/voice",
      ],
      FRONTEND_CONVENTIONS,
      "\nNOTE: src/features/voice is a directory - glob it first (ls/rg) and pick the real hook/domain logic files (not fixtures/types) to audit; the fixtures/tierAReplay.ts file is covered in the untested-code phase already, do not repeat it here.",
      "Gap analysis",
      "gap:frontend-rep-session-voice",
    ),
  () =>
    gapAnalyzeCritical(
      ["src/features/calendar", "src/features/notebook", "src/features/today"],
      FRONTEND_CONVENTIONS,
      "\nNOTE: these are directories - glob/list them first and pick the files that already HAVE test coverage (e.g. api.ts/api.test.ts, dates.ts/dates.test.ts) to audit for gaps. Skip files already covered in the untested-code phase (DaySheetStore.tsx, daySheetOps.ts, useAutosavedDocument.ts, todayPlan.ts, format.ts).",
      "Gap analysis",
      "gap:frontend-calendar-notebook-today",
    ),
]);

return {
  untested: untestedResults.filter(Boolean),
  gaps: gapResults.filter(Boolean),
};
