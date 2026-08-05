import { useCallback, useEffect, useRef, useState } from "react";
import { commandErrorMessage } from "../../services/command";
import { useReceipts } from "../receipts/ReceiptCenter";

// Shared autosave core for the two notebook documents (the day sheet and a
// piece plan). Both edit one value locally, debounce persistence (~600ms),
// flush immediately on blur/unmount, RECONCILE the editor from the canonical
// value the save returns, and surface honest load/save errors + save receipts.
//
// Concurrency the tests pin down:
//  - An edit made while a save is in flight is never clobbered by that save's
//    canonical echo (an edit-sequence guard skips the stale reconcile; a later
//    debounced save reconciles instead).
//  - Switching `key` (a new date / piece) flushes the OUTGOING document with its
//    own save handle before loading the new one, so a pending edit is never
//    written under the wrong key.
//  - A load that resolves after `key` changed (or after unmount) is discarded.

export type DocumentStatus = "loading" | "ready" | "error";

export interface LoadedDocument<E> {
  value: E;
  updatedAt: string | null;
}

export interface AutosaveConfig<E> {
  /** Identity of the document; changing it reloads and flushes the previous one. */
  key: string | number;
  /** Fetch the document (may migrate/seed); null → a blank document. */
  load: () => Promise<LoadedDocument<E> | null>;
  /** Persist; resolves with the CANONICAL stored value to reconcile against. */
  save: (value: E) => Promise<LoadedDocument<E>>;
  /** Editor value before load resolves and when load returns null. */
  empty: E;
  /** Terse committed-receipt copy on a durable save. */
  savedMessage: string;
  loadErrorFallback: string;
  saveErrorFallback: string;
  debounceMs?: number;
}

export interface AutosavedDocument<E> {
  value: E;
  setValue: (next: E | ((prev: E) => E)) => void;
  status: DocumentStatus;
  error: string | null;
  saving: boolean;
  updatedAt: string | null;
  /** Persist any pending edit immediately (blur handler). */
  flush: () => void;
}

const DEFAULT_DEBOUNCE_MS = 600;

export function useAutosavedDocument<E>(
  config: AutosaveConfig<E>,
): AutosavedDocument<E> {
  const receipts = useReceipts();
  const [value, setValueState] = useState<E>(config.empty);
  const [status, setStatus] = useState<DocumentStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const mountedRef = useRef(true);
  const valueRef = useRef<E>(config.empty);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const rerunRef = useRef(false);
  const editSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Persistence handles for the CURRENT key epoch, captured when a key loads so
  // an outgoing flush (key change / unmount) saves the old document correctly.
  const outgoingRef = useRef({
    save: config.save,
    savedMessage: config.savedMessage,
    saveErrorFallback: config.saveErrorFallback,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSave = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current) {
      if (savingRef.current) rerunRef.current = true;
      return;
    }
    const cfg = configRef.current;
    const keyAtSend = cfg.key;
    const seqAtSend = editSeqRef.current;
    const bodyAtSend = valueRef.current;
    dirtyRef.current = false;
    savingRef.current = true;
    if (mountedRef.current) setSaving(true);
    try {
      const saved = await cfg.save(bodyAtSend);
      const sameDoc = mountedRef.current && configRef.current.key === keyAtSend;
      if (sameDoc) {
        setUpdatedAt(saved.updatedAt);
        setError(null);
        setStatus("ready");
        // Reconcile from canonical ONLY when nothing was typed since we sent,
        // so a keystroke landing mid-save is never overwritten.
        if (editSeqRef.current === seqAtSend) {
          valueRef.current = saved.value;
          setValueState(saved.value);
        }
      }
      receipts.committed(cfg.savedMessage);
    } catch (cause) {
      dirtyRef.current = true; // keep the edit; a later flush/edit retries
      const message = commandErrorMessage(cause, cfg.saveErrorFallback);
      if (mountedRef.current && configRef.current.key === keyAtSend) {
        setError(message);
        setStatus("error");
      }
      receipts.error(cause, message);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
      if (rerunRef.current) {
        rerunRef.current = false;
        void runSave();
      }
    }
  }, [receipts]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const ms = configRef.current.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void runSave();
    }, ms);
  }, [runSave]);

  const setValue = useCallback(
    (next: E | ((prev: E) => E)) => {
      editSeqRef.current += 1;
      dirtyRef.current = true;
      setValueState((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: E) => E)(prev) : next;
        valueRef.current = resolved;
        return resolved;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (!dirtyRef.current) return;
    if (savingRef.current) {
      // A save is already in flight: cancelling the debounce timer above is
      // not enough on its own — without this flag, the edit sitting in
      // `valueRef` right now would never get persisted (nothing else is
      // scheduled to look at it again). Mark it for the in-flight save's
      // finally-block rerun, the same mechanism `scheduleSave` relies on, so
      // it's picked up the instant the current save settles.
      rerunRef.current = true;
      return;
    }
    void runSave();
  }, [runSave]);

  const key = config.key;
  useEffect(() => {
    const cfg = configRef.current;
    outgoingRef.current = {
      save: cfg.save,
      savedMessage: cfg.savedMessage,
      saveErrorFallback: cfg.saveErrorFallback,
    };
    const loadId = ++loadSeqRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    dirtyRef.current = false;
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        const loaded = await cfg.load();
        if (loadSeqRef.current !== loadId || !mountedRef.current) return;
        const nextValue = loaded ? loaded.value : cfg.empty;
        valueRef.current = nextValue;
        setValueState(nextValue);
        setUpdatedAt(loaded ? loaded.updatedAt : null);
        setStatus("ready");
      } catch (cause) {
        if (loadSeqRef.current !== loadId || !mountedRef.current) return;
        setError(commandErrorMessage(cause, cfg.loadErrorFallback));
        setStatus("error");
      }
    })();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      // Persist the outgoing document with ITS handle before the key switches.
      if (dirtyRef.current && !savingRef.current) {
        const outgoing = outgoingRef.current;
        dirtyRef.current = false;
        outgoing.save(valueRef.current).then(
          () => receipts.committed(outgoing.savedMessage),
          (cause) => receipts.error(cause, outgoing.saveErrorFallback),
        );
      }
    };
  }, [key, receipts]);

  return { value, setValue, status, error, saving, updatedAt, flush };
}
