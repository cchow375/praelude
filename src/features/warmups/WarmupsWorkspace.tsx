import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { nativeWarmupApi } from "./api";
import {
  filterWarmups,
  warmupById,
  WARMUP_CATALOG,
  WARMUP_TARGETS,
} from "./catalog";
import { KeyboardFigure } from "./KeyboardFigure";
import type {
  WarmupApi,
  WarmupRoutine,
  WarmupRoutineItem,
  WarmupTarget,
  WarmupWorkspaceProps,
} from "./types";
import type { RepSnapshot } from "../rep/useRep";
import { SET_COMPLETION_SECONDS } from "../rep/useSetCompletion";
import { useOptionalDock } from "../dock/DockProvider";
import "./warmups.css";

const CATALOG_PAGE_SIZE = 36;
const COMPACT_VIEWPORT_WIDTH = 720;
const COMPACT_VIEWPORT_HEIGHT = 520;

type RepTuckPhase = "idle" | "pending" | "owned" | "released";

function isCompactLogicalSize(width: number, height: number): boolean {
  return (
    width <= COMPACT_VIEWPORT_WIDTH && height <= COMPACT_VIEWPORT_HEIGHT
  );
}

function isCompactBrowserViewport(): boolean {
  if (typeof window === "undefined") return false;
  return isCompactLogicalSize(window.innerWidth, window.innerHeight);
}

interface ExpectedWarmupSet {
  pieceId: number;
  mStart: number;
  mEnd: number;
  label: string;
}

interface MasteryWitness {
  blockId: number;
  attemptId: number | null;
}

interface ActiveRun {
  epoch: number;
  name: string;
  items: WarmupRoutineItem[];
  index: number;
  systemPieceId: number;
  phase: "ready" | "opening" | "active" | "mastered" | "held" | "done";
  expected: ExpectedWarmupSet | null;
  blockId: number | null;
  sawUnfinished: boolean;
  masteryWitness: MasteryWitness | null;
  autoCloseEligibleAt: number | null;
  autoStart: boolean;
}

function initialItem(catalogId: string): WarmupRoutineItem {
  const definition = warmupById(catalogId);
  return {
    catalog_id: catalogId,
    bpm: definition?.defaultBpm.min ?? 60,
    clean_streak: definition?.defaultCleanStreak ?? 3,
  };
}

function itemLabel(item: WarmupRoutineItem): string {
  return warmupById(item.catalog_id)?.name ?? "Unknown warmup";
}

function expectedSet(
  run: ActiveRun,
  definition: NonNullable<ReturnType<typeof warmupById>>,
): ExpectedWarmupSet {
  const catalogIndex = WARMUP_CATALOG.findIndex(
    (entry) => entry.id === definition.id,
  );
  const measure = catalogIndex + 1;
  return {
    pieceId: run.systemPieceId,
    mStart: measure,
    mEnd: measure,
    label: definition.name,
  };
}

function matchesExpectedSet(
  snap: RepSnapshot,
  expected: ExpectedWarmupSet,
): boolean {
  return (
    snap.piece_id === expected.pieceId &&
    snap.region_id == null &&
    snap.m_start === expected.mStart &&
    snap.m_end === expected.mEnd &&
    snap.label === expected.label
  );
}

function hasVerifiedMastery(snap: RepSnapshot): boolean {
  return snap.mastery_verified === true && snap.mastery_status === "satisfied";
}

export function WarmupsWorkspace({
  activeRep,
  onOpenBlock,
  onRoutineComplete,
  api = nativeWarmupApi,
}: WarmupWorkspaceProps) {
  const [routines, setRoutines] = useState<WarmupRoutine[]>([]);
  const [name, setName] = useState("Today's warmup");
  const [routineId, setRoutineId] = useState<number | null>(null);
  const [items, setItems] = useState<WarmupRoutineItem[]>([]);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<WarmupTarget | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [catalogLimit, setCatalogLimit] = useState(CATALOG_PAGE_SIZE);
  const activeRepRef = useRef(activeRep);
  const runEpochRef = useRef(0);
  const beginRef = useRef(false);
  const openingRef = useRef<string | null>(null);
  const advancedRef = useRef<Set<string>>(new Set());
  const completedFxRef = useRef<Set<number>>(new Set());
  const repDock = useOptionalDock("rep");
  const latestRepDock = useRef(repDock);
  const repTuckPhase = useRef<RepTuckPhase>("idle");
  const restoreRepTimer = useRef<number | null>(null);
  // Do not trust zoomed DOM dimensions while the native measurement is
  // pending. Browser sizing is installed only if a Tauri window call rejects.
  const [compactViewport, setCompactViewport] = useState(false);
  activeRepRef.current = activeRep;
  latestRepDock.current = repDock;

  useEffect(() => {
    let active = true;
    let nativeAvailable = true;
    let measurementRevision = 0;
    let unlisten: (() => void) | null = null;

    const applyBrowserFallback = () => {
      if (active) setCompactViewport(isCompactBrowserViewport());
    };

    const abandonNativeBounds = () => {
      if (!active || !nativeAvailable) return;
      nativeAvailable = false;
      measurementRevision += 1;
      unlisten?.();
      unlisten = null;
      applyBrowserFallback();
    };

    const handleBrowserResize = () => {
      if (!nativeAvailable) applyBrowserFallback();
    };
    window.addEventListener("resize", handleBrowserResize);

    try {
      const nativeWindow = getCurrentWindow();
      const readNativeBounds = async () => {
        const revision = ++measurementRevision;
        try {
          const [physical, scaleFactor] = await Promise.all([
            nativeWindow.innerSize(),
            nativeWindow.scaleFactor(),
          ]);
          if (
            !active ||
            !nativeAvailable ||
            revision !== measurementRevision
          ) {
            return;
          }
          if (
            !Number.isFinite(physical.width) ||
            !Number.isFinite(physical.height) ||
            !Number.isFinite(scaleFactor) ||
            physical.width <= 0 ||
            physical.height <= 0 ||
            scaleFactor <= 0
          ) {
            abandonNativeBounds();
            return;
          }
          setCompactViewport(
            isCompactLogicalSize(
              physical.width / scaleFactor,
              physical.height / scaleFactor,
            ),
          );
        } catch {
          if (revision === measurementRevision) abandonNativeBounds();
        }
      };

      // Read immediately and subscribe independently. Neither an unusually
      // slow native measurement nor late listener registration may leave the
      // other path blocked. Every completion is guarded by the mounted flag
      // and measurement revision below.
      void readNativeBounds();
      void nativeWindow
        .onResized(() => {
          void readNativeBounds();
        })
        .then((stop) => {
          if (!active || !nativeAvailable) {
            stop();
            return;
          }
          unlisten = stop;
        })
        .catch(abandonNativeBounds);
    } catch {
      abandonNativeBounds();
    }

    return () => {
      active = false;
      nativeAvailable = false;
      measurementRevision += 1;
      window.removeEventListener("resize", handleBrowserResize);
      unlisten?.();
      unlisten = null;
    };
  }, []);

  // At the app's 720x520 floor the floating Rep Counter covers the warmup
  // purpose/search controls. Tuck only its panel into Tools; the active set,
  // timer and practice engine remain untouched. The small ownership machine
  // distinguishes our minimize from a later user restore/close/re-minimize,
  // so workspace cleanup never fights an explicit dock choice.
  useEffect(() => {
    if (!repDock) return;

    if (!compactViewport) {
      if (
        (repTuckPhase.current === "pending" ||
          repTuckPhase.current === "owned") &&
        repDock.isOpen &&
        repDock.isMinimized
      ) {
        // The overlap guard no longer applies. Release ownership before
        // restoring so the resulting visible state is not mistaken for a
        // user override or tucked again by a later render.
        repTuckPhase.current = "released";
        repDock.open();
      } else if (
        repTuckPhase.current === "pending" ||
        repTuckPhase.current === "owned"
      ) {
        // A close or restore that raced the resize belongs to the user.
        repTuckPhase.current = "released";
      }
      return;
    }

    if (repTuckPhase.current === "idle") {
      if (repDock.isOpen && !repDock.isMinimized) {
        repTuckPhase.current = "pending";
        repDock.minimize();
      }
      return;
    }

    if (repTuckPhase.current === "pending") {
      if (!repDock.isOpen) repTuckPhase.current = "released";
      else if (repDock.isMinimized) repTuckPhase.current = "owned";
      return;
    }

    if (
      repTuckPhase.current === "owned" &&
      (!repDock.isOpen || !repDock.isMinimized)
    ) {
      repTuckPhase.current = "released";
    }
  }, [compactViewport, repDock]);

  useEffect(() => {
    // StrictMode runs a synthetic cleanup/setup pair on mount. Deferring the
    // restore lets that replacement setup cancel it, while a real workspace
    // exit restores only the still-owned minimized state.
    if (restoreRepTimer.current != null) {
      window.clearTimeout(restoreRepTimer.current);
      restoreRepTimer.current = null;
    }
    return () => {
      restoreRepTimer.current = window.setTimeout(() => {
        const current = latestRepDock.current;
        if (
          repTuckPhase.current === "owned" &&
          current?.isOpen &&
          current.isMinimized
        ) {
          current.open();
        }
      }, 0);
    };
  }, []);

  const filteredCatalog = useMemo(
    () => filterWarmups(query, target),
    [query, target],
  );
  const visibleCatalog = useMemo(
    () => filteredCatalog.slice(0, catalogLimit),
    [catalogLimit, filteredCatalog],
  );

  const refresh = async (warmupApi: WarmupApi) => {
    try {
      setRoutines(await warmupApi.listRoutines());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Saved warmup routines could not be loaded.",
      );
    }
  };

  useEffect(() => {
    void refresh(api);
  }, [api]);

  const loadRoutine = (routine: WarmupRoutine) => {
    setRoutineId(routine.id);
    setName(routine.name);
    setItems(routine.items.map((item) => ({ ...item })));
    setError(null);
  };

  const newRoutine = () => {
    setRoutineId(null);
    setName("Today's warmup");
    setItems([]);
    setDeleteArmed(null);
    setError(null);
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Name this routine before saving it.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one warmup before saving the routine.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const saved = await api.saveRoutine({
        id: routineId,
        name: name.trim(),
        items,
      });
      setRoutineId(saved.id);
      await refresh(api);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The routine could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  };

  const removeRoutine = async (id: number) => {
    if (deleteArmed !== id) {
      setDeleteArmed(id);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      await api.deleteRoutine(id);
      if (routineId === id) {
        setRoutineId(null);
        setName("Today's warmup");
        setItems([]);
      }
      setDeleteArmed(null);
      await refresh(api);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The routine could not be deleted.",
      );
    } finally {
      setBusy(null);
    }
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    setItems((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  const startItem = useCallback(
    async (currentRun: ActiveRun) => {
      const requestKey = `${currentRun.epoch}:${currentRun.index}`;
      if (openingRef.current === requestKey) return;
      if (activeRepRef.current) {
        setError(
          "Pause or close the current practice set before starting a warmup.",
        );
        return;
      }
      const item = currentRun.items[currentRun.index];
      const definition = item ? warmupById(item.catalog_id) : null;
      if (!item || !definition) {
        setError(
          "This routine contains a warmup that is no longer in the catalog.",
        );
        return;
      }
      const expected = expectedSet(currentRun, definition);
      if (expected.mStart < 1) {
        setError("This warmup no longer has a stable catalog position.");
        return;
      }
      openingRef.current = requestKey;
      setBusy("start");
      setError(null);
      setRun({
        ...currentRun,
        phase: "opening",
        expected,
        blockId: null,
        sawUnfinished: false,
        masteryWitness: null,
        autoCloseEligibleAt: null,
        autoStart: false,
      });
      try {
        const opened = await onOpenBlock(
          {
            piece_id: currentRun.systemPieceId,
            region_id: null,
            m_start: expected.mStart,
            m_end: expected.mEnd,
            label: definition.name,
            start_bpm: item.bpm,
            target_bpm: null,
            planned_reps: null,
            required_clean_streak: item.clean_streak,
            increment: null,
            variants: [],
            // `focus` is the stable engine enum; the exact technique remains in
            // `judging_axis` so adding catalog vocabulary never needs a schema
            // rebuild or pretends the engine understands the piano.
            focus: "other",
            use_metronome: true,
            tuning: {
              beat_unit: "quarter",
              subdivision: 1,
              beats_per_bar: 4,
            },
          },
          {
            intention: definition.howTo,
            judging_axis: definition.targets.join(" · "),
            hands: "hands as written",
            method: "warmup",
          },
        );
        if (runEpochRef.current !== currentRun.epoch) return;
        if (!matchesExpectedSet(opened, expected)) {
          openingRef.current = null;
          setRun((latest) =>
            latest?.epoch === currentRun.epoch &&
            latest.index === currentRun.index
              ? {
                  ...latest,
                  phase: "ready",
                  expected: null,
                  blockId: null,
                  sawUnfinished: false,
                  masteryWitness: null,
                  autoCloseEligibleAt: null,
                  autoStart: false,
                }
              : latest,
          );
          setError(
            "The practice engine opened a different set. This warmup did not take ownership of it.",
          );
          return;
        }
        openingRef.current = null;
        setRun((latest) =>
          latest?.epoch === currentRun.epoch &&
          latest.index === currentRun.index &&
          latest.phase === "opening"
            ? {
                ...latest,
                blockId: opened.block_id,
                sawUnfinished:
                  latest.sawUnfinished || !hasVerifiedMastery(opened),
              }
            : latest,
        );
      } catch (cause) {
        if (runEpochRef.current === currentRun.epoch) {
          openingRef.current = null;
          setRun((latest) =>
            latest?.epoch === currentRun.epoch &&
            latest.index === currentRun.index
              ? {
                  ...latest,
                  phase: "ready",
                  expected: null,
                  blockId: null,
                  sawUnfinished: false,
                  masteryWitness: null,
                  autoCloseEligibleAt: null,
                  autoStart: false,
                }
              : latest,
          );
          setError(
            cause instanceof Error
              ? cause.message
              : "The warmup could not be started.",
          );
        }
      } finally {
        if (runEpochRef.current === currentRun.epoch) {
          setBusy((current) => (current === "start" ? null : current));
        }
      }
    },
    [onOpenBlock],
  );

  useEffect(() => {
    if (!run || run.phase === "done" || run.phase === "ready") return;
    const expected = run.expected;
    if (!expected) return;

    if (run.phase === "opening") {
      if (!activeRep) return;
      if (
        !matchesExpectedSet(activeRep, expected) ||
        (run.blockId != null && run.blockId !== activeRep.block_id)
      ) {
        openingRef.current = null;
        setRun((latest) =>
          latest?.epoch === run.epoch && latest.index === run.index
            ? {
                ...latest,
                phase: "ready",
                expected: null,
                blockId: null,
                sawUnfinished: false,
                masteryWitness: null,
                autoCloseEligibleAt: null,
                autoStart: false,
              }
            : latest,
        );
        setError(
          "A different practice set became active. This warmup did not take ownership of it.",
        );
        return;
      }
      openingRef.current = null;
      const verified = hasVerifiedMastery(activeRep);
      const sawUnfinished = run.sawUnfinished || !verified;
      const autoCloseDisqualified =
        activeRep.safety_state === "stopped" ||
        activeRep.set_state === "paused" ||
        activeRep.timer_state === "paused";
      setRun((latest) =>
        latest?.epoch === run.epoch && latest.index === run.index
          ? {
              ...latest,
              phase: verified
                ? sawUnfinished && !autoCloseDisqualified
                  ? "mastered"
                  : "held"
                : "active",
              blockId: activeRep.block_id,
              sawUnfinished,
              masteryWitness:
                verified && sawUnfinished && !autoCloseDisqualified
                  ? {
                      blockId: activeRep.block_id,
                      attemptId: activeRep.last_attempt_id ?? null,
                    }
                  : null,
              autoCloseEligibleAt:
                verified && sawUnfinished && !autoCloseDisqualified
                  ? Date.now() + SET_COMPLETION_SECONDS * 1_000
                  : null,
            }
          : latest,
      );
      return;
    }

    if (activeRep) {
      const ownsSnapshot =
        run.blockId === activeRep.block_id &&
        matchesExpectedSet(activeRep, expected);
      if (!ownsSnapshot) {
        setRun((latest) =>
          latest?.epoch === run.epoch && latest.index === run.index
            ? {
                ...latest,
                phase: "ready",
                expected: null,
                blockId: null,
                sawUnfinished: false,
                masteryWitness: null,
                autoCloseEligibleAt: null,
                autoStart: false,
              }
            : latest,
        );
        setError(
          "A different practice set replaced this warmup. The routine has not advanced.",
        );
        return;
      }
      if (
        activeRep.safety_state === "stopped" ||
        activeRep.set_state === "paused" ||
        activeRep.timer_state === "paused"
      ) {
        if (run.phase !== "held") {
          setRun((latest) =>
            latest?.epoch === run.epoch && latest.blockId === activeRep.block_id
              ? {
                  ...latest,
                  phase: "held",
                  masteryWitness: null,
                  autoCloseEligibleAt: null,
                }
              : latest,
          );
        }
        return;
      }
      if (hasVerifiedMastery(activeRep)) {
        if (
          run.phase === "mastered" &&
          run.masteryWitness?.attemptId !== (activeRep.last_attempt_id ?? null)
        ) {
          setRun((latest) =>
            latest?.epoch === run.epoch && latest.blockId === activeRep.block_id
              ? {
                  ...latest,
                  phase: "held",
                  masteryWitness: null,
                  autoCloseEligibleAt: null,
                }
              : latest,
          );
        } else if (run.phase === "active" && run.sawUnfinished) {
          setRun((latest) =>
            latest?.epoch === run.epoch && latest.blockId === activeRep.block_id
              ? {
                  ...latest,
                  phase: "mastered",
                  masteryWitness: {
                    blockId: activeRep.block_id,
                    attemptId: activeRep.last_attempt_id ?? null,
                  },
                  autoCloseEligibleAt:
                    Date.now() + SET_COMPLETION_SECONDS * 1_000,
                }
              : latest,
          );
        } else if (run.phase === "active") {
          setRun((latest) =>
            latest?.epoch === run.epoch && latest.blockId === activeRep.block_id
              ? {
                  ...latest,
                  phase: "held",
                  masteryWitness: null,
                  autoCloseEligibleAt: null,
                }
              : latest,
          );
        }
      } else if (run.phase === "mastered") {
        // Undo/recovery cancels Rep Counter's automatic close for this set.
        // Even if the set is re-satisfied later, disappearance is no longer
        // proof that the hands-free close owned it.
        setRun((latest) =>
          latest?.epoch === run.epoch && latest.blockId === activeRep.block_id
            ? {
                ...latest,
                phase: "held",
                masteryWitness: null,
                autoCloseEligibleAt: null,
              }
            : latest,
        );
      } else if (run.phase === "active" && !run.sawUnfinished) {
        setRun((latest) =>
          latest?.epoch === run.epoch && latest.blockId === activeRep.block_id
            ? { ...latest, sawUnfinished: true }
            : latest,
        );
      }
      return;
    }

    if (
      run.phase === "mastered" &&
      run.blockId != null &&
      run.masteryWitness?.blockId === run.blockId &&
      run.autoCloseEligibleAt != null &&
      Date.now() >= run.autoCloseEligibleAt
    ) {
      const advanceKey = `${run.epoch}:${run.blockId}:${run.masteryWitness.attemptId ?? "none"}`;
      if (advancedRef.current.has(advanceKey)) return;
      advancedRef.current.add(advanceKey);
      const nextIndex = run.index + 1;
      setRun(
        nextIndex >= run.items.length
          ? {
              ...run,
              phase: "done",
              expected: null,
              blockId: null,
              sawUnfinished: false,
              masteryWitness: null,
              autoCloseEligibleAt: null,
              autoStart: false,
            }
          : {
              ...run,
              index: nextIndex,
              phase: "ready",
              expected: null,
              blockId: null,
              sawUnfinished: false,
              masteryWitness: null,
              autoCloseEligibleAt: null,
              autoStart: true,
            },
      );
      return;
    }

    if (
      run.phase === "active" ||
      run.phase === "mastered" ||
      run.phase === "held"
    ) {
      setRun((latest) =>
        latest?.epoch === run.epoch && latest.index === run.index
          ? {
              ...latest,
              phase: "ready",
              expected: null,
              blockId: null,
              sawUnfinished: false,
              masteryWitness: null,
              autoCloseEligibleAt: null,
              autoStart: false,
            }
          : latest,
      );
      setError(
        run.phase === "mastered"
          ? "This warmup closed before the automatic-completion window. The routine has not advanced."
          : "This warmup ended before verified mastery and automatic completion. Start this item again when ready.",
      );
    }
  }, [activeRep, run]);

  useEffect(() => {
    if (
      run?.phase === "ready" &&
      run.autoStart &&
      run.epoch === runEpochRef.current &&
      activeRep == null
    ) {
      void startItem(run);
    }
  }, [activeRep, run, startItem]);

  useEffect(() => {
    if (
      !run ||
      run.phase !== "done" ||
      completedFxRef.current.has(run.epoch)
    ) {
      return;
    }
    completedFxRef.current.add(run.epoch);
    onRoutineComplete?.();
  }, [onRoutineComplete, run]);

  const beginRoutine = async () => {
    if (beginRef.current) return;
    if (items.length === 0) {
      setError("Add at least one warmup before starting.");
      return;
    }
    beginRef.current = true;
    setBusy("prepare");
    setError(null);
    try {
      const system = await api.systemPiece();
      const epoch = runEpochRef.current + 1;
      runEpochRef.current = epoch;
      openingRef.current = null;
      const nextRun: ActiveRun = {
        epoch,
        name: name.trim() || "Warmup routine",
        items: items.map((item) => ({ ...item })),
        index: 0,
        systemPieceId: system.piece_id,
        phase: "ready",
        expected: null,
        blockId: null,
        sawUnfinished: false,
        masteryWitness: null,
        autoCloseEligibleAt: null,
        autoStart: false,
      };
      setRun(nextRun);
      await startItem(nextRun);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The warmup runner could not start.",
      );
    } finally {
      beginRef.current = false;
      setBusy(null);
    }
  };

  const currentRunItem = run?.items[run.index] ?? null;
  const currentRunDefinition = currentRunItem
    ? warmupById(currentRunItem.catalog_id)
    : null;
  const ownedActiveRep =
    run?.blockId != null && activeRep?.block_id === run.blockId
      ? activeRep
      : null;
  const leaveRoutine = () => {
    runEpochRef.current += 1;
    openingRef.current = null;
    setBusy(null);
    setRun(null);
  };
  const repCounterTucked = Boolean(
    (repTuckPhase.current === "pending" ||
      repTuckPhase.current === "owned") &&
      repDock?.isOpen &&
      repDock.isMinimized,
  );

  return (
    <main className="warmups-workspace" data-testid="workspace-warmups">
      <header className="warmups-hero">
        <div>
          <p className="warmups-eyebrow">
            Prepare what today actually asks of you
          </p>
          <h1>Warmups with a reason</h1>
          <p>
            Choose the physical or musical demand first. Every item runs through
            the same rep counter, streak, metronome, and history as repertoire.
          </p>
        </div>
        <div className="warmups-proof" aria-label="Warmup catalog summary">
          <strong>{WARMUP_CATALOG.length}</strong>
          <span>curated starting points</span>
          <small>No generic routine is imposed.</small>
        </div>
      </header>

      {repCounterTucked && (
        <aside className="warmups-dock-note" role="status">
          <span>
            Your active set is unchanged. Rep Counter is tucked into Tools so
            it cannot cover Warmups.
          </span>
          <button type="button" onClick={() => repDock?.open()}>
            Show Rep Counter
          </button>
        </aside>
      )}

      {error && (
        <p className="warmups-error" role="alert">
          {error}
        </p>
      )}

      {run && (
        <section className="warmup-runner" aria-label="Active warmup routine">
          <div>
            <span className="warmup-runner-kicker">{run.name}</span>
            {run.phase === "done" ? (
              <>
                <strong>Routine complete</strong>
                <p>
                  {run.items.length} focused warmups recorded in your real
                  history.
                </p>
              </>
            ) : (
              <>
                <strong>
                  {run.index + 1}/{run.items.length} ·{" "}
                  {currentRunDefinition?.name}
                </strong>
                <p>{currentRunDefinition?.howTo}</p>
              </>
            )}
          </div>
          <div className="warmup-runner-actions">
            {run.phase === "ready" && (
              <button
                type="button"
                onClick={() => void startItem(run)}
                disabled={busy != null}
              >
                Start this warmup
              </button>
            )}
            {run.phase === "opening" && <span>Opening…</span>}
            {run.phase === "active" &&
              (ownedActiveRep?.safety_state === "stopped" ? (
                <span>Safety stop is holding this item</span>
              ) : ownedActiveRep?.set_state === "paused" ||
                ownedActiveRep?.timer_state === "paused" ? (
                <span>Rep Counter is paused</span>
              ) : (
                <span>Rep Counter is running</span>
              ))}
            {run.phase === "mastered" && (
              <span>Mastery verified · waiting for automatic close…</span>
            )}
            {run.phase === "held" &&
              (ownedActiveRep?.safety_state === "stopped" ? (
                <span>Safety stop is holding this item</span>
              ) : ownedActiveRep?.set_state === "paused" ||
                ownedActiveRep?.timer_state === "paused" ? (
                <span>Rep Counter is paused</span>
              ) : (
                <span>Automatic advance is no longer armed for this set</span>
              ))}
            <button type="button" className="is-quiet" onClick={leaveRoutine}>
              Leave routine
            </button>
          </div>
        </section>
      )}

      <div className="warmups-layout">
        <section
          className="warmup-catalog"
          aria-labelledby="warmup-catalog-title"
        >
          <div className="warmups-section-heading">
            <div>
              <span>1</span>
              <h2 id="warmup-catalog-title">Choose the demand</h2>
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCatalogLimit(CATALOG_PAGE_SIZE);
              }}
              placeholder="Search scales, octaves, Hanon…"
              aria-label="Search warmups"
            />
          </div>
          <div className="warmup-targets" aria-label="Filter warmups by target">
            <button
              type="button"
              className={target === "all" ? "is-active" : ""}
              onClick={() => {
                setTarget("all");
                setCatalogLimit(CATALOG_PAGE_SIZE);
              }}
            >
              All
            </button>
            {WARMUP_TARGETS.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={target === entry.id ? "is-active" : ""}
                onClick={() => {
                  setTarget(entry.id);
                  setCatalogLimit(CATALOG_PAGE_SIZE);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="warmup-card-grid">
            {visibleCatalog.map((warmup) => (
              <article className="warmup-card" key={warmup.id}>
                <div className="warmup-card-copy">
                  <span>{warmup.category}</span>
                  <h3>{warmup.name}</h3>
                  <p>{warmup.description}</p>
                </div>
                <KeyboardFigure spec={warmup.keyboard} label={warmup.name} />
                <button
                  type="button"
                  onClick={() =>
                    setItems((current) => [...current, initialItem(warmup.id)])
                  }
                >
                  Add to routine
                </button>
              </article>
            ))}
          </div>
          {visibleCatalog.length === 0 && (
            <p className="warmups-empty">
              No warmups match that demand. Try a broader word.
            </p>
          )}
          {visibleCatalog.length > 0 && (
            <div className="warmup-catalog-more">
              <span>
                Showing {visibleCatalog.length} of {filteredCatalog.length}
              </span>
              {visibleCatalog.length < filteredCatalog.length && (
                <button
                  type="button"
                  onClick={() =>
                    setCatalogLimit((current) => current + CATALOG_PAGE_SIZE)
                  }
                >
                  Show more warmups
                </button>
              )}
            </div>
          )}
        </section>

        <aside
          className="warmup-builder"
          aria-labelledby="warmup-builder-title"
        >
          <div className="warmups-section-heading">
            <div>
              <span>2</span>
              <h2 id="warmup-builder-title">Build today’s routine</h2>
            </div>
            <button
              type="button"
              className="warmup-new-routine"
              onClick={newRoutine}
            >
              New routine
            </button>
          </div>
          <label className="warmup-name">
            <span>Routine name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <ol className="warmup-routine-items">
            {items.map((item, index) => (
              <li key={`${item.catalog_id}-${index}`}>
                <div>
                  <strong>{itemLabel(item)}</strong>
                  <span>
                    {warmupById(item.catalog_id)?.targets.join(" · ")}
                  </span>
                </div>
                <label>
                  BPM
                  <input
                    type="number"
                    min={20}
                    max={300}
                    value={item.bpm}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry, itemIndex) =>
                          itemIndex === index
                            ? { ...entry, bpm: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Cleans
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={item.clean_streak}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...entry,
                                clean_streak: Number(event.target.value),
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <div className="warmup-item-actions">
                  <button
                    type="button"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${itemLabel(item)} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label={`Move ${itemLabel(item)} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    aria-label={`Remove ${itemLabel(item)}`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {items.length === 0 && (
            <p className="warmups-empty">
              Choose only what supports today’s repertoire.
            </p>
          )}
          <div className="warmup-builder-actions">
            <button
              type="button"
              onClick={() => void beginRoutine()}
              disabled={busy != null || items.length === 0}
            >
              Start routine
            </button>
            <button
              type="button"
              className="is-secondary"
              onClick={() => void save()}
              disabled={busy != null || items.length === 0}
            >
              {busy === "save"
                ? "Saving…"
                : routineId
                  ? "Update routine"
                  : "Save routine"}
            </button>
          </div>

          {routines.length > 0 && (
            <section
              className="saved-warmups"
              aria-label="Saved warmup routines"
            >
              <h3>Saved routines</h3>
              {routines.map((routine) => (
                <div key={routine.id}>
                  <button type="button" onClick={() => loadRoutine(routine)}>
                    <strong>{routine.name}</strong>
                    <span>{routine.items.length} items</span>
                  </button>
                  <button
                    type="button"
                    className={
                      deleteArmed === routine.id ? "is-danger" : "is-quiet"
                    }
                    onClick={() => void removeRoutine(routine.id)}
                    disabled={busy != null}
                  >
                    {deleteArmed === routine.id ? "Delete now" : "Delete"}
                  </button>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
