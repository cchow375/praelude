import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { commandErrorMessage } from "../../services/command";
import "./ReceiptCenter.css";

export type ReceiptKind = "committed" | "undone" | "error";

export interface AppReceipt {
  id: number;
  kind: ReceiptKind;
  message: string;
}

export interface ReceiptPublisher {
  committed: (message: string) => number;
  undone: (message: string) => number;
  error: (cause: unknown, fallbackMessage?: string) => number;
  dismiss: (id: number) => void;
}

let nextReceiptId = 1;
const MAX_VISIBLE_RECEIPTS = 5;

const NOOP_PUBLISHER: ReceiptPublisher = {
  committed: () => -1,
  undone: () => -1,
  error: () => -1,
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

  const publish = useCallback((kind: ReceiptKind, rawMessage: string) => {
    const message = rawMessage.trim() || "The action completed.";
    const receipt = { id: nextReceiptId++, kind, message };
    setReceipts((current) => [receipt, ...current].slice(0, MAX_VISIBLE_RECEIPTS));
    if (kind === "error") setAssertiveAnnouncement(message);
    else setPoliteAnnouncement(message);
    return receipt.id;
  }, []);

  const publisher = useMemo<ReceiptPublisher>(() => ({
    committed: (message) => publish("committed", message),
    undone: (message) => publish("undone", message),
    error: (cause, fallbackMessage) => publish(
      "error",
      commandErrorMessage(cause, fallbackMessage),
    ),
    dismiss: (id) => setReceipts((current) => (
      current.filter((receipt) => receipt.id !== id)
    )),
  }), [publish]);

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
            >
              <span className="receipt-mark" aria-hidden="true">
                {receipt.kind === "committed"
                  ? "✓"
                  : receipt.kind === "undone"
                    ? "↶"
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
