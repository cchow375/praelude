import {
  lazy,
  Suspense,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { WorkspaceStub } from "./WorkspaceStub";
import "./shell.css";

/**
 * The v3 app shell: exactly FIVE workspace slots and one quiet text-button nav.
 * The active target is marked by ink weight, never a filled pill. Workspaces are
 * lazy-loaded; every slot that a later phase has not yet rebuilt renders a
 * WorkspaceStub so the app always runs. Settings is a separate utility surface
 * (Task 2.4 injects the real panel via `settingsContent`), not a sixth tab.
 *
 * Motion budget: one staggered entrance on load (CSS, runs once). No loops.
 */

const WORKSPACES = [
  { id: "today", label: "Today" },
  { id: "score", label: "Score" },
  { id: "brain", label: "Brain" },
  // The Ledger/Calendar slot (Phase 6 fills both behind this one entry).
  { id: "ledger", label: "Ledger" },
  { id: "universe", label: "Universe" },
] as const;

type WorkspaceId = (typeof WORKSPACES)[number]["id"];
type View = WorkspaceId | "settings";

function stub(id: WorkspaceId, name: string): ComponentType {
  return () => <WorkspaceStub id={id} name={name} />;
}

// Lazy per slot. Not-yet-built workspaces resolve to a stub; later phases swap
// the loader body for the real workspace module import.
const WORKSPACE_COMPONENTS: Record<WorkspaceId, ComponentType> = {
  today: lazy(async () => ({ default: stub("today", "Today") })),
  score: lazy(() =>
    import("../features/score/ScoreWorkspace").then((m) => ({
      default: m.ScoreWorkspace,
    })),
  ),
  brain: lazy(() =>
    import("../features/brain/BrainWorkspace").then((m) => ({
      default: m.BrainWorkspace,
    })),
  ),
  ledger: lazy(async () => ({ default: stub("ledger", "Ledger") })),
  universe: lazy(async () => ({ default: stub("universe", "Universe") })),
};

export interface ShellProps {
  /** The real Settings surface (Task 2.4). Falls back to a stub when absent. */
  settingsContent?: ReactNode;
}

export function Shell({ settingsContent }: ShellProps) {
  const [view, setView] = useState<View>("today");
  const tabRefs = useRef<
    Partial<Record<WorkspaceId, HTMLButtonElement | null>>
  >({});

  const focusTab = (id: WorkspaceId) => {
    setView(id);
    requestAnimationFrame(() => tabRefs.current[id]?.focus());
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    id: WorkspaceId,
  ) => {
    const index = WORKSPACES.findIndex((w) => w.id === id);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % WORKSPACES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + WORKSPACES.length) % WORKSPACES.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = WORKSPACES.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    focusTab(WORKSPACES[next].id);
  };

  const ActiveWorkspace =
    view === "settings" ? null : WORKSPACE_COMPONENTS[view];

  return (
    <div className="shell">
      <aside className="shell-rail" aria-label="CodaKiller">
        <div className="shell-wordmark">CodaKiller</div>

        <nav
          className="shell-nav shell-enter"
          role="tablist"
          aria-label="Workspace"
          aria-orientation="vertical"
        >
          {WORKSPACES.map((workspace, index) => {
            const selected = view === workspace.id;
            return (
              <button
                key={workspace.id}
                ref={(node) => {
                  tabRefs.current[workspace.id] = node;
                }}
                type="button"
                role="tab"
                id={`tab-${workspace.id}`}
                aria-controls="shell-stage"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`shell-nav-item${selected ? " is-active" : ""}`}
                style={{ ["--enter-index" as string]: index }}
                onClick={() => setView(workspace.id)}
                onKeyDown={(event) => onTabKeyDown(event, workspace.id)}
              >
                {workspace.label}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          className={`shell-settings-button${view === "settings" ? " is-active" : ""}`}
          aria-pressed={view === "settings"}
          onClick={() =>
            setView((current) =>
              current === "settings" ? "today" : "settings",
            )
          }
        >
          Settings
        </button>
      </aside>

      <main
        id="shell-stage"
        className="shell-stage"
        role="tabpanel"
        aria-labelledby={view === "settings" ? undefined : `tab-${view}`}
      >
        <Suspense
          fallback={<div className="shell-loading" aria-hidden="true" />}
        >
          {view === "settings"
            ? (settingsContent ?? (
                <WorkspaceStub id="settings" name="Settings" />
              ))
            : ActiveWorkspace && <ActiveWorkspace />}
        </Suspense>
      </main>
    </div>
  );
}
