import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
  type ReactNode,
  useRef,
} from "react";
import { commandErrorMessage } from "../../services/command";
import "./ReceiptCenter.css";

export type ReceiptKind = "committed" | "undone" | "error" | "confirmation" | "duplicate";

/** Mirrors the durable native mutation envelope. */
export interface MutationReceipt<T = unknown> {
  receipt_id: string;
  command_id: string;
  status: "committed" | "rejected" | "confirmation_required";
  summary: string;
  value?: T | null;
  entity_refs: Array<{ entity_type: string; entity_id: number }>;
  event_ids: number[];
  undo_action?: string | null;
  error_code?: string | null;
  error_detail?: string | null;
  replayed: boolean;
  committed_ts: string | null;
}

export interface AppReceipt {
  id: number;
  kind: ReceiptKind;
  message: string;
  durableReceiptId?: string;
}

export interface ReceiptPublisher {
  committed: (message: string) => number;
  undone: (message: string) => number;
  error: (cause: unknown, fallbackMessage?: string) => number;
  mutation: (receipt: MutationReceipt) => number;
  dismiss: (id: number) => void;
}

let nextReceiptId = 1;
const MAX_VISIBLE_RECEIPTS = 5;
const ROUTINE_RECEIPT_MS = 1_500;

function autoDismisses(kind: ReceiptKind): boolean {
  return kind === "committed" || kind === "undone" || kind === "duplicate";
}

const NOOP_PUBLISHER: ReceiptPublisher = {
  committed: () => -1,
  undone: () => -1,
  error: () => -1,
  mutation: () => -1,
  dismiss: () => undefined,
};

const ReceiptContext = createContext<ReceiptPublisher>(NOOP_PUBLISHER);

export function useReceipts(): ReceiptPublisher {
  return useContext(ReceiptContext);
}

export function ReceiptCenterProvider({ children }: { children: ReactNode }) {
  const [receipts, setReceipts] = useState<AppReceipt[]>([]);
  const [politeAnnouncement, setPoliteAnnouncement] = useState("");
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
  const committedDurableIds = useRef(new Set<string>());
  const dismissTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = dismissTimers.current.get(id);
    if (timer != null) clearTimeout(timer);
    dismissTimers.current.delete(id);
    setReceipts((current) => current.filter((receipt) => receipt.id !== id));
  }, []);

  useEffect(() => () => {
    for (const timer of dismissTimers.current.values()) clearTimeout(timer);
    dismissTimers.current.clear();
  }, []);

  const publish = useCallback((kind: ReceiptKind, rawMessage: string, durableReceiptId?: string) => {
    const message = rawMessage.trim() || "The action completed.";
    const receipt = { id: nextReceiptId++, kind, message, durableReceiptId };
    setReceipts((current) => [receipt, ...current].slice(0, MAX_VISIBLE_RECEIPTS));
    if (kind === "error") setAssertiveAnnouncement(message);
    else setPoliteAnnouncement(message);
    if (autoDismisses(kind)) {
      const timer = setTimeout(() => dismiss(receipt.id), ROUTINE_RECEIPT_MS);
      dismissTimers.current.set(receipt.id, timer);
    }
    return receipt.id;
  }, [dismiss]);

  const publisher = useMemo<ReceiptPublisher>(() => ({
    committed: (message) => publish("committed", message),
    undone: (message) => publish("undone", message),
    error: (cause, fallbackMessage) => publish(
      "error",
      commandErrorMessage(cause, fallbackMessage),
    ),
    mutation: (receipt) => {
      if (receipt.status === "rejected") {
        return publish(
          "error",
          receipt.error_detail?.trim() || receipt.summary,
          receipt.receipt_id,
        );
      }
      if (receipt.status === "confirmation_required") {
        return publish("confirmation", receipt.summary, receipt.receipt_id);
      }
      // Native receipts intentionally omit internal retry metadata. The
      // durable receipt id is enough to distinguish a replay from a second
      // write across every caller, including older frontend integrations.
      const replayed = receipt.replayed === true
        || committedDurableIds.current.has(receipt.receipt_id);
      committedDurableIds.current.add(receipt.receipt_id);
      return publish(
        replayed ? "duplicate" : "committed",
        replayed
          ? `${receipt.summary} Already applied; no second write was made.`
          : receipt.summary,
        receipt.receipt_id,
      );
    },
    dismiss,
  }), [dismiss, publish]);

  return (
    <ReceiptContext.Provider value={publisher}>
      {children}
      <ReceiptCenter
        receipts={receipts}
        politeAnnouncement={politeAnnouncement}
        assertiveAnnouncement={assertiveAnnouncement}
        onDismiss={publisher.dismiss}
      />
    </ReceiptContext.Provider>
  );
}

function ReceiptCenter({
  receipts,
  politeAnnouncement,
  assertiveAnnouncement,
  onDismiss,
}: {
  receipts: AppReceipt[];
  politeAnnouncement: string;
  assertiveAnnouncement: string;
  onDismiss: (id: number) => void;
}) {
  return (
    <section className="receipt-center" aria-label="Receipt center">
      <div
        className="receipt-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {politeAnnouncement}
      </div>
      <div
        className="receipt-live"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {assertiveAnnouncement}
      </div>

      {receipts.length > 0 && (
        <ol className="receipt-list" aria-label="Recent app activity">
          {receipts.map((receipt) => (
            <li
              key={receipt.id}
              className="receipt-item"
              data-kind={receipt.kind}
              data-receipt-id={receipt.durableReceiptId}
            >
              <span className="receipt-mark" aria-hidden="true">
                {receipt.kind === "committed"
                  ? "✓"
                  : receipt.kind === "undone"
                    ? "↶"
                    : receipt.kind === "duplicate"
                      ? "="
                      : receipt.kind === "confirmation"
                        ? "?"
                        : "!"}
              </span>
              <span className="receipt-message">{receipt.message}</span>
              <button
                type="button"
                className="receipt-dismiss"
                aria-label={`Dismiss ${receipt.kind} receipt: ${receipt.message}`}
                onClick={() => onDismiss(receipt.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
