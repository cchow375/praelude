import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// B4 text-fitting contract. The shared .ck-fit utility must be applied to every
// surface that used to cram/clip long titles — History (Ledger) rows, piece
// selection rows/cards, and Today candidate cards — with .ck-fit-reveal on the
// row/card so the full title is recoverable on hover/focus. jsdom applies no
// CSS, so these tests pin the markup contract (which classes land where); the
// visual clamp/reveal itself is verified in the browser pass.

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { LedgerWorkspace } from "../features/ledger/LedgerWorkspace";
import { PiecesPanel } from "../features/pieces/PiecesPanel";
import { SessionComposer } from "../features/composer/SessionComposer";
import type { ComposerCandidate } from "../features/composer/domain";

const LONG_TITLE =
  "Rhapsody on a Theme of Paganini (Variations XVIII–XXIV) — complete concert edition";
const LONG_COMPOSER = "Sergei Vasilievich Rachmaninoff, arr. for solo piano";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "pieces_list" || command === "pieces_scan")
      return Promise.resolve([
        {
          id: 1,
          title: LONG_TITLE,
          composer: LONG_COMPOSER,
          has_xml: true,
          has_pdf: true,
          intake_done: true,
        },
      ]);
    if (command === "region_list" || command === "rep_blocks_for_piece")
      return Promise.resolve([]);
    if (command === "progress_summary")
      return Promise.resolve({ per_region_mastery: [] });
    return Promise.resolve(null);
  });
});

afterEach(cleanup);

describe("Ledger rows fit long titles (.ck-fit)", () => {
  it("clamps the piece title + composer and reveals the full row on hover/focus", async () => {
    const { container } = render(<LedgerWorkspace />);
    await waitFor(() =>
      expect(
        container.querySelector(".ledger-piece-index button strong"),
      ).not.toBeNull(),
    );

    const title = container.querySelector(".ledger-piece-index button strong");
    expect(title?.textContent).toBe(LONG_TITLE);
    expect(title?.className).toContain("ck-fit");

    const composer = container.querySelector(
      ".ledger-piece-index button small",
    );
    expect(composer?.className).toContain("ck-fit");

    // The interactive row is the reveal trigger.
    expect(title?.closest("button")?.className).toContain("ck-fit-reveal");
  });
});

describe("Piece-selection cards fit long titles (.ck-fit)", () => {
  it("clamps the piece-row title + composer and reveals the full card on hover/focus", async () => {
    const { container } = render(<PiecesPanel onOpenBlock={async () => {}} />);
    await waitFor(() =>
      expect(container.querySelector(".piece-row-title")).not.toBeNull(),
    );

    const title = container.querySelector(".piece-row-title");
    expect(title?.textContent).toBe(LONG_TITLE);
    expect(title?.className).toContain("ck-fit");

    const composer = container.querySelector(".piece-row-composer");
    expect(composer?.className).toContain("ck-fit");

    expect(title?.closest("button.piece-row")?.className).toContain(
      "ck-fit-reveal",
    );
  });
});

describe("Today candidate cards fit long titles (.ck-fit)", () => {
  const candidate: ComposerCandidate = {
    id: "retention-1",
    piece_ref: "piece-rach",
    target_ref: "target-long",
    kind: "due_retention",
    due_on: "2026-07-15",
    priority: 90,
    estimated_minutes: 10,
    piece_label: LONG_COMPOSER,
    target_label: LONG_TITLE,
    evidence: [
      {
        evidence_id: "e1",
        evidence_type: "retention_due",
        source_ref: { source_type: "retention_check", source_id: "c1" },
      },
    ],
  };

  it("clamps the candidate title + piece line and reveals the full card on hover/focus", () => {
    const { container } = render(
      <SessionComposer candidates={[candidate]} onStartSession={() => {}} />,
    );

    const heading = screen.getByRole("heading", { name: LONG_TITLE });
    expect(heading.tagName).toBe("H3");
    expect(heading.className).toContain("ck-fit");

    const pieceLine = container.querySelector(
      ".session-composer__item-heading p",
    );
    expect(pieceLine?.textContent).toBe(LONG_COMPOSER);
    expect(pieceLine?.className).toContain("ck-fit");

    expect(heading.closest("li")?.className).toContain("ck-fit-reveal");
  });
});
