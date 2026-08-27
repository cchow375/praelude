import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DockPanel } from "../dock/DockPanel";
import { useDock, useDockContext } from "../dock/DockProvider";
import {
  DENSE_LAYOUT_FLOOR,
  NAV_RAIL_WIDTH,
  dockPanelMaxHeight,
} from "../dock/dockState";
import type {
  RepOpenArgs,
  RepSnapshot,
  SetFocusContextInput,
} from "../rep/useRep";
import {
  readRotationSettings,
  ROTATION_ADD_EVENT,
  rotationOpenRequest,
  shuffleRotation,
  validateRotationTarget,
  writeRotationSettings,
  type RotationSettings,
  type RotationTarget,
} from "./rotation";
import "./rotation.css";

export const PANEL_WIDTH = 360;

/**
 * The shell's bottom Tools row is about 43 px tall at the 720x520 floor.
 * Keep a small breathing margin as well: unlike the generic dock clamp, a
 * Rotation panel must leave this whole band untouched so Minutes each and
 * Start rotation cannot end up underneath the row after collision fallback.
 */
export const BOTTOM_DOCK_SAFE_RESERVE_PX = 56;

/** Pure geometry used by both the runtime clamp and the dense-layout test. */
export function rotationSafeMaxY(viewportHeight: number): number {
  const maximumPanelHeight = dockPanelMaxHeight(viewportHeight, 0);
  return Math.max(
    0,
    viewportHeight - BOTTOM_DOCK_SAFE_RESERVE_PX - maximumPanelHeight,
  );
}

export const DEFAULT_POSITION = {
  x: NAV_RAIL_WIDTH + 12,
  y: Math.min(184, rotationSafeMaxY(DENSE_LAYOUT_FLOOR.height)),
};

export interface RotationPanelProps {
  activeRep: RepSnapshot | null;
  defaultCleanStreak: number;
  onOpenBlock(
    args: RepOpenArgs,
    context?: SetFocusContextInput | null,
  ): Promise<RepSnapshot>;
  onPause(expectedBlockId: number): Promise<void>;
  onCycleComplete?: () => void;
  audioFactory?: (src: string) => { play(): Promise<void> };
  now?: () => number;
  random?: () => number;
}

type RotationPhase =
  "opening" | "running" | "awaiting_switch" | "switching" | "complete";

interface ActiveRotation {
  order: RotationTarget[];
  index: number;
  cycle: number;
  epoch: number;
  phase: RotationPhase;
  stationStartedAt: number | null;
  stationEndsAt: number | null;
  ownedBlockId: number | null;
  ownedWasPaused: boolean;
}

function remainingLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RotationPanel({
  activeRep,
  defaultCleanStreak,
  onOpenBlock,
  onPause,
  onCycleComplete,
  audioFactory = (src) => new Audio(src),
  now = Date.now,
  random = Math.random,
}: RotationPanelProps) {
  const { state: dockState, move: moveDockPanel } = useDockContext();
  const dock = useDock("rotation");
  const panelState = dockState.rotation;
  const [settings, setSettings] = useState<RotationSettings>(() =>
    readRotationSettings(),
  );
  const [run, setRun] = useState<ActiveRotation | null>(null);
  const [clock, setClock] = useState(() => now());
  const [notice, setNotice] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const runRef = useRef<ActiveRotation | null>(null);
  const activeRepRef = useRef(activeRep);
  const dockRef = useRef(dock);
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const startPendingRef = useRef(false);
  const switchPendingRef = useRef(false);
  const onCycleCompleteRef = useRef(onCycleComplete);
  settingsRef.current = settings;
  runRef.current = run;
  activeRepRef.current = activeRep;
  dockRef.current = dock;
  onCycleCompleteRef.current = onCycleComplete;

  // The generic dock collision fallback intentionally guarantees only a
  // minimum visible slice. At the 720x520 floor that fallback is y=360,
  // directly underneath the shell's bottom Tools row. Rotation has primary
  // controls at its foot, so keep its whole maximum box above that reserved
  // band. This only bounds an unsafe y; x and every safe dragged/keyboard
  // position remain exactly as the user left them.
  useLayoutEffect(() => {
    if (!panelState?.open || panelState.minimized) return;
    if (window.innerHeight > DENSE_LAYOUT_FLOOR.height) return;
    const safeY = rotationSafeMaxY(window.innerHeight);
    if (panelState.y <= safeY) return;
    moveDockPanel("rotation", panelState.x, safeY);
  }, [
    moveDockPanel,
    panelState?.minimized,
    panelState?.open,
    panelState?.x,
    panelState?.y,
  ]);

  const replaceRun = useCallback((next: ActiveRotation | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
      epochRef.current += 1;
      startPendingRef.current = false;
      switchPendingRef.current = false;
    },
    [],
  );

  const updateSettings = useCallback(
    (recipe: (current: RotationSettings) => RotationSettings) => {
      setSettings((current) => {
        const next = recipe(current);
        writeRotationSettings(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const onAdd = (event: Event) => {
      const target = validateRotationTarget(
        (event as CustomEvent<RotationTarget>).detail,
      );
      if (!target) return;
      updateSettings((current) => ({
        ...current,
        targets: current.targets.some((item) => item.key === target.key)
          ? current.targets
          : [...current.targets, target],
      }));
      setNotice(`${target.label} added to the rotation.`);
      dockRef.current.open();
    };
    window.addEventListener(ROTATION_ADD_EVENT, onAdd);
    return () => window.removeEventListener(ROTATION_ADD_EVENT, onAdd);
  }, [updateSettings]);

  useEffect(() => {
    if (!run || run.phase !== "running") return;
    const id = window.setInterval(() => setClock(now()), 500);
    return () => window.clearInterval(id);
  }, [now, run?.epoch, run?.index, run?.phase, run?.stationEndsAt]);

  const targetMatchesSnapshot = useCallback(
    (target: RotationTarget, snapshot: RepSnapshot) =>
      snapshot.block_id > 0 &&
      snapshot.piece_id === target.piece_id &&
      snapshot.region_id === target.region_id &&
      snapshot.m_start === target.m_start &&
      snapshot.m_end === target.m_end,
    [],
  );

  const openStation = useCallback(
    async (target: RotationTarget) => {
      const request = rotationOpenRequest(target, defaultCleanStreak);
      const opened = await onOpenBlock(request.args, request.context);
      if (!targetMatchesSnapshot(target, opened)) {
        throw new Error(
          "The practice engine opened a different set. The rotation did not take ownership of it.",
        );
      }
      return opened;
    },
    [defaultCleanStreak, onOpenBlock, targetMatchesSnapshot],
  );

  const exactActiveDisposition = useCallback(
    (
      current: ActiveRotation,
    ): "none" | "owned_active" | "owned_paused" | "unknown" | "other" => {
      if (current.ownedBlockId == null) return "unknown";
      const snapshot = activeRepRef.current;
      if (!snapshot) return "none";
      if (snapshot.block_id !== current.ownedBlockId) return "other";
      return snapshot.set_state === "paused" || current.ownedWasPaused
        ? "owned_paused"
        : "owned_active";
    },
    [],
  );

  const finishCycle = useCallback(
    (current: ActiveRotation) => {
      const completed: ActiveRotation = {
        ...current,
        phase: "complete",
        stationStartedAt: null,
        stationEndsAt: null,
      };
      replaceRun(completed);
      dockRef.current.flash();
      onCycleCompleteRef.current?.();
      setNotice(
        `Cycle ${current.cycle} complete — all ${current.order.length} passages retrieved.`,
      );
    },
    [replaceRun],
  );

  const transitionTo = useCallback(
    async (
      source: ActiveRotation,
      order: RotationTarget[],
      nextIndex: number,
      nextCycle: number,
    ) => {
      if (switchPendingRef.current || source.epoch !== epochRef.current) return;
      const disposition = exactActiveDisposition(source);
      if (disposition === "unknown") {
        setNotice(
          "Still confirming the rotation’s exact practice set. Nothing was paused.",
        );
        return;
      }
      if (disposition === "other") {
        setNotice(
          "Another practice set is active. Pause or close it yourself before retrieving the next station.",
        );
        return;
      }

      switchPendingRef.current = true;
      const epoch = source.epoch;
      const target = order[nextIndex];
      let currentCeased =
        source.phase === "awaiting_switch" ||
        source.phase === "complete" ||
        disposition === "none" ||
        disposition === "owned_paused";
      replaceRun({ ...source, phase: "switching" });
      setNotice(`Retrieving ${target.label}…`);
      try {
        if (disposition === "owned_active") {
          await onPause(source.ownedBlockId!);
          currentCeased = true;
          const pending = runRef.current;
          if (pending?.epoch === epoch) {
            replaceRun({ ...pending, ownedWasPaused: true });
          }
        }
        if (
          !mountedRef.current ||
          epochRef.current !== epoch ||
          runRef.current?.epoch !== epoch ||
          runRef.current?.phase !== "switching"
        ) {
          return;
        }

        const opened = await openStation(target);
        if (
          !mountedRef.current ||
          epochRef.current !== epoch ||
          runRef.current?.epoch !== epoch ||
          runRef.current?.phase !== "switching"
        ) {
          return;
        }
        const startedAt = now();
        const duration = settingsRef.current.station_minutes * 60_000;
        const next: ActiveRotation = {
          order,
          index: nextIndex,
          cycle: nextCycle,
          epoch,
          phase: "running",
          stationStartedAt: startedAt,
          stationEndsAt: startedAt + duration,
          ownedBlockId: opened.block_id,
          ownedWasPaused: opened.set_state === "paused",
        };
        setClock(startedAt);
        replaceRun(next);
        setNotice(`Retrieved ${target.label}. The full station starts now.`);
      } catch (cause) {
        if (
          mountedRef.current &&
          epochRef.current === epoch &&
          runRef.current?.epoch === epoch
        ) {
          replaceRun({
            ...source,
            phase: currentCeased ? "awaiting_switch" : source.phase,
            stationStartedAt: currentCeased ? null : source.stationStartedAt,
            stationEndsAt: currentCeased ? null : source.stationEndsAt,
            ownedWasPaused: source.ownedWasPaused || currentCeased,
          });
          setNotice(
            cause instanceof Error
              ? `${cause.message} Choose Next station to retry.`
              : "The next station could not open. Choose Next station to retry.",
          );
        }
      } finally {
        if (epochRef.current === epoch) switchPendingRef.current = false;
      }
    },
    [exactActiveDisposition, now, onPause, openStation, replaceRun],
  );

  const switchStation = useCallback(async () => {
    const current = runRef.current;
    if (!current || switchPendingRef.current) return;
    if (current.index === current.order.length - 1) {
      finishCycle(current);
      return;
    }
    await transitionTo(
      current,
      current.order,
      current.index + 1,
      current.cycle,
    );
  }, [finishCycle, transitionTo]);

  useEffect(() => {
    if (!run || run.phase !== "running" || run.stationEndsAt == null) {
      return undefined;
    }
    const epoch = run.epoch;
    const index = run.index;
    const deadline = run.stationEndsAt;
    const id = window.setTimeout(
      () => {
        const current = runRef.current;
        if (
          !mountedRef.current ||
          !current ||
          current.epoch !== epoch ||
          current.index !== index ||
          current.phase !== "running" ||
          current.stationEndsAt !== deadline ||
          now() < deadline
        ) {
          return;
        }
        try {
          void audioFactory("/chime.wav")
            .play()
            .catch(() => undefined);
        } catch {
          // The visual/status prompt is authoritative even if audio construction fails.
        }
        setClock(deadline);
        if (current.index === current.order.length - 1) {
          finishCycle(current);
        } else {
          replaceRun({
            ...current,
            phase: "awaiting_switch",
            stationStartedAt: null,
            stationEndsAt: null,
          });
          dockRef.current.flash();
          setNotice("Time — retrieve the next passage when you are ready.");
        }
      },
      Math.max(0, deadline - now()),
    );
    return () => window.clearTimeout(id);
  }, [audioFactory, finishCycle, now, replaceRun, run]);

  const start = async () => {
    if (startPendingRef.current || runRef.current) return;
    if (settings.targets.length < 2) {
      setNotice("Add at least two score sections before starting a rotation.");
      return;
    }
    const activeAtStart = activeRepRef.current;
    if (activeAtStart) {
      setNotice("Pause or close the current set before starting the rotation.");
      return;
    }
    const order = settings.shuffle
      ? shuffleRotation(settings.targets, random)
      : [...settings.targets];
    startPendingRef.current = true;
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    const opening: ActiveRotation = {
      order,
      index: 0,
      cycle: 1,
      epoch,
      phase: "opening",
      stationStartedAt: null,
      stationEndsAt: null,
      ownedBlockId: null,
      ownedWasPaused: false,
    };
    replaceRun(opening);
    setNotice(`Opening ${order[0].label}…`);
    try {
      const opened = await openStation(order[0]);
      // The synchronous guard above narrows `runRef.current` to null for this
      // invocation in TypeScript's control-flow model; `replaceRun(opening)`
      // intentionally changed the ref before this await.
      const current = runRef.current as ActiveRotation | null;
      if (
        !mountedRef.current ||
        epochRef.current !== epoch ||
        current?.epoch !== epoch ||
        current.phase !== "opening"
      ) {
        return;
      }
      const startedAt = now();
      const duration = settingsRef.current.station_minutes * 60_000;
      setClock(startedAt);
      replaceRun({
        ...opening,
        phase: "running",
        stationStartedAt: startedAt,
        stationEndsAt: startedAt + duration,
        ownedBlockId: opened.block_id,
        ownedWasPaused: opened.set_state === "paused",
      });
      setNotice(
        `Rotation started with ${order[0].label}. The full station starts now.`,
      );
    } catch (cause) {
      if (mountedRef.current && epochRef.current === epoch) {
        replaceRun(null);
        setNotice(
          cause instanceof Error
            ? cause.message
            : "The rotation could not start.",
        );
      }
    } finally {
      if (epochRef.current === epoch) startPendingRef.current = false;
    }
  };

  const startNextCycle = async () => {
    const current = runRef.current;
    if (!current || current.phase !== "complete" || switchPendingRef.current)
      return;
    const targets = settingsRef.current.targets;
    if (targets.length < 2) {
      setNotice("Keep at least two score sections to begin another cycle.");
      return;
    }
    const order = settingsRef.current.shuffle
      ? shuffleRotation(targets, random)
      : [...targets];
    await transitionTo(current, order, 0, current.cycle + 1);
  };

  const endRotation = () => {
    const current = runRef.current;
    if (
      startPendingRef.current ||
      switchPendingRef.current ||
      current?.phase === "opening" ||
      current?.phase === "switching"
    ) {
      setNotice(
        "Finish the current station handoff before ending the rotation.",
      );
      return;
    }
    epochRef.current += 1;
    startPendingRef.current = false;
    switchPendingRef.current = false;
    replaceRun(null);
    setNotice("Rotation ended. The current practice set was left unchanged.");
  };

  const currentTarget = run?.order[run.index] ?? null;
  const remaining = run?.stationEndsAt == null ? 0 : run.stationEndsAt - clock;
  const matchingActive =
    activeRep != null &&
    run?.ownedBlockId != null &&
    activeRep.block_id === run.ownedBlockId;
  const progress =
    run?.stationStartedAt != null && run.stationEndsAt != null
      ? Math.max(
          0,
          Math.min(
            1,
            (clock - run.stationStartedAt) /
              (run.stationEndsAt - run.stationStartedAt),
          ),
        )
      : 0;
  const statusText = useMemo(() => {
    if (!run || !currentTarget) return "Build a circuit from score sections.";
    if (run.phase === "opening") return "Opening the first station…";
    if (run.phase === "switching") return "Opening the next station…";
    if (run.phase === "complete") return `Cycle ${run.cycle} complete`;
    if (run.phase === "awaiting_switch")
      return "Time · ready for the next station";
    if (run.ownedBlockId == null) return "Confirming the exact opened set…";
    if (!matchingActive) return "The station set is not active.";
    return `${run.index + 1} of ${run.order.length} · ${remainingLabel(remaining)}`;
  }, [currentTarget, matchingActive, remaining, run]);

  return (
    <DockPanel
      id="rotation"
      title="Practice rotation"
      width={PANEL_WIDTH}
      defaultPosition={DEFAULT_POSITION}
    >
      <div className="rotation-panel">
        <header>
          <p>{statusText}</p>
          {run && <strong>{currentTarget?.label}</strong>}
        </header>
        {run?.stationStartedAt != null && run.stationEndsAt != null && (
          <div
            className="rotation-progress"
            aria-label={`${Math.round(progress * 100)}% of station`}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        {!run && (
          <>
            <ol className="rotation-targets">
              {settings.targets.map((target, index) => (
                <li key={target.key}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{target.label}</strong>
                    <small>
                      {target.piece_title} · mm. {target.m_start}–{target.m_end}
                    </small>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${target.label} from rotation`}
                    onClick={() =>
                      updateSettings((current) => ({
                        ...current,
                        targets: current.targets.filter(
                          (item) => item.key !== target.key,
                        ),
                      }))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            {settings.targets.length === 0 && (
              <p className="rotation-empty">
                Open a named score section and choose “Add to rotation.”
              </p>
            )}
            <div className="rotation-options">
              <label>
                Minutes each
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.station_minutes}
                  onChange={(event) => {
                    const value = Math.max(
                      1,
                      Math.min(60, Number(event.target.value) || 1),
                    );
                    updateSettings((current) => ({
                      ...current,
                      station_minutes: value,
                    }));
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.shuffle}
                  onChange={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      shuffle: event.target.checked,
                    }))
                  }
                />
                Shuffle order
              </label>
            </div>
            <button
              type="button"
              className="rotation-start"
              onClick={() => void start()}
            >
              Start rotation
            </button>
          </>
        )}

        {run && (
          <div className="rotation-run-actions">
            {run.phase === "complete" ? (
              <button type="button" onClick={() => void startNextCycle()}>
                Start next cycle
              </button>
            ) : (
              <button
                type="button"
                disabled={run.phase === "opening" || run.phase === "switching"}
                onClick={() => void switchStation()}
              >
                {run.index === run.order.length - 1
                  ? "Complete cycle"
                  : "Next station"}
              </button>
            )}
            <button
              type="button"
              disabled={run.phase === "opening" || run.phase === "switching"}
              onClick={endRotation}
            >
              End rotation
            </button>
          </div>
        )}
        {notice && (
          <p className="rotation-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </DockPanel>
  );
}
