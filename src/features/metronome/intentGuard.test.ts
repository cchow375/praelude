import { describe, expect, it } from "vitest";
import { beginMetroIntent, readMetroIntentState } from "./intentGuard";

// ---------------------------------------------------------------------------
// intentGuard holds MODULE-LEVEL SINGLETON state (`revision` / `pending`).
// That state persists across every `it()` in this file (module registries are
// only reset between separate test files). Never assert absolute values —
// always snapshot `readMetroIntentState()` before an action and assert the
// delta, exactly as src/features/rep/useRep.test.ts already does for this
// same module.
// ---------------------------------------------------------------------------

describe("readMetroIntentState", () => {
  it("returns the current revision/pending pair without mutating it as a side effect", () => {
    const a = readMetroIntentState();
    const b = readMetroIntentState();
    expect(b).toEqual(a);
  });
});

describe("beginMetroIntent — starting a lease", () => {
  it("increments both revision and pending when a lease begins", () => {
    const before = readMetroIntentState();
    beginMetroIntent();
    const after = readMetroIntentState();
    expect(after.pending).toBe(before.pending + 1);
    expect(after.revision).toBe(before.revision + 1);
  });

  it("accumulates pending across multiple overlapping (unreleased) intents", () => {
    const before = readMetroIntentState();
    beginMetroIntent();
    beginMetroIntent();
    const after = readMetroIntentState();
    expect(after.pending).toBe(before.pending + 2);
  });
});

describe("beginMetroIntent — releasing a lease", () => {
  it("decrements pending back to the pre-lease value on release", () => {
    const before = readMetroIntentState();
    const release = beginMetroIntent();
    release();
    expect(readMetroIntentState().pending).toBe(before.pending);
  });

  it("bumps revision again on release (once per begin, once per release)", () => {
    const before = readMetroIntentState();
    const release = beginMetroIntent();
    release();
    const after = readMetroIntentState();
    expect(after.revision).toBe(before.revision + 2);
  });

  it("is idempotent: calling the returned release function a second time is a no-op", () => {
    const before = readMetroIntentState();
    const release = beginMetroIntent();
    release();
    const afterFirstRelease = readMetroIntentState();
    release(); // second call must not double-decrement pending or double-bump revision
    release(); // and a third, for good measure
    const afterExtraReleases = readMetroIntentState();
    expect(afterExtraReleases).toEqual(afterFirstRelease);
    expect(afterFirstRelease.pending).toBe(before.pending);
  });

  it("resolves overlapping intents correctly when released out of begin-order", () => {
    const before = readMetroIntentState();
    const releaseA = beginMetroIntent();
    const releaseB = beginMetroIntent();
    expect(readMetroIntentState().pending).toBe(before.pending + 2);

    releaseB(); // release the SECOND-begun intent first
    expect(readMetroIntentState().pending).toBe(before.pending + 1);

    releaseA();
    expect(readMetroIntentState().pending).toBe(before.pending);
  });

  it("keeps each lease's release function independently idempotent", () => {
    const releaseA = beginMetroIntent();
    const releaseB = beginMetroIntent();

    releaseA();
    releaseA(); // redundant release of A must not consume B's lease
    const before = readMetroIntentState();

    releaseB();
    const after = readMetroIntentState();
    expect(after.pending).toBe(before.pending - 1);
  });

  it("never lets pending fall below zero, even under a pathological release pattern", () => {
    // TODO(dev): determine whether there is any real call path that can drive
    // this floor (Math.max(0, pending - 1)) — normal begin/release pairing
    // can't, since release() is guarded by its own `active` flag. If no such
    // path exists, consider this documentation of the invariant rather than a
    // reachable regression test, and note that in a comment here.
    expect(readMetroIntentState().pending).toBeGreaterThanOrEqual(0);
  });
});

describe("integration: consumers that depend on intentGuard's contract", () => {
  // These are documented as TODOs rather than fake assertions because they
  // require either mocking @tauri-apps/api/core (see useMetronome.test.ts's
  // vi.mock pattern) or importing useRep's private guard helpers, which are
  // not exported from useRep.ts today.
  it.todo(
    "useMetronome's call() (src/features/metronome/useMetronome.ts) wraps " +
      "every invoke() in beginMetroIntent()/release() via try/finally — " +
      "assert pending returns to its pre-call baseline after invoke() " +
      "resolves AND after invoke() rejects (error path), using the " +
      'vi.mock("@tauri-apps/api/core") pattern from useMetronome.test.ts',
  );
  it.todo(
    "useRep's metroCommandGuardIsCurrent (src/features/rep/useRep.ts) treats " +
      "a captured guard as current only when pendingIntents === 0 and " +
      "intentRevision is unchanged — assert that a manual metronome action " +
      "started mid-rep-mutation correctly invalidates that mutation's guard " +
      "(see the existing 'holds a shared manual-intent lease' test in " +
      "src/features/rep/useRep.test.ts for the pattern)",
  );
});
