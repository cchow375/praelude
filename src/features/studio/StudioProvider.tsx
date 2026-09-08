import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { studioSnapshot, type StudioSnapshot } from "./studioApi";
import "./studioTheme.css";

interface StudioContextValue {
  snapshot: StudioSnapshot | null;
  error: string | null;
  loading: boolean;
  earned: string | null;
  refresh: () => Promise<void>;
  mutate: (
    operation: (revision: number) => Promise<StudioSnapshot>,
    success: string,
  ) => Promise<boolean>;
  busy: boolean;
  message: string | null;
}

const StudioContext = createContext<StudioContextValue | null>(null);
export function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : typeof reason === "string"
      ? reason
      : "Your studio could not be loaded. Please try again.";
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [earned, setEarned] = useState<string | null>(null);
  const current = useRef<StudioSnapshot | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const mutation = useRef(false);
  const refreshQueued = useRef(false);

  const accept = useCallback((next: StudioSnapshot, announce: boolean) => {
    if (!next?.progress || !next.catalog)
      throw new Error("Studio data is unavailable. Please try again.");
    const prev = current.current;
    if (announce && prev) {
      const xp = next.progress.total_xp - prev.progress.total_xp;
      const divisions =
        next.progress.divisions_completed - prev.progress.divisions_completed;
      if (divisions > 0)
        setEarned(
          `${next.progress.rank_name} ${next.progress.division} · +${divisions * 25} coins`,
        );
      else if (xp > 0) setEarned(`+${xp} practice XP`);
      else if (xp < 0) setEarned(null);
    }
    current.current = next;
    setSnapshot(next);
    setError(null);
    document.documentElement.dataset.studioTheme = next.equipped.theme;
  }, []);

  const refresh = useCallback(async () => {
    if (mutation.current) {
      refreshQueued.current = true;
      return;
    }
    const request = ++generation.current;
    try {
      const next = await studioSnapshot();
      if (alive.current && request === generation.current) accept(next, true);
    } catch (reason) {
      if (alive.current && request === generation.current)
        setError(errorMessage(reason));
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, [accept]);

  const mutate = useCallback(
    async (
      operation: (revision: number) => Promise<StudioSnapshot>,
      success: string,
    ) => {
      if (mutation.current || !current.current) return false;
      mutation.current = true;
      generation.current++;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const next = await operation(current.current.revision);
        if (!alive.current) return false;
        accept(next, false);
        setMessage(success);
        return true;
      } catch (reason) {
        if (alive.current) setError(errorMessage(reason));
        return false;
      } finally {
        mutation.current = false;
        if (alive.current) {
          setBusy(false);
          if (refreshQueued.current) {
            refreshQueued.current = false;
            void refresh();
          }
        }
      }
    },
    [accept, refresh],
  );

  useEffect(() => {
    alive.current = true;
    let subscribed = true;
    let timer: number | undefined;
    const cleanup: (() => void)[] = [];
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 700);
    };
    for (const event of ["rep://state", "session://event"]) {
      void listen(event, schedule)
        .then((un) => {
          if (subscribed) cleanup.push(un);
          else un();
        })
        .catch(() => undefined);
    }
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      subscribed = false;
      alive.current = false;
      generation.current++;
      window.clearTimeout(timer);
      cleanup.forEach((un) => un());
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    if (!earned) return;
    const timer = window.setTimeout(() => setEarned(null), 9000);
    return () => window.clearTimeout(timer);
  }, [earned]);

  return (
    <StudioContext.Provider
      value={{
        snapshot,
        error,
        loading,
        earned,
        refresh,
        mutate,
        busy,
        message,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("StudioProvider is required");
  return value;
}

export function StudioNavProgress() {
  const { snapshot, earned } = useStudio();
  if (!snapshot) return null;
  return (
    <div className="studio-nav-progress" aria-label="Studio progress">
      <span>
        {snapshot.progress.rank_name} {snapshot.progress.division}
        <span>{snapshot.wallet.balance} ◈</span>
      </span>
      <progress
        aria-label="Current rank division"
        value={snapshot.progress.division_xp}
        max={snapshot.progress.division_xp_required}
      />
      <small role="status" aria-live="polite">
        {earned ??
          `${snapshot.progress.division_xp} / ${snapshot.progress.division_xp_required} XP`}
      </small>
    </div>
  );
}
