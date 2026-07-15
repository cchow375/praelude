import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReceiptCenterProvider, useReceipts } from "./ReceiptCenter";

function Harness() {
  const receipts = useReceipts();
  return (
    <div>
      <button onClick={() => receipts.committed("Practice block opened.")}>
        Commit
      </button>
      <button onClick={() => receipts.undone("Last attempt undone.")}>
        Undo
      </button>
      <button onClick={() => receipts.error(
        { code: "db_busy", message: "Practice could not be saved." },
        "Save failed.",
      )}>
        Fail
      </button>
    </div>
  );
}

afterEach(cleanup);

describe("ReceiptCenter", () => {
  it("announces committed and undone receipts politely", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);
    const polite = screen.getByRole("status");

    expect(polite.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(polite.textContent).toBe("Practice block opened.");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(polite.textContent).toBe("Last attempt undone.");
    expect(screen.getByRole("region", { name: "Receipt center" })).toBeTruthy();
  });

  it("announces errors assertively and keeps them visibly dismissible", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Fail" }));

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toBe("Practice could not be saved.");

    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getByText("Practice could not be saved.")).toBeTruthy();
    fireEvent.click(within(activity).getByRole("button", {
      name: "Dismiss error receipt: Practice could not be saved.",
    }));
    expect(screen.queryByRole("list", { name: "Recent app activity" })).toBeNull();
  });
});
