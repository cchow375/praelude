# CodaKiller v3 Frontend Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CodaKiller frontend with a pure black-and-white, de-cluttered UI on the frozen Rust backend, fixing the offline-brain bug, adding a working score-mapping wizard, and turning the Universe into a draggable Obsidian-style force graph.

**Architecture:** The entire `src-tauri/` backend is frozen except one bug fix in `brain/provider.rs`. A fresh React 19 frontend is built workspace-by-workspace against the existing Tauri IPC contract, each phase gated by browser QA (`npm run dev:mock`) and a fresh-context adversarial verifier. Installable/rollback point after every phase.

**Tech Stack:** Tauri v2 (Rust + Vite/React/TS), pdfjs-dist (existing), **+ d3-force** (physics math for the Universe), CSS custom properties (no Tailwind, no component library), vitest (frontend), cargo test (Rust).

## Global Constraints

- **Backend frozen.** No changes to `src-tauri/` except `src-tauri/src/brain/provider.rs` (Phase 1). Consume every IPC command name and payload shape exactly as it exists. Verify with `cargo test` unchanged after Phase 1.
- **User is the sensor; the app is the memory.** Never interpret audio as music. The brain stays out of the hot loop; it never claims to record a verdict or control the app.
- **Deterministic hot loop** (regex intent router) is untouched by this rework.
- **Color discipline:** chrome is pure monochrome (near-black base `#0e0e10`, white→gray ink, 1px hairlines). Hue appears ONLY in: the Universe/planets, score marks, and semantic signals (error red, success green). No terracotta, no brown, no serif fonts anywhere.
- **Type:** `system-ui` (SF Pro) for text; mono (SF Mono/Menlo) ONLY for numerals (tempo, measure ranges, rep counts, streaks). Two weights, three sizes total.
- **No outlined buttons.** Primary = solid white-on-black inversion; secondary = text button. No decorative circles/rings/empty stat frames.
- **De-clutter law:** one primary action per screen; secondary content behind disclosures; element count per screen must not exceed the v2.0.0 equivalent.
- **Motion:** fast micro-responses (press states, 120–180ms eased panel slides, receipts that visibly land) + spring physics in the Universe. No ambient looping animation.
- **Dark-first.** Light mode dropped; do not spend effort on a light theme.
- **Vault UPDATE PROTOCOL after every phase** (binding): `(C) Changelog.md`, `CodaKiller.md` + its `Last updated:`, `(C) Roadmap.md`, `(C) Flaws.md` (move flaws to Resolved only with the fixing commit — never delete), `(C) CodaKiller Command Center.md`, `(C) How To Use.md` + its `Matches: vX.Y.Z` line ONLY when the installed app changes; repo `NOTES.md`; commit (tag only on a version bump). Path: `~/Desktop/christian's universe/Piano Practice/CodaKiller/`.
- **Tree hygiene:** the rogue `@claude-flow` daemon auto-writes `TEST_COVERAGE_ANALYSIS.md` + `*.test.ts` skeletons into the repo. The tree must be clean at every gate; `git status` before every commit.
- **Build/run/test:** `npm install`; `npm run tauri dev`; `npm run tauri build -- --bundles app` (the dmg step deletes the .app — see NOTES.md); `cd src-tauri && cargo test`; `npm test`; `npm run dev:mock` (browser QA harness). Quit + relaunch the installed `.app` to run new code; first launch needs mic + Speech Recognition Allow, Dictation ON.

---

## Phase 0 — Parity inventory (the rewrite's contract)

**Why:** A frontend rewrite silently drops features. This phase produces the checklist Phase 8 audits against, so nothing the user relies on disappears without an explicit decision.

### Task 0.1: Capture the v2.0.0 feature + IPC inventory

**Files:**

- Create: `docs/superpowers/plans/v3-parity-inventory.md`

**Interfaces:**

- Produces: `v3-parity-inventory.md` — the authoritative list every later phase's "reach parity" step checks against.

- [ ] **Step 1: Enumerate every user-facing capability of the current frontend.** Walk `src/features/*` and the current shell. For each workspace record: route/tab name, every user action, every piece of information shown, and any empty/error/loading state. Explicitly list the cross-cutting elements: save receipts, wake-cue confirm cards, the rep HUD, the Session Composer, the anomaly disclosure panel, PDF annotations (box/highlight/text, move/resize/recolor/delete), tutorials/How-To surfaces, the Brain drawer, and every Settings pane.

- [ ] **Step 2: Enumerate the IPC contract.** From `src-tauri/src/main.rs` (or `lib.rs`) `tauri::generate_handler![...]`, list every command name. For each, record the argument names/types and return type from its `#[tauri::command]` fn. This is the API the new frontend must call — no command may be invented.

- [ ] **Step 3: Record the design-token surface to delete.** List every serif font stack, every terracotta/brown hex, and every outlined-button style in `src/design/tokens.css` and component CSS, so the retheme removes all of them (not just the obvious ones).

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/plans/v3-parity-inventory.md
git commit -m "docs(v3): parity inventory of v2.0.0 frontend + IPC contract"
```

**Gate:** Christian (or the orchestrator) skims the inventory; it is the reference for Phase 8. No code yet, so no verifier needed.

---

## Phase 1 — Brain online fix + truthful status (ships independently)

**Why / root cause (diagnosed live against the Gemini API, 2026-07-16):**

1. **Empty Keychain key.** `security find-generic-password -s codakiller -a gemini -w` returns 1 byte (blank); it was overwritten today. `keychain_secret` (provider.rs:250) trims it to empty → `None`, and the `GEMINI_API_KEY` env fallback is unset → no Gemini provider → chain empty → `ProviderUnavailable` → "offline". The real key (length 53, prefix `AQ.A`) still exists in `~/piano-coach/data/secrets.env`.
2. **Invalid default model.** `DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"` (provider.rs:18) is NOT in the account's model list (valid: `gemini-flash-latest`, `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`). The "verified" comment (provider.rs:12–15) was wrong.
3. **Silent failure, no retry.** transport/HTTP/parse errors only `eprintln!` and `continue` (provider.rs:162–191). A transient `503` (hit live during diagnosis) permanently drops to offline with no reason shown and no retry.

This phase is backend-only (`provider.rs`) + a tiny status contract, and can be built/installed before the frontend rewrite lands.

**NOTE — handling the real key:** re-storing Christian's key is an environment action, not code. It is Step 7 below, done once, interactively; never hard-code or commit a key.

### Task 1.1: Correct the default Gemini model to a listed, stable id

**Files:**

- Modify: `src-tauri/src/brain/provider.rs:17-18` (and the stale comment at 12–15)
- Test: `src-tauri/src/brain/provider.rs` (tests module)

**Interfaces:**

- Consumes: existing `valid_model_env`, `DEFAULT_GEMINI_MODEL`.
- Produces: `DEFAULT_GEMINI_MODEL == "gemini-flash-latest"`.

- [ ] **Step 1: Write the failing test.** In the `tests` module:

```rust
#[test]
fn default_gemini_model_is_a_listed_stable_id() {
    // gemini-3.5-flash was never a listed model for this account; the default
    // must be an id the API's ListModels returns. gemini-flash-latest always
    // resolves to the current stable flash model.
    assert_eq!(DEFAULT_GEMINI_MODEL, "gemini-flash-latest");
}
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd src-tauri && cargo test --lib brain::provider::tests::default_gemini_model_is_a_listed_stable_id`
Expected: FAIL (left `"gemini-3.5-flash"`, right `"gemini-flash-latest"`).

- [ ] **Step 3: Implement.** Change line 18 to `const DEFAULT_GEMINI_MODEL: &str = "gemini-flash-latest";` and replace the false "Verified…gemini-3.5" comment (12–15) with: `// gemini-flash-latest resolves to the current stable flash model; verified present in v1beta ListModels for this account 2026-07-16.`

- [ ] **Step 4: Run it, verify it passes.**

Run: `cd src-tauri && cargo test --lib brain::provider`
Expected: PASS (all provider tests).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/brain/provider.rs
git commit -m "fix(brain): default Gemini model to listed gemini-flash-latest (gemini-3.5-flash was unlisted)"
```

### Task 1.2: Retry once on transient 5xx / transport error before falling through

**Files:**

- Modify: `src-tauri/src/brain/provider.rs` (the `ask` loop, ~156–194)
- Test: `src-tauri/src/brain/provider.rs` (tests module)

**Interfaces:**

- Consumes: `Transport`, `FakeTransport::responses`, `HttpResponse`.
- Produces: `ask` retries the SAME provider once when `transport.send` errors or returns a 5xx, before moving to the next config.

- [ ] **Step 1: Write the failing test.**

```rust
#[test]
fn transient_503_retries_same_provider_before_falling_through() {
    let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
        ProviderPreference::Gemini, "gemini-secret", "gemini-test",
    )]);
    let transport = FakeTransport::responses(vec![
        HttpResponse { status: 503, body: b"high demand".to_vec() },
        HttpResponse::ok(json!({
            "candidates": [{"content": {"parts": [{
                "text": "{\"answer\":\"Slow to half tempo.\",\"citation_ids\":[]}"
            }]}}]
        })),
    ]);
    let context = GroundedContext { json: "{}".into() };
    let answer = chain.ask("how?", QuestionSource::Typed, &context, &transport).unwrap();
    assert_eq!(answer.provider, ProviderName::Gemini);
    assert_eq!(transport.requests().len(), 2); // retried the same provider
}
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd src-tauri && cargo test --lib brain::provider::tests::transient_503_retries_same_provider_before_falling_through`
Expected: FAIL (only 1 request sent; returns `ProviderUnavailable`).

- [ ] **Step 3: Implement.** In the `ask` loop, wrap the send+status handling so a `send` `Err` OR a `500..=599` status retries the same `config` once (a simple inner `for attempt in 0..2` that breaks to the next config only after the second failure). Keep the existing 2xx/parse handling. Do not retry on 4xx (client errors won't fix themselves). Preserve the existing `eprintln!` lines for now (Task 1.3 replaces them with a structured reason).

- [ ] **Step 4: Run it, verify it passes + nothing regressed.**

Run: `cd src-tauri && cargo test --lib brain::provider`
Expected: PASS including `failed_claude_request_falls_through_to_gemini` (503 there still falls through after its retry, because that chain's Gemini succeeds).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/brain/provider.rs
git commit -m "fix(brain): retry once on transient 5xx/transport error before provider fallthrough"
```

### Task 1.3: Surface a truthful offline reason instead of swallowing it

**Files:**

- Modify: `src-tauri/src/brain/provider.rs` (return a reason), and its caller/`BrainError` in `src-tauri/src/brain/mod.rs`
- Test: `src-tauri/src/brain/provider.rs` (tests module)

**Interfaces:**

- Consumes: `BrainError`, `ProviderChain::ask`, `ProviderChain::is_empty`.
- Produces: a `BrainStatus` the IPC layer can return — `{ online: bool, provider: Option<"gemini"|"claude">, reason: Option<String> }`. `reason` is one of: `"no key configured"`, `"key present but network unreachable"`, `"provider error: HTTP <status>"`, `"provider returned an unusable response"`, `"disabled in settings"`.

- [ ] **Step 1: Write the failing test.**

```rust
#[test]
fn empty_chain_reports_no_key_reason() {
    let chain = ProviderChain::default();
    assert!(chain.is_empty());
    assert_eq!(chain.offline_reason(), "no key configured");
}

#[test]
fn exhausted_chain_reports_last_transport_reason() {
    let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
        ProviderPreference::Gemini, "k", "m",
    )]);
    let transport = FakeTransport::responses(vec![
        HttpResponse { status: 503, body: b"x".to_vec() },
        HttpResponse { status: 503, body: b"x".to_vec() },
    ]);
    let context = GroundedContext { json: "{}".into() };
    let err = chain.ask("q", QuestionSource::Typed, &context, &transport).unwrap_err();
    assert_eq!(err.reason(), "provider error: HTTP 503");
}
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd src-tauri && cargo test --lib brain::provider::tests::empty_chain_reports`
Expected: FAIL (`offline_reason`/`reason` not defined).

- [ ] **Step 3: Implement.** Add `ProviderChain::offline_reason(&self) -> &'static str` (returns `"no key configured"` when empty). Thread the last failure cause through `ask` so `BrainError` carries a `reason()` (`ProviderUnavailable` → the last HTTP/transport/parse cause). Replace the `eprintln!`s with setting this reason (keep a `log`/`eprintln` for dev, but the reason is now returned, not swallowed).

- [ ] **Step 4: Run it, verify it passes.**

Run: `cd src-tauri && cargo test --lib brain`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/brain/
git commit -m "feat(brain): return truthful offline reason instead of swallowing provider errors"
```

### Task 1.4: `brain_status` + `brain_test_connection` IPC commands

**Files:**

- Modify: `src-tauri/src/brain/mod.rs` (or wherever brain commands live), `src-tauri/src/main.rs` (register in `generate_handler!`)
- Test: `src-tauri/src/brain/mod.rs` (tests module)

**Interfaces:**

- Produces two Tauri commands the frontend calls:
  - `brain_status() -> BrainStatus` — `{ online, provider, reason }`, computed without a network call (key presence + settings only; `online` here means "a provider is configured", `reason` set when not).
  - `brain_test_connection() -> BrainTestResult` — `{ ok: bool, provider: Option<String>, model: Option<String>, latency_ms: Option<u64>, error: Option<String> }` — a real round-trip using the existing transport + a minimal prompt.

- [ ] **Step 1: Write the failing test** for the pure mapping from a `ProviderChain` + a fake transport to `BrainTestResult` (ok path sets `provider`+`model`+`latency_ms`, error path sets `error` to the reason string). (Follow the existing brain command test style found in Task 0.1's inventory.)

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd src-tauri && cargo test --lib brain::`
Expected: FAIL (commands/types not defined).

- [ ] **Step 3: Implement** both commands and register them in `generate_handler!`. `brain_test_connection` reuses `NativeTransport`; on the 503-retry path it reports `ok:false, error:"provider error: HTTP 503"` truthfully.

- [ ] **Step 4: Run it, verify it passes + full suite green.**

Run: `cd src-tauri && cargo test`
Expected: PASS (whole Rust suite — proves the backend-freeze contract held).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/
git commit -m "feat(brain): brain_status + brain_test_connection IPC for truthful online/offline UI"
```

### Task 1.5: Restore the real Gemini key + prove online end-to-end (packaged app)

**Files:** none (environment + manual verification).

- [ ] **Step 1: Re-store the real key in the Keychain** (interactive; the value is read from the existing secrets file, never printed or committed):

```bash
KEY=$(python3 -c "import re;[print(l.split('=',1)[1].strip().strip('\"')) for l in open('/Users/c3/piano-coach/data/secrets.env') if l.startswith('GEMINI_API_KEY=')]")
security add-generic-password -U -s codakiller -a gemini -w "$KEY"
security find-generic-password -s codakiller -a gemini -w | wc -c   # expect ~54, not 1
```

- [ ] **Step 2: Build the app-only bundle.**

Run: `npm run tauri build -- --bundles app`
Expected: `.app` built (see NOTES.md dmg caveat).

- [ ] **Step 3: Verify online in the packaged app.** Launch the built `.app`, open the Brain, run Test connection. Expected: `ok: true`, provider `gemini`, a model id, a latency. Ask one typed question; expect a real one-glance answer, not an offline/library fallback.

- [ ] **Step 4: Verify the truthful-offline path.** Temporarily set the model to a bogus id via `CODAKILLER_GEMINI_MODEL=nope` (env, dev run) → Test connection shows `ok:false` with the HTTP error reason. Unset it.

- [ ] **Step 5: Adversarial verifier gate.** Dispatch a fresh-context verifier: claim = "Brain connects online via Gemini in the packaged app and every offline state shows a truthful reason." It must exercise Test connection, a real question, the no-key path (temporarily rename the keychain item), and confirm no `unwrap`/panic and no silent swallow remains in `ask`.

- [ ] **Step 6: Vault UPDATE PROTOCOL** (Changelog, CodaKiller.md, Flaws → move the brain-offline flaw to Resolved with these commits, Command Center status, NOTES.md brain-diagnosis facts). Commit.

**Gate:** packaged-app online answer proven + verifier CONFIRMED.

> **Correction from inventory:** the frontend already has typed IPC commands `api_key_save(provider, key) -> ApiKeyStatus` and `api_key_clear(provider) -> ApiKeyStatus`, and `SettingsPanel` shows API-key presence. The empty Keychain key most likely came from a blank save / clear through this path. Task 1.5 Step 1 SHOULD prefer routing the key through `api_key_save` (via a tiny dev harness or the Settings UI once Phase 2 lands) so it uses the same code path the user does; the raw `security add-generic-password` form above is the fallback if a UI path isn't available yet. Also add a guard in `api_key_save` (backend) rejecting an empty/whitespace key so a blank can never be stored again — fold this into Task 1.3 as an extra test + guard.

---

## Phase 2 — Shell + design system + Settings (the monochrome foundation)

**Why:** Every workspace inherits these tokens and the component kit. Getting the black-and-white system, the font rules, and the no-outline/no-decorative-box law right ONCE here is what makes complaints #3 and #4 stay fixed everywhere. Settings ships here because it hosts the Brain status/test-connection UI from Phase 1 and is the smallest real workspace to prove the kit.

### Task 2.1: Replace design tokens with the pure-monochrome dark system

**Files:**

- Rewrite: `src/design/tokens.css`
- Modify: `src/design/theme.ts` (dark-only; drop the light branch or make it a no-op that always resolves dark)
- Test: `src/design/tokens.test.ts` (create)

**Interfaces:**

- Produces: the CSS custom properties every component consumes — `--bg`, `--bg-raised`, `--ink`, `--ink-dim`, `--ink-faint`, `--hairline`, `--accent-invert-bg`, `--accent-invert-ink` (button inversion), `--signal-error`, `--signal-success`, `--font-sans`, `--font-mono`, radius/space scale. **No hue token in the chrome set.**

- [ ] **Step 1: Write the failing test.** Assert the token file contains no forbidden values:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
describe("monochrome token discipline", () => {
  it("has no serif font stacks", () => {
    expect(css).not.toMatch(
      /New York|Iowan|Palatino|Baskerville|Georgia|serif/i,
    );
  });
  it("has no terracotta/brown accent hexes", () => {
    expect(css).not.toMatch(/#9f4937|#cf7862|#ead8d0|#fbf8f2|#2e2924|#4c2d25/i);
  });
  it("defines the required monochrome tokens", () => {
    for (const t of [
      "--bg",
      "--ink",
      "--ink-dim",
      "--hairline",
      "--accent-invert-bg",
      "--font-sans",
      "--font-mono",
    ]) {
      expect(css).toContain(t);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npm test -- tokens.test.ts` → FAIL (serif stacks + terracotta present).

- [ ] **Step 3: Implement `tokens.css`.** Exact base set (dark-only):

```css
:root,
:root[data-theme="dark"] {
  --bg: #0e0e10;
  --bg-raised: #161619;
  --bg-sunken: #0a0a0b;
  --ink: #f4f4f5;
  --ink-dim: #a1a1aa;
  --ink-faint: #6b6b73;
  --hairline: rgba(255, 255, 255, 0.1);
  --hairline-strong: rgba(255, 255, 255, 0.18);
  --accent-invert-bg: #f4f4f5; /* primary button: white fill */
  --accent-invert-ink: #0e0e10; /* primary button: black text */
  --signal-error: #ff5c5c;
  --signal-success: #4ade80;
  --font-sans:
    system-ui, -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-mono: "SF Mono", ui-monospace, Menlo, monospace;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 40px;
}
body {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
}
```

Set `theme.ts` to always write `data-theme="dark"`.

- [ ] **Step 4: Run it, verify it passes.** Run: `npm test -- tokens.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/design/tokens.css src/design/theme.ts src/design/tokens.test.ts
git commit -m "feat(design): pure-monochrome dark token system; delete serif + terracotta"
```

### Task 2.2: Minimal component kit — Button, Panel, Disclosure, Dialog, Receipt

**Files:**

- Create: `src/ui/Button.tsx`, `src/ui/Panel.tsx`, `src/ui/Disclosure.tsx`, `src/ui/Dialog.tsx`, `src/ui/Receipt.tsx`, `src/ui/ui.css`, `src/ui/index.ts`
- Test: `src/ui/Button.test.tsx`, `src/ui/Disclosure.test.tsx`

**Interfaces:**

- Produces:
  - `Button({ variant?: "primary" | "text", ...HTMLButtonProps })` — only these two variants; **no outlined/bordered variant exists** (enforced by test). Primary = inverted fill; text = no border, hover = subtle ink shift.
  - `Panel({ title?, actions?, children })` — flat surface `--bg-raised`, 1px `--hairline`, no glow/shadow beyond a 1px hairline.
  - `Disclosure({ summary, children, defaultOpen? })` — the density primitive; secondary content hides here.
  - `Dialog({ open, onClose, children })` — modal for confirm cards.
  - `Receipt({ status: "success" | "error", message })` — the save-receipt element (green/red signal only).

- [ ] **Step 1: Write the failing tests.**

```tsx
import { render } from "@testing-library/react";
import { Button } from "./Button";
it("has no outlined variant and never renders a border style", () => {
  // @ts-expect-error outlined is intentionally not a valid variant
  const bad = <Button variant="outlined" />;
  expect(bad).toBeDefined(); // compile-time guard is the real assertion
  const { getByRole } = render(<Button variant="primary">Go</Button>);
  const cs = getComputedStyle(getByRole("button"));
  expect(cs.borderStyle === "none" || cs.borderWidth === "0px").toBe(true);
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npm test -- src/ui` → FAIL (files don't exist).

- [ ] **Step 3: Implement** the five components + `ui.css` using only tokens from Task 2.1. Primary button: `background: var(--accent-invert-bg); color: var(--accent-invert-ink); border: none`. Text button: `background: transparent; border: none; color: var(--ink-dim)`, hover `color: var(--ink)`. Press state: `transform: translateY(1px)` on `:active`. Panel/Dialog/Receipt: hairline borders only, 120–180ms eased transitions.

- [ ] **Step 4: Run it, verify it passes.** Run: `npm test -- src/ui` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/ui/
git commit -m "feat(ui): monochrome component kit (Button/Panel/Disclosure/Dialog/Receipt), no outlined variant"
```

### Task 2.3: App shell with the five-workspace switcher

**Files:**

- Rewrite: `src/App.tsx` (or the current shell entry), `src/shell/Shell.tsx` (create), `src/shell/shell.css`
- Test: `src/shell/Shell.test.tsx`

**Interfaces:**

- Consumes: the component kit; `layout_get`/`layout_set` IPC for persisted shell prefs (optional).
- Produces: a shell rendering exactly five workspace slots — Today, Score, Brain, Ledger/Calendar, Universe — with a single, quiet nav (text buttons, active state = ink, not a filled pill). One staggered entrance on load; no ambient motion.

- [ ] **Step 1: Write the failing test.** Assert the shell renders five nav targets and mounts the Today workspace by default (use a stub for each workspace).

- [ ] **Step 2: Run it, verify it fails.** Run: `npm test -- Shell.test.tsx` → FAIL.

- [ ] **Step 3: Implement** the shell + nav. Workspaces lazy-loaded; each phase below fills one in. Keep a `WorkspaceStub` placeholder for not-yet-built ones so the app always runs.

- [ ] **Step 4: Run it, verify it passes + dev:mock renders.** Run: `npm test -- Shell.test.tsx` → PASS; then `npm run dev:mock` and confirm the shell renders with five tabs, pure black-and-white, no serif, no outlined buttons.

- [ ] **Step 5: Commit.**

```bash
git add src/App.tsx src/shell/
git commit -m "feat(shell): five-workspace monochrome app shell with staggered entrance"
```

### Task 2.4: Settings workspace + Brain connection UI

**Files:**

- Rewrite: `src/features/settings/SettingsPanel.tsx`, `src/features/settings/settings.css`
- Create: `src/features/settings/BrainConnection.tsx`
- Modify: `src/services/command.ts` (add `brainStatus`, `brainTestConnection`, ensure `apiKeySave`/`apiKeyClear` defs)
- Test: `src/features/settings/SettingsPanel.test.tsx`, `src/features/settings/BrainConnection.test.tsx`

**Interfaces:**

- Consumes IPC: `settings_snapshot`, `settings_update`, `api_key_save`, `api_key_clear`, `brain_status`, `brain_test_connection` (the last two from Phase 1).
- Produces: a Settings workspace where every control is disclosure-organized (no wall of toggles), and a `BrainConnection` block showing `● online — gemini` / `○ offline — <reason>` from `brain_status`, a **Test connection** button calling `brain_test_connection` (shows model + latency on success, exact error on failure), and a key field routing through `api_key_save`/`api_key_clear`.

- [ ] **Step 1: Write the failing test.** `BrainConnection` renders the offline reason from a mocked `brain_status`, and on Test-connection click renders the model+latency from a mocked `brain_test_connection`. (Mock via the `command.ts` invoker seam.)

- [ ] **Step 2: Run it, verify it fails.** Run: `npm test -- BrainConnection.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** Rebuild SettingsPanel with disclosures grouping: Brain (connection + provider), Voice/Wake-word, Metronome, Ladder defaults, Calendar capacity, Vault dir, Verdict aliases. Delete any decorative framing; values are plain rows.

- [ ] **Step 4: Run it, verify it passes + reach parity.** Run: `npm test -- settings` → PASS. Cross-check against `v3-parity-inventory.md` Settings pane list — every prior setting still reachable.

- [ ] **Step 5: Adversarial verifier gate** (claim: "Settings reaches parity with v2.0.0's settings and the Brain connection UI truthfully reflects `brain_status`/`brain_test_connection`"), then **Step 6: Vault UPDATE PROTOCOL** + commit.

```bash
git add src/features/settings/ src/services/command.ts
git commit -m "feat(settings): monochrome disclosure-organized settings + truthful Brain connection UI"
```

**Gate:** dev:mock shows the shell + Settings in pure monochrome; Brain connection UI proven against mocked status; verifier CONFIRMED.

---

## Phase 3 — Brain workspace

**Why:** The Brain is the feature Christian most wants to actually work. With Phase 1 online + Phase 2 status UI, this rebuilds the chat surface concise and clean.

### Task 3.1: Brain chat surface (rewrite)

**Files:**

- Rewrite: `src/features/brain/BrainWorkspace.tsx`, `src/features/brain/brain.css`
- Keep/adapt: `src/features/brain/api.ts`
- Test: `src/features/brain/BrainWorkspace.test.tsx`, `src/features/brain/BrainNavigation.test.tsx`

**Interfaces:**

- Consumes IPC: `brain_ask(BrainAskRequest) -> BrainAnswer`, `brain_thread_resume(piece_id) -> BrainThreadResume`, `brain_thread_clear(piece_id)`, `brain_intake_apply`, `brain_plan_preview`, plus `brain_status` for the persistent status line.
- Produces: a single-column transcript (typed Q&A, per-piece memory via thread_resume), a persistent status line at top, one-glance answers rendered plainly with citation chips, and the intake-review/work-suggestion surfaces from the inventory. No decorative panels.

- [ ] **Step 1: Write the failing test** — asks a question through a mocked `brain_ask`, renders the one-glance answer + citation chips; resuming a piece renders prior turns from a mocked `brain_thread_resume`.
- [ ] **Step 2: Run it, verify it fails.** Run: `npm test -- brain` → FAIL.
- [ ] **Step 3: Implement** the transcript, status line (from `brain_status`), input, citation chips, thread resume/clear, and the intake/plan-preview surfaces. Reuse the exact `BrainAskRequest`/`BrainAnswer` shapes from `api.ts` (read them first — do not invent fields).
- [ ] **Step 4: Run it, verify it passes + parity.** Run: `npm test -- brain` → PASS; cross-check Brain items in `v3-parity-inventory.md`.
- [ ] **Step 5: dev:mock QA** (status line visible, answer renders, monochrome) → **Step 6: adversarial verifier** → **Step 7: Vault UPDATE PROTOCOL + commit.**

```bash
git add src/features/brain/
git commit -m "feat(brain): rebuilt monochrome Brain workspace with persistent status + one-glance transcript"
```

**Gate:** typed question returns a real online answer in dev + parity confirmed + verifier CONFIRMED.

---

## Phase 4 — Score + Atlas mapping wizard (complaint #1)

**Why:** This is the headline fix — "Mapping required" with no way to map. The calibration backend (`score_atlas_target_save`, `anchors.ts`, `atlas/`) exists; this phase builds the wizard UI that creates calibration anchors, makes drawn boxes resolve to measures instantly, and pre-maps his current pieces.

**Read-first (no invented types):** before coding, read `src/features/score/atlas/**` (payload/selection/fingerprinting), `src/features/score/anchors.ts`, `src/features/score/geometry.ts`, and the Rust `AtomicTargetSavePayload` + `score/mod.rs`/`store/score_atlas.rs` calibration model. The wizard must produce whatever anchor/evidence shape those already accept — it adds UI, not a new backend contract.

### Task 4.1: Anchor model + interpolation (pure logic, TDD)

**Files:**

- Create: `src/features/score/atlas/mapping/anchors.ts`, `src/features/score/atlas/mapping/anchors.test.ts`

**Interfaces:**

- Produces:
  - `type LineAnchor = { page: number; yPct: number; measure: number }`
  - `resolveMeasureRange(box: { page: number; xPct: number; yPct: number; wPct: number; hPct: number }, anchors: LineAnchor[]): { mStart: number; mEnd: number; confidence: number }` — finds the anchor line(s) the box overlaps by `yPct`, interpolates measures across the line by `xPct`; confidence from anchor density/proximity.
  - `validateAgainstXml(range: { mStart: number; mEnd: number }, xmlMaxMeasure: number, hasPickup: boolean): { ok: boolean; warning?: string }` — flags measures beyond the score and pickup ±1 ambiguity. XML is optional.

- [ ] **Step 1: Write failing tests** — a box on a line with anchors m.45 (y=0.20) and m.52 (y=0.34) resolves to a range within [45,52]; a box beyond `xmlMaxMeasure` warns; no anchors → confidence 0.
- [ ] **Step 2: Run, verify fail.** Run: `npm test -- atlas/mapping/anchors` → FAIL.
- [ ] **Step 3: Implement** the interpolation + validation.
- [ ] **Step 4: Run, verify pass.** Run: `npm test -- atlas/mapping/anchors` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/features/score/atlas/mapping/
git commit -m "feat(atlas): measure-range interpolation from line anchors + optional XML validation"
```

### Task 4.2: "Map this score" wizard UI

**Files:**

- Create: `src/features/score/atlas/mapping/MapScoreWizard.tsx`, `mapping.css`
- Modify: `src/features/score/ScoreView.tsx` (add the "Map this score" entry point + auto-offer on an unmapped page), `src/features/score/atlas/ui/TargetDraftEditor.tsx` (replace the dead-end "Mapping required" state with a link into the wizard + live resolved range)
- Test: `MapScoreWizard.test.tsx`

**Interfaces:**

- Consumes: `score_pdf_editions`, `score_pdf_select`, `score_pdf_bytes` (render pages via existing `PdfPage.tsx`), `resolveMeasureRange`, and the existing `score_atlas_target_save` for persisting the anchors/target.
- Produces: a stepper — render page → user clicks each system's start → types its measure number → next/skip page → save anchors. Partial maps allowed. After saving, `TargetDraftEditor` shows a live `m.X–Y` for any drawn box (no "Mapping required" dead end).

- [ ] **Step 1: Write the failing test** — wizard collects two anchors on a page and calls the save path with them; `TargetDraftEditor`, given anchors, renders a resolved range for a drawn box instead of "Mapping required".
- [ ] **Step 2: Run, verify fail.** Run: `npm test -- MapScoreWizard` → FAIL.
- [ ] **Step 3: Implement** the wizard + wire the entry points. Use the existing PDF render + selection geometry; do not rebuild the PDF viewer.
- [ ] **Step 4: Run, verify pass + parity.** Run: `npm test -- score` → PASS; the "Mapping required" dead-end string is gone (grep to confirm).
- [ ] **Step 5: dev:mock QA** (draw a box → range appears) → **Step 6: adversarial verifier** (claim: "a fresh PDF can be mapped end-to-end and boxes then resolve to measures; no dead-end remains") → **Step 7: Vault UPDATE PROTOCOL** — move flaw B10 toward Resolved (geometry→measures now user-resolvable), note S2 status honestly (auto-OMR still not done). Commit.

```bash
git add src/features/score/
git commit -m "feat(atlas): Map-this-score wizard; boxes resolve to measures; kill the Mapping-required dead end"
```

### Task 4.3: Pre-map Christian's current pieces (data, verified)

**Files:**

- Create: `docs/qa/(C) v3-premap-log.md` (what was mapped, anchors per piece, XML landmarks checked)

**Interfaces:**

- Consumes: the wizard's save path / `score_atlas_target_save`; the pieces already in his DB (Scherzo Op.31/Ekier, Étude Op.10 No.4, Beethoven Op.90, and any with a PDF).

- [ ] **Step 1:** For each piece with a PDF, render pages and read the printed measure numbers at each system start (use the Piano Practice `read_score.py` + `pdftoppm` workflow from the vault CLAUDE.md).
- [ ] **Step 2:** Enter anchors via the wizard's data path (against a DISPOSABLE DB copy first, never the live DB — follow the migration-rehearsal rule in NOTES.md).
- [ ] **Step 3:** Verify anchors against MusicXML landmarks where a `.musicxml` exists (e.g. Scherzo m.67 LH C♭, m.95 LH F♮). Log mismatches.
- [ ] **Step 4:** Prove a drawn box on each mapped piece resolves to the correct measures.
- [ ] **Step 5:** Commit the log (not the DB).

```bash
git add "docs/qa/(C) v3-premap-log.md"
git commit -m "docs(atlas): pre-map log for current pieces, anchors verified vs MusicXML landmarks"
```

**Gate:** wizard works on a fresh PDF; his pieces resolve boxes on day one; verifier CONFIRMED.

---

## Phase 5 — Today workspace (HUD, Composer, Receipts, Retention)

**Why:** The daily driver — the "did it actually save?" clarity (Receipts) and the 20-minute routine (Composer) live here. Rebuild clean; the backend receipting is already proven.

**Read-first:** `src/features/rep/useRep.ts`, `src/features/composer/index.ts`, `src/features/receipts/ReceiptCenter.tsx`, `src/features/retention/index.ts` for exact hook/prop shapes.

### Task 5.1: Rep HUD (rewrite)

**Files:** Rewrite `src/features/rep/RepHud.tsx` + `rep.css`; keep `useRep.ts`. Test `RepHud.test.tsx`.

**Interfaces:**

- Consumes IPC via `useRep`: `rep_open`, `rep_check`, `rep_undo`, `rep_correct`, `rep_restart`, `rep_close`, `rep_state`, `rep_pause`, `rep_resume`, `rep_checkpoint`, `rep_reflect`, `rep_safety_stop`, `rep_recovery` (all as they exist).
- Produces: a live block HUD — current measures (mono), N-of-M + clean streak (mono), verdict/tempo/undo/restart controls as primary/text buttons (no outlined), pause-aware focus time. Numbers ARE the interface; no decorative rings.

- [ ] Step 1: failing test (renders snapshot from a mocked `rep_state`; a clean verdict calls `rep_check("clean", ...)` and shows the updated streak). Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS. Step 5: commit `feat(rep): monochrome Rep HUD, mono numerals, no decorative rings`.

### Task 5.2: Receipt Center (rewrite)

**Files:** Rewrite `src/features/receipts/ReceiptCenter.tsx`. Test `ReceiptCenter.test.tsx`.

**Interfaces:**

- Consumes: `MutationReceipt<T>` results from every receipted command; produces a visible, impossible-to-miss success/error receipt using `Receipt` from the kit (green/red signal only), landing with a fast micro-motion.

- [ ] Step 1: failing test (a success receipt renders green with its message; an error renders red). Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat(receipts): unmissable monochrome save receipts with signal-only color`.

### Task 5.3: Session Composer + Retention Queue (rewrite) + Today assembly

**Files:** Rewrite `src/features/composer/SessionComposer.tsx`, `src/features/retention/RetentionQueue.tsx`, `src/features/today/TodayWorkspace.tsx`. Tests alongside.

**Interfaces:**

- Consumes IPC: `session_plan_start(SessionPlanStartPayload) -> MutationReceipt<SessionPlanStartOutcome>`, composer candidate hooks (`useComposerCandidates`, `useSessionPlan`), `retention_due`, `retention_snooze/confirm/lower/reopen`.
- Produces: Today = editable proposed routine (Composer), Start as the only write (receipted), the retention queue (due today), and the active-block HUD — organized with disclosures so it doesn't wall-of-text.

- [ ] Step 1: failing tests (Composer renders candidates from a mock and Start calls `session_plan_start`; RetentionQueue confirm calls `retention_confirm`). Step 2: FAIL. Step 3: implement all three + assemble Today. Step 4: run `npm test -- today composer retention receipts rep` → PASS; parity cross-check. Step 5: **adversarial verifier** + **Vault UPDATE PROTOCOL** + commit `feat(today): rebuilt Today (HUD/Composer/Receipts/Retention), disclosure-organized`.

**Gate:** a full open→check→receipt→close loop works in dev:mock; Start writes once; parity confirmed; verifier CONFIRMED.

---

## Phase 6 — Ledger + Calendar workspaces

**Why:** "See exactly what I did, without endless scrolling." Rebuild the history/anomaly and schedule/recovery surfaces disclosure-first.

**Read-first:** `src/features/ledger/LedgerWorkspace.tsx`, `src/features/pieces/HistoryPanel.tsx`, `AnomaliesPanel.tsx`, `src/features/calendar/api.ts`.

### Task 6.1: Ledger workspace (rewrite, disclosure-first)

**Files:** Rewrite `src/features/ledger/LedgerWorkspace.tsx`, adapt `HistoryPanel.tsx`, `AnomaliesPanel.tsx`. Tests alongside.

**Interfaces:**

- Consumes IPC: `pieces_list`, `rep_blocks_for_piece`, `reps_for_block`, `progress_summary`, `anomalies_list`, and the block/rep edit commands (`block_update`, `block_delete`, `rep_update`, `rep_delete`).
- Produces: summary rows (piece → block → rep) where detail is behind `Disclosure` (no everything-on-one-screen), the read-only anomaly panel, and inline title/field editing (`block_update`, `rep_update`) — addressing "edit titles of everything".

- [ ] Step 1: failing test (renders block summary rows from a mock; expanding one loads reps via `reps_for_block`). Step 2: FAIL. Step 3: implement. Step 4: `npm test -- ledger` → PASS + parity. Step 5: commit `feat(ledger): disclosure-first ledger with inline edit + anomaly panel`.

### Task 6.2: Calendar workspace (rewrite)

**Files:** Rewrite `src/features/calendar/CalendarWorkspace.tsx`, `RecoveryReview.tsx`. Tests alongside.

**Interfaces:**

- Consumes IPC: `daily_work_list/create/update/delete`, `recovery_preview`, `recovery_apply`, `calendar_capacity_set`.
- Produces: a week view of daily work, the recovery review, capacity control — monochrome, disclosure-organized. (B25 7-day-overflow reflow is noted for later; this phase does NOT need to solve history-at-scale.)

- [ ] Step 1: failing test (renders a week from a mocked `daily_work_list`; capacity change calls `calendar_capacity_set`). Step 2: FAIL. Step 3: implement. Step 4: `npm test -- calendar` → PASS + parity. Step 5: **adversarial verifier** + **Vault UPDATE PROTOCOL** + commit `feat(calendar): monochrome week view + recovery review`.

**Gate:** history drill-in without scroll-walls; both workspaces parity-checked; verifier CONFIRMED.

---

## Phase 7 — Universe force graph (complaint #5)

**Why:** The dopamine payoff and the "movable like Obsidian graphs" ask. Turn the static SVG into a d3-force graph of real earned data, draggable/zoomable, click → detail.

### Task 7.1: Add d3-force + build the simulation model (pure logic, TDD)

**Files:**

- Modify: `package.json` (add `d3-force`), `package-lock.json`
- Create: `src/features/universe/graph/simulation.ts`, `simulation.test.ts`
- Adapt: `src/features/universe/graphLayout.ts` (feed node sizing), `src/features/universe/api.ts` (existing `universe_snapshot`)

**Interfaces:**

- Consumes: `universe_snapshot() -> UniverseSnapshot` (read its exact shape from `api.ts` — pieces, regions/targets, sessions, earned signals).
- Produces:
  - `type GraphNode = { id: string; kind: "sun" | "planet" | "satellite" | "cluster"; parentId?: string; radius: number; label: string; refId?: number }`
  - `type GraphLink = { source: string; target: string }`
  - `buildGraph(snapshot: UniverseSnapshot): { nodes: GraphNode[]; links: GraphLink[] }` — pieces→suns (radius = focused time), regions→planets (radius/brightness = mastery), sessions→satellites, old sessions aggregated into `cluster` nodes past a threshold.
  - `createSimulation(nodes, links)` — a d3-force sim (charge + link + collide + radial-by-parent), sleeps (`alphaTarget(0)`) when settled.

- [ ] Step 1: failing tests — `buildGraph` maps a 2-piece snapshot to 2 suns + child planets + satellites; sessions beyond the cluster threshold collapse into `cluster` nodes; sun radius grows with focused time. Step 2: `npm test -- universe/graph/simulation` → FAIL. Step 3: implement (import from `d3-force`). Step 4: run → PASS. Step 5: commit `feat(universe): d3-force graph model from earned snapshot with session clustering`.

### Task 7.2: Interactive graph rendering (drag / pan / zoom / hover / click)

**Files:** Rewrite `src/features/universe/UniverseWorkspace.tsx` + `universe.css`. Create `src/features/universe/graph/DetailPanel.tsx`. Test `UniverseWorkspace.test.tsx`.

**Interfaces:**

- Consumes: `buildGraph`/`createSimulation`; per-piece palettes (the ONLY color in the app); `universe_snapshot`; jump targets into Ledger/Score.
- Produces: SVG nodes positioned by the live sim; **node drag** (pointer → fix node → sim reacts → release), **pan** (existing), **wheel/pinch zoom** (existing 0.08–2.6), **hover** highlights a node's neighborhood + dims the rest, **click** opens `DetailPanel` (region: reps/cleans/best streak/tempo path/last practiced + "Open in Ledger"/"Open on score"; session: that day; piece: the arc). Dragged positions persist (via `layout_set` or a universe-positions setting). Sim sleeps when settled (no idle CPU).

- [ ] Step 1: failing tests — dragging a node updates its position and does not throw; clicking a planet opens the DetailPanel with that region's data; hover sets the highlight class. Step 2: `npm test -- UniverseWorkspace` → FAIL. Step 3: implement. Step 4: run → PASS; `npm run dev:mock` — drag/zoom/hover/click all work, color only here. Step 5: **adversarial verifier** (claim: "nodes drag with physics, click opens correct detail, positions persist, sim idles at rest, no CPU burn") + **Vault UPDATE PROTOCOL** — move flaw U1 to Resolved. Step 6: commit `feat(universe): draggable Obsidian-style force graph with detail panel`.

**Gate:** graph is draggable/zoomable/clickable on real snapshot data, positions persist, no idle CPU burn; verifier CONFIRMED.

---

## Phase 8 — Parity audit, package, install

**Why:** Prove nothing regressed, then put v3 in Christian's hands.

### Task 8.1: Parity audit vs Phase 0 inventory

**Files:** Update `docs/superpowers/plans/v3-parity-inventory.md` (check off / annotate each item).

- [ ] Step 1: Walk every capability + Settings pane + IPC command in the inventory; confirm the new frontend reaches it or record an explicit, approved removal. Step 2: List any gaps as fresh tasks and close them before proceeding. Step 3: Full test run: `npm test` (frontend) + `cd src-tauri && cargo test` (proves the backend freeze held) — both green. Step 4: Commit the annotated inventory.

### Task 8.2: Package + install with rollback preserved

**Files:** none (build + install).

- [ ] Step 1: `git status` clean (no rogue-daemon junk). Step 2: `npm run tauri build -- --bundles app`. Step 3: Preserve rollback: keep `~/CodaKiller-v1.3.0-rollback.app` and the current v2.0.0 `.app`; take a fresh pre-install DB backup into the app-data `backups/` dir with SHA logged. Step 4: Verify the packaged app launches, renders (WKWebView), and the live schema-7→10 migration path is unchanged (rehearse on a DISPOSABLE copy per NOTES.md; never open the live DB from dev). Step 5: Install to `/Applications/CodaKiller.app`. Step 6: Note the TCC re-grant (mic + Speech after rebuild) in the handoff.

### Task 8.3: Version bump, docs, tag

- [ ] Step 1: Bump version to `3.0.0` (`package.json`, `src-tauri/Cargo.toml`, `Cargo.lock`). Step 2: Full **Vault UPDATE PROTOCOL** — new `versions/(C) v3.0.0 — Version Record.md`, `(C) How To Use.md` + `Matches: v3.0.0` (the installed app changed — mapping wizard, brain connection, monochrome theme, interactive universe are all user-facing), Changelog, CodaKiller.md, Roadmap, Command Center, Flaws (B10/U1 → Resolved with commits), NOTES.md. Step 3: Commit + `git tag v3.0.0`. Step 4: Hand off to Christian for at-piano acceptance (the one thing no desk gate can close).

**Gate:** parity audit clean, all tests green, packaged app installed with rollback preserved, docs current, tagged. At-piano acceptance = Christian.

---

## Self-review notes (author)

- **Spec coverage:** complaint #1 mapping → Phase 4; #2 brain → Phase 1 (+ status UI Phase 2/3); #3 theme → Phase 2 tokens; #4 de-clutter → Phase 2 kit + per-workspace disclosure law; #5 universe → Phase 7. Pre-mapping his pieces → Task 4.3. Truthful status → Tasks 1.3–1.4 + 2.4.
- **Backend-freeze proof:** `cargo test` green after Phase 1 and again at Phase 8.
- **No invented IPC:** every command used appears in the Phase-0 inventory / scout contract; every phase with unknown payload shapes has an explicit read-first step.
- **Open non-goals (unchanged):** voice-over-Steinway tuning, natural-language voice section-start (V2), next-day retention flow beyond the queue, auto-OMR (S2), off-disk git remote (blocked on `gh auth login`), B25 history-at-scale reflow.
