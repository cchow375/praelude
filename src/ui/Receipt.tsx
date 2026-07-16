import type { ReactNode } from "react";
import "./ui.css";

export type ReceiptStatus = "success" | "error";

export interface ReceiptProps {
  status: ReceiptStatus;
  message: ReactNode;
}

/**
 * The save-receipt element. The ONE place chrome carries colour, and only the
 * two semantic signals (--signal-success / --signal-error) — never a brand hue.
 * Lands with a fast micro-motion (ui.css) so a write is visibly acknowledged.
 */
export function Receipt({ status, message }: ReceiptProps) {
  return (
    <div
      className={`ck-receipt ck-receipt-${status}`}
      data-status={status}
      role={status === "error" ? "alert" : "status"}
    >
      <span className="ck-receipt-dot" aria-hidden="true" />
      <span className="ck-receipt-message">{message}</span>
    </div>
  );
}
