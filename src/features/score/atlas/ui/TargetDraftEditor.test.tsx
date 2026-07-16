import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exactCompatibleMapping,
  unknownMapping,
} from "../draft";
import type {
  AtomicTargetSavePayload,
} from "../savePayload";
import type {
  MappingCandidate,
  TargetMappingState,
} from "../model";
import { TargetDraftEditor, type TargetDraftEditorProps } from "./TargetDraftEditor";

afterEach(cleanup);

const edition = { edition_id: "score.pdf", edition_fingerprint: "pdf-fp" };

function exact(): TargetMappingState {
  const result = exactCompatibleMapping(
    { m_start: 40, m_end: 44 },
    {
      edition_fingerprint: "pdf-fp",
      xml_fingerprint: "xml-fp",
      compatibility_id: "compat-1",
      verified_at: "2026-07-15T12:00:00Z",
      rationale: "The PDF and MusicXML are the same engraved edition.",
    },
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function calibratedCandidate(confidence = 0.82): MappingCandidate {
  return {
    edition_fingerprint: "pdf-fp",
    xml_fingerprint: "xml-fp",
    candidate_range: { m_start: 40, m_end: 44 },
    confidence,
    rationale: "Bounded by calibration points A and B.",
    calibration_point_ids: ["A", "B"],
    authoritative: false,
  };
}

function renderEditor(overrides: Partial<TargetDraftEditorProps> = {}) {
  const onSave = vi.fn<(payload: AtomicTargetSavePayload) => void>();
  const onCancel = vi.fn<() => void>();
  const saveHandler = (payload: AtomicTargetSavePayload) => {
    onSave(payload);
    return overrides.onSave?.(payload);
  };
  const cancelHandler = () => {
    onCancel();
    overrides.onCancel?.();
  };
  render(
    <TargetDraftEditor
      draftId="draft-1"
      pieceId={7}
      edition={edition}
      pageNumber={3}
      minimumCandidateConfidence={0.7}
      resolveMapping={() => exact()}
      geometryForEvent={() => ({ page: 3, left: 0, top: 0, width: 1000, height: 800 })}
      createConfirmationIdentity={() => ({
        confirmation_id: "confirm-1",
        confirmed_at: "2026-07-15T12:30:00Z",
      })}
      {...overrides}
      onSave={saveHandler}
      onCancel={cancelHandler}
    />,
  );
  return { onSave, onCancel };
}

function dragTarget() {
  const overlay = screen.getByTestId("atlas-target-overlay-3");
  fireEvent.pointerDown(overlay, {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 160,
  });
  fireEvent.pointerUp(overlay, {
    pointerId: 1,
    clientX: 400,
    clientY: 320,
  });
}

function disabled(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled;
}

describe("TargetDraftEditor", () => {
  it("creates a visible exact draft immediately but never saves before review confirmation", () => {
    const { onSave } = renderEditor();
    dragTarget();

    expect(screen.getByTestId("atlas-target-selection")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Exact score match");
    const save = screen.getByRole("button", { name: "Save target" });
    expect(disabled(save)).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm exact range" }));
    expect(disabled(save)).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      piece_id: 7,
      asserted_measure_range: { m_start: 40, m_end: 44 },
      mapping_evidence: { status: "exact_compatible" },
      anchor: {
        edition_fingerprint: "pdf-fp",
        rects: [{ page: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.2 }],
      },
    });
  });

  it("lets the user correct a calibrated candidate, then records explicit confirmation", () => {
    const { onSave } = renderEditor({
      resolveMapping: () => unknownMapping(
        "Review the bounded calibration candidate.",
        calibratedCandidate(),
      ),
    });
    dragTarget();
    expect(screen.getByRole("status").textContent).toContain("Calibration candidate");
    expect(disabled(screen.getByRole("button", { name: "Save target" }))).toBe(true);

    fireEvent.change(screen.getByLabelText("Candidate start measure"), {
      target: { value: "41" },
    });
    fireEvent.change(screen.getByLabelText("Candidate end measure"), {
      target: { value: "43" },
    });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm corrected range" }));

    expect(screen.getByRole("status").textContent).toContain("Mapping confirmed");
    const save = screen.getByRole("button", { name: "Save target" });
    expect(disabled(save)).toBe(false);
    fireEvent.click(save);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      asserted_measure_range: { m_start: 41, m_end: 43 },
      mapping_evidence: {
        status: "calibrated_user_confirmed",
        evidence: {
          candidate_range: { m_start: 40, m_end: 44 },
          confirmation_id: "confirm-1",
          confirmed_by: "user",
        },
      },
    });
  });

  it("blocks unknown and below-policy candidates from authoritative save", () => {
    const unknownSave = vi.fn();
    renderEditor({
      onSave: unknownSave,
      resolveMapping: () => unknownMapping("This scan has no defensible range."),
    });
    dragTarget();
    expect(screen.getByRole("status").textContent).toContain("Location only");
    expect(disabled(screen.getByRole("button", { name: "Mapping required" }))).toBe(true);
    expect(disabled(screen.getByRole("button", { name: "Save target" }))).toBe(true);
    expect(unknownSave).not.toHaveBeenCalled();

    cleanup();
    const lowSave = vi.fn();
    renderEditor({
      onSave: lowSave,
      resolveMapping: () => unknownMapping(
        "The candidate is below product confidence policy.",
        calibratedCandidate(0.35),
      ),
    });
    dragTarget();
    expect(screen.getByRole("status").textContent).toContain("Low-confidence candidate");
    expect((screen.getByLabelText("Candidate start measure") as HTMLInputElement).readOnly).toBe(true);
    expect(disabled(screen.getByRole("button", { name: "More calibration required" }))).toBe(true);
    expect(disabled(screen.getByRole("button", { name: "Save target" }))).toBe(true);
    expect(lowSave).not.toHaveBeenCalled();
  });

  it("provides a keyboard-only numeric geometry path with accessible names", () => {
    const { onSave } = renderEditor();
    const overlay = screen.getByRole("region", {
      name: "Draw a practice target on PDF page 3",
    });
    expect(overlay.tabIndex).toBe(0);
    expect(overlay.getAttribute("aria-describedby")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Selection left percent"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Selection top percent"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Selection width percent"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Selection height percent"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use numeric selection" }));
    expect(screen.getByTestId("atlas-target-selection")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Target title"), {
      target: { value: "Coda landing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm exact range" }));
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "Coda landing",
      anchor: {
        rects: [{ page: 3, x: 0.25, y: 0.3, w: 0.2, h: 0.1 }],
      },
    });
  });

  it("reports rejected drag geometry in an assertive live error", () => {
    renderEditor();
    const overlay = screen.getByTestId("atlas-target-overlay-3");
    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(overlay, {
      pointerId: 1,
      clientX: 11,
      clientY: 11,
    });
    expect(screen.getByRole("alert").textContent).toContain("visible score area");
    expect(screen.queryByTestId("atlas-target-selection")).toBeNull();
  });

  it("supports reset and cancel without leaking a stale selection", () => {
    const { onCancel } = renderEditor();
    dragTarget();
    fireEvent.click(screen.getByRole("button", { name: "Reset draft" }));
    expect(screen.queryByTestId("atlas-target-selection")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Location only");

    dragTarget();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("atlas-target-selection")).toBeNull();
  });
});
