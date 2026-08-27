import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
import { RegionEditor, TrickySectionsPanel } from "./RegionEditor";
import type { Region } from "./types";

afterEach(cleanup);
const region: Region = {
  id: 1,
  piece_id: 2,
  name: "legato",
  notes: "Shape the phrase",
  m_start: 1,
  m_end: 16,
  kind: "section",
  order: 0,
  color: null,
  pdf_anchor: null,
};
const other: Region = {
  ...region,
  id: 2,
  name: "coda",
  m_start: 17,
  m_end: 24,
};

describe("RegionEditor", () => {
  beforeEach(() => invokeMock.mockReset().mockResolvedValue(region));

  it("saves the canonical title, Sound target, and measures in one region_update", async () => {
    render(
      <RegionEditor
        region={region}
        regions={[region, other]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Edit title, notes, measures or color"));
    fireEvent.change(screen.getByLabelText("Tricky section title"), {
      target: { value: "bridge" },
    });
    fireEvent.change(screen.getByLabelText("Tricky section sound target"), {
      target: { value: "Read ahead" },
    });
    fireEvent.change(screen.getByLabelText("Tricky section start measure"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Tricky section end measure"), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByText("Save section"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_update", {
        id: 1,
        patch: { name: "bridge", notes: "Read ahead", m_start: 3, m_end: 18 },
      }),
    );
  });

  it("merges the current region into the chosen target", async () => {
    render(
      <RegionEditor
        region={region}
        regions={[region, other]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Edit title, notes, measures or color"));
    fireEvent.click(screen.getByText("Advanced section tools"));
    fireEvent.change(screen.getByLabelText("Merge target"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByText("Merge"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_merge", {
        idKeep: 2,
        idAbsorb: 1,
      }),
    );
  });

  it("confirms and sends one atomic region_split command", async () => {
    const anchored = { ...region, pdf_anchor: { v: 1, editions: {} } };
    render(
      <RegionEditor
        region={anchored}
        regions={[anchored, other]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Edit title, notes, measures or color"));
    fireEvent.click(screen.getByText("Advanced section tools"));
    fireEvent.change(screen.getByLabelText("Split measure"), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByText("Split"));
    expect(
      screen.getByText(/All score boxes, highlights, and notes/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_split", {
        id: 1,
        splitAt: 9,
      }),
    );
  });

  it("keeps a valid 146-character imported header editable", async () => {
    const longRegion = { ...region, name: "Read ahead ".repeat(13).trim() };
    expect(longRegion.name.length).toBeGreaterThan(120);
    render(
      <RegionEditor
        region={longRegion}
        regions={[longRegion]}
        alwaysOpen
        onChanged={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Tricky section sound target"), {
      target: { value: "New cue" },
    });
    fireEvent.click(screen.getByText("Save section"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_update", {
        id: 1,
        patch: {
          name: longRegion.name,
          notes: "New cue",
          m_start: 1,
          m_end: 16,
        },
      }),
    );
  });

  it("sends null when the Sound target is deliberately cleared", async () => {
    render(
      <RegionEditor
        region={region}
        regions={[region]}
        alwaysOpen
        onChanged={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Tricky section sound target"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save section"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_update", {
        id: 1,
        patch: { name: "legato", notes: null, m_start: 1, m_end: 16 },
      }),
    );
  });

  it("Task C5: deletes a childless region with the plain single-Confirm flow, mode cascade", async () => {
    render(
      <RegionEditor
        region={region}
        regions={[region, other]}
        alwaysOpen
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Delete tricky section"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_delete", {
        id: 1,
        mode: "cascade",
      }),
    );
  });

  it("Task C5: offers cascade vs promote when the region has children, and each routes to the matching mode", async () => {
    const child: Region = {
      ...region,
      id: 5,
      name: "sticky run",
      parent_region_id: 1,
    };
    render(
      <RegionEditor
        region={region}
        regions={[region, other, child]}
        alwaysOpen
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Delete tricky section"));
    expect(
      screen.getByRole("button", { name: "Promote sub-sections" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete with sub-sections" }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_delete", {
        id: 1,
        mode: "cascade",
      }),
    );
  });

  it("Task C5: promote choice sends mode promote", async () => {
    const child: Region = {
      ...region,
      id: 5,
      name: "sticky run",
      parent_region_id: 1,
    };
    render(
      <RegionEditor
        region={region}
        regions={[region, other, child]}
        alwaysOpen
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Delete tricky section"));
    fireEvent.click(
      screen.getByRole("button", { name: "Promote sub-sections" }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_delete", {
        id: 1,
        mode: "promote",
      }),
    );
  });

  it("Task C5: TrickySectionsPanel pre-fills the create form from initialDraft (still editable) and threads parent_region_id", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_list") return Promise.resolve([region]);
      if (command === "rep_blocks_for_piece") return Promise.resolve([]);
      if (command === "region_create")
        return Promise.resolve({ ...region, id: 42 });
      return Promise.resolve(undefined);
    });
    render(
      <TrickySectionsPanel
        pieceId={2}
        initialDraft={{ start: 10, end: 14, parentRegionId: 1 }}
      />,
    );
    await screen.findByText("legato");
    const startInput = screen.getByLabelText(
      "New tricky section start measure",
    ) as HTMLInputElement;
    const endInput = screen.getByLabelText(
      "New tricky section end measure",
    ) as HTMLInputElement;
    expect(startInput.value).toBe("10");
    expect(endInput.value).toBe("14");
    // Still fully editable — the unmapped-fallback path stays intact.
    fireEvent.change(startInput, { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("New tricky section title"), {
      target: { value: "Sticky run" },
    });
    fireEvent.click(screen.getByText("Create section"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_create", {
        args: {
          piece_id: 2,
          name: "Sticky run",
          notes: null,
          m_start: 11,
          m_end: 14,
          kind: "hard_spot",
        },
        parent_region_id: 1,
      }),
    );
  });

  it("Task C5: shows a sub-sections badge on a parent card in the Details list", async () => {
    const child: Region = {
      ...region,
      id: 9,
      name: "child",
      parent_region_id: 1,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_list") return Promise.resolve([region, child]);
      if (command === "rep_blocks_for_piece") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    render(<TrickySectionsPanel pieceId={2} />);
    await screen.findByText("legato");
    expect(screen.getByText("1 sub-section")).toBeTruthy();
  });

  it("shows Details tricky sections in the same measure order as Score", async () => {
    const later = { ...region, id: 7, name: "Later", m_start: 65, m_end: 80 };
    const earlier = { ...region, id: 8, name: "Earlier", m_start: 2, m_end: 8 };
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_list") return Promise.resolve([later, earlier]);
      if (command === "rep_blocks_for_piece") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { container } = render(<TrickySectionsPanel pieceId={2} />);
    await screen.findByText("Earlier");
    expect(
      [...container.querySelectorAll(".tricky-section-card strong")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Earlier", "Later"]);
  });

  it("groups anchored sections under PDF movements and keeps unmapped work visible", async () => {
    const anchored = {
      ...region,
      id: 12,
      name: "Second movement color",
      pdf_anchor: {
        v: 1 as const,
        editions: {
          urtext: {
            fingerprint: "fp",
            rects: [{ page: 8, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
          },
        },
      },
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_list") return Promise.resolve([region, anchored]);
      if (command === "rep_blocks_for_piece") return Promise.resolve([]);
      if (command === "piece_movement_list")
        return Promise.resolve([
          { id: 1, piece_id: 2, title: "I", start_page: 1, display_order: 0 },
          { id: 2, piece_id: 2, title: "II", start_page: 7, display_order: 1 },
        ]);
      return Promise.resolve(undefined);
    });

    const { container } = render(<TrickySectionsPanel pieceId={2} />);

    await screen.findByText("Second movement color");
    expect(
      [...container.querySelectorAll(".tricky-section-movement h4")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["I", "II", "Not mapped to a movement"]);
    const groups = container.querySelectorAll(".tricky-section-movement");
    expect(groups[0].textContent).toContain("No anchored sections");
    expect(groups[1].textContent).toContain("Second movement color");
    expect(groups[2].textContent).toContain("legato");
  });
});

// B4: at the 720x520 floor, `.region-canonical-fields` is a 2-column grid
// (`minmax(0, 1fr) minmax(0, 1fr)`) with `.region-measure-fields` in column 1
// and the "Save section" button in column 2. `.region-measure-fields` is a
// non-wrapping flex row with two `width: 5rem` inputs (~170px minimum), which
// does not fit in a narrow first column, so it overflows into column 2 and
// visually overlaps "Save section".
//
// jsdom has no layout engine (and this project's vitest config does not load
// stylesheets into jsdom's CSSOM), so a getComputedStyle/geometry assertion
// here would pass vacuously regardless of the real CSS. Per the repo's
// "jsdom green != app works" lesson, this test instead pins the contract by
// reading the actual stylesheet source and asserting on the rules that cause
// (before the fix) and prevent (after the fix) the overlap. The real pixel
// proof is the before/after 720x520 screenshot, not this test.
describe("Pieces.css region editor layout (B4 720x520 overlap)", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/pieces/Pieces.css"),
    "utf8",
  );

  function rule(selector: string): string {
    const escaped = selector.replace(/[.]/g, "\\.");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
    if (!match) throw new Error(`No CSS rule found for ${selector}`);
    return match[1];
  }

  it("lets the canonical-fields grid collapse instead of forcing two rigid columns", () => {
    const body = rule(".region-canonical-fields");
    // Before the fix: `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);`
    // permits each column to shrink below its content's intrinsic width,
    // which is exactly what lets the measure row spill into the Save column.
    expect(body).not.toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/,
    );
    // After the fix: an auto-fit template collapses to a single column when
    // the container is narrower than one field can hold.
    expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit,/);
  });

  it("allows the measure-fields row to wrap onto a second line", () => {
    const body = rule(".region-measure-fields");
    expect(body).toMatch(/flex-wrap:\s*wrap/);
  });

  it("lets the measure inputs shrink instead of holding a fixed width", () => {
    const body = rule(".region-measure-fields input");
    // Before the fix: `width: 5rem;` is an unshrinkable floor — two of them
    // plus the gap need ~170px regardless of how narrow the column is.
    expect(body).not.toMatch(/(?<!max-)width:\s*5rem/);
  });
});
