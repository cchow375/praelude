export const meta = {
  name: "devmock-coverage-audit",
  description:
    "Find real (non-trivial) command handlers in tauriDevMock.ts that are never exercised through the real invoke seam, then draft test skeletons",
  phases: [
    {
      title: "Analyze",
      detail: "per-bucket: read case blocks, check real-seam coverage",
    },
    { title: "Verify", detail: "adversarially re-check each confirmed gap" },
  ],
};

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          hasRealLogic: { type: "boolean" },
          gapConfirmed: { type: "boolean" },
          evidence: {
            type: "string",
            description: "file:line citations backing the verdict",
          },
          gapDescription: {
            type: "string",
            description:
              'the SPECIFIC untested branch/validation/error path, not just "untested"',
          },
          skeleton: {
            type: "string",
            description:
              "a runnable vitest skeleton (or empty string if gapConfirmed is false)",
          },
        },
        required: [
          "command",
          "hasRealLogic",
          "gapConfirmed",
          "evidence",
          "gapDescription",
          "skeleton",
        ],
      },
    },
  },
  required: ["findings"],
};

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          stillConfirmed: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["command", "stillConfirmed", "note"],
      },
    },
  },
  required: ["verdicts"],
};

const PREAMBLE = `You are auditing test coverage for CodaKiller, a Tauri v2 + React/TS app. There is a
dev-only fake backend at src/devMock/tauriDevMock.ts (~3100 lines) that intercepts
window.__TAURI_INTERNALS__.invoke and answers each command via a big \`switch (cmd)\` /
routeCommand function ("case \\"command_name\\": { ... }"). NOTE: this file trips grep's
binary-file heuristic — always pass -a to grep when searching it, e.g.
\`grep -a -n 'case "cmd"' src/devMock/tauriDevMock.ts\`.

Real, dedicated coverage of this mock's OWN logic (validation, rejection strings,
filtering, state mutation) lives in sibling files named
src/devMock/tauriDevMock.<name>.test.ts, which call the seam directly:

  function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }).__TAURI_INTERNALS__;
    return internals.invoke(cmd, args);
  }
  describe(...) {
    beforeEach(() => installTauriDevMock());
    afterEach(() => uninstallTauriDevMock());
    it(...) { const x = await seamInvoke("some_command", {...}); expect(x)...; }
  }

We have already confirmed, by grepping every src/devMock/*.test.ts file for each command's
quoted string, that NONE of your assigned commands below are referenced in any of those
dedicated seam test files. That is a necessary but not sufficient condition for a real gap:
some commands may ALSO be exercised indirectly, through a feature/component test that
renders the real UI without stubbing @tauri-apps/api/core (so the component's own hook
calls invoke(), which reaches the real mock's routeCommand). You must rule that out before
calling something a confirmed gap.

For EACH assigned command, do the following:

1. Locate its case block: \`grep -a -n 'case "COMMAND"' src/devMock/tauriDevMock.ts\`, then
   Read ~30-60 lines around it.
2. Judge hasRealLogic: false if it's a trivial static return with no branching; true if it
   validates input, rejects on some condition, filters/derives from state, or mutates
   in-memory state (MOCK_* maps, arrays, etc). Only trivial pass-throughs get hasRealLogic:false
   — for those, set gapConfirmed:false, evidence:"trivial static return, no branch to miss",
   gapDescription:"", skeleton:"" and move on; do not spend further effort on them.
3. For hasRealLogic commands, find the production caller(s): \`grep -rn '"COMMAND"' src --include="*.ts" --include="*.tsx" | grep -v test | grep -v devMock\`.
   For each caller file, find its own test file(s) (same basename, *.test.ts(x)) AND any
   other test file that imports/renders it. For each such test file, check whether it
   contains \`vi.mock("@tauri-apps/api/core"\` — if it does, that test bypasses the real mock
   entirely for this purpose (it stubs invoke directly), so it does NOT count as coverage of
   tauriDevMock.ts's own branch logic, no matter what it asserts.
4. If you find a test that renders/exercises the caller WITHOUT stubbing "@tauri-apps/api/core",
   read it and confirm whether the interaction that would actually trigger COMMAND's
   interesting branch (the validation/rejection/filter path from step 2, not just any call)
   is exercised. If yes: gapConfirmed:false, evidence: cite that test file + what it does.
   If the mock is used but the SPECIFIC branch isn't hit (e.g. only the happy path is
   exercised, not the rejection path): gapConfirmed:true, and gapDescription must name the
   untested branch specifically (e.g. "rejects a title that already exists in books_list —
   never exercised" not "book_add is untested").
5. If no such test exists at all: gapConfirmed:true.
6. For every gapConfirmed:true finding, write a real, runnable vitest skeleton (not just
   \`it.todo\`) in the seamInvoke pattern shown above, following the naming and style of
   sibling tauriDevMock.*.test.ts files (see src/devMock/tauriDevMock.bookAdd.test.ts or
   tauriDevMock.pieceArchive.test.ts for the header-comment convention: explain WHY this
   command has zero coverage today). Propose it as a new file
   src/devMock/tauriDevMock.<camelCaseCommand>.test.ts (or note it belongs added to an
   existing sibling file if one already covers a closely related command).

Return ONLY commands from your assigned list. Be skeptical of your own gapConfirmed:true
calls — cite concrete file:line evidence, not a hunch.`;

const BUCKETS = [
  {
    key: "brain-settings",
    commands: [
      "api_key_clear",
      "api_key_save",
      "brain_ask",
      "brain_plan_preview",
      "brain_status",
      "brain_test_connection",
      "brain_thread_clear",
      "brain_thread_resume",
    ],
    leads:
      "api_key_clear/api_key_save -> src/features/settings/SettingsPanel.tsx and src/services/command.ts; brain_ask/brain_plan_preview/brain_thread_clear/brain_thread_resume -> src/features/brain/api.ts; brain_status/brain_test_connection -> src/services/command.ts.",
  },
  {
    key: "notebook-marks",
    commands: [
      "assistant_suggest",
      "book_excerpt",
      "score_mark_add",
      "score_mark_undo",
      "score_marks_clear_page",
      "score_marks_page",
    ],
    leads:
      "assistant_suggest -> src/features/notebook/PassageHelper.tsx (PassageHelper.test.tsx exists — check whether IT stubs core or not); book_excerpt -> src/features/reader/ReaderWindow.tsx; score_mark_* -> src/features/score/marks/api.ts.",
  },
  {
    key: "scoreview-pdf",
    commands: [
      "score_page_image",
      "score_page_image_warm",
      "score_pdf_bytes",
      "score_pdf_editions",
      "score_pdf_select",
    ],
    leads:
      'all five -> src/features/score/ScoreView.tsx. ScoreView.test.tsx exists — check whether it stubs "@tauri-apps/api/core".',
  },
  {
    key: "import-pieces",
    commands: [
      "downloads_list",
      "imslp_editions",
      "imslp_open_download",
      "pick_import_file",
      "piece_import_pdf",
      "piece_open_source_url",
      "pieces_scan",
    ],
    leads:
      "downloads_list/imslp_editions/imslp_open_download/pick_import_file/piece_import_pdf/piece_open_source_url -> src/features/pieces/AddScore.tsx (AddScore.test.tsx exists); pieces_scan -> src/features/pieces/PiecesPanel.tsx.",
  },
  {
    key: "rep-session-voice",
    commands: [
      "metro_state",
      "rep_blocks_for_piece",
      "rep_state",
      "session_current",
      "voice_state",
    ],
    leads:
      "metro_state -> src/features/rep/useRep.ts and src/features/metronome/useMetronome.ts; rep_blocks_for_piece -> src/features/composer/useComposerCandidates.ts, src/features/pieces/HistoryPanel.tsx, src/features/pieces/RegionEditor.tsx, src/features/score/ScoreView.tsx; rep_state -> src/features/today/quoteSignals.ts, src/features/rep/useRep.ts; session_current -> src/features/session/useSession.ts; voice_state -> src/features/voice/useVoice.ts.",
  },
  {
    key: "calendar-goals-settings",
    commands: [
      "anomalies_list",
      "daily_work_list",
      "goal_update",
      "progress_summary",
      "recovery_preview",
      "retention_due",
      "settings_snapshot",
      "settings_update",
      "universe_snapshot",
    ],
    leads:
      "anomalies_list -> src/features/ledger/AnomaliesPanel.tsx; daily_work_list -> src/features/calendar/api.ts, src/features/composer/useComposerCandidates.ts, src/features/pieces/GoalsPanel.tsx; goal_update -> src/features/rep/useCrud.ts, src/features/notebook/DaySheet.tsx; progress_summary -> src/features/pieces/HistoryPanel.tsx; recovery_preview -> src/features/calendar/api.ts; retention_due -> src/features/retention/api.ts, src/features/composer/useComposerCandidates.ts; settings_snapshot/settings_update -> src/features/settings/SettingsPanel.tsx, src/state/settings.ts; universe_snapshot -> src/features/universe/api.ts.",
  },
];

phase("Analyze");
const bucketResults = await pipeline(
  BUCKETS,
  (bucket) =>
    agent(
      `${PREAMBLE}\n\nYour assigned commands: ${bucket.commands.join(", ")}.\nKnown production callers (verify, don't just trust): ${bucket.leads}`,
      {
        label: `analyze:${bucket.key}`,
        phase: "Analyze",
        schema: FINDINGS_SCHEMA,
      },
    ),
  (analysis, bucket) => {
    const confirmed = (analysis?.findings ?? []).filter((f) => f.gapConfirmed);
    if (confirmed.length === 0) return { bucket, analysis, verify: null };
    return agent(
      `Adversarially verify these claimed test-coverage gaps in CodaKiller's src/devMock/tauriDevMock.ts. ` +
        `For each, your job is to try to REFUTE gapConfirmed by finding coverage the first pass missed — ` +
        `search src/**/*.test.ts(x) broadly (not just the files it already checked) for any test that ` +
        `renders/exercises the real mock (no "@tauri-apps/api/core" stub) and hits this specific branch. ` +
        `Default to stillConfirmed:true only if you genuinely cannot find such a test after a real search — ` +
        `don't rubber-stamp. Claimed gaps:\n\n${JSON.stringify(
          confirmed.map((f) => ({
            command: f.command,
            gapDescription: f.gapDescription,
            evidence: f.evidence,
          })),
          null,
          2,
        )}`,
      { label: `verify:${bucket.key}`, phase: "Verify", schema: VERIFY_SCHEMA },
    ).then((verify) => ({ bucket, analysis, verify }));
  },
);

const survivors = [];
for (const { bucket, analysis, verify } of bucketResults) {
  if (!analysis) continue;
  const verdictByCmd = new Map(
    (verify?.verdicts ?? []).map((v) => [v.command, v]),
  );
  for (const f of analysis.findings ?? []) {
    if (!f.gapConfirmed) continue;
    const v = verdictByCmd.get(f.command);
    if (v && v.stillConfirmed === false) {
      log(`refuted: ${f.command} (${bucket.key}) — ${v.note}`);
      continue;
    }
    survivors.push({ ...f, bucket: bucket.key, verifyNote: v?.note ?? null });
  }
}

log(`${survivors.length} devMock coverage gaps confirmed after verification`);
return {
  survivors,
  allBuckets: bucketResults.map((r) => ({
    bucket: r.bucket.key,
    findings: r.analysis?.findings ?? [],
  })),
};
