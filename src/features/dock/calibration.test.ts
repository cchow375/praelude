import { describe, expect, it } from "vitest";
import {
  DYNAMIC_LABELS,
  activeProfile,
  medianDb,
  validateLabel,
  validateMonotonic,
  type CalibrationPoint,
  type DynamicsProfile,
} from "./calibration";

const pts = (v: number[]): CalibrationPoint[] =>
  DYNAMIC_LABELS.map((l, i) => ({ dynamic_label: l, measured_db: v[i] }));

describe("calibration math", () => {
  it("takes the median of a capture window, not the mean (one bang must not move it)", () => {
    expect(medianDb([-40, -39, -41, -40, -2])).toBe(-40);
  });

  it("averages the two middles for an even-length window", () => {
    expect(medianDb([-42, -40, -38, -36])).toBe(-39);
  });

  it("accepts a strictly increasing curve", () => {
    expect(validateMonotonic(pts([-48, -38, -28, -18, -9]))).toBeNull();
  });

  it("rejects a non-increasing curve, naming the step and both dB figures", () => {
    const msg = validateMonotonic(pts([-48, -29.8, -31.4, -18, -9]));
    expect(msg).toContain("mf");
    expect(msg).toContain("-31.4");
    expect(msg).toContain("-29.8");
    expect(msg?.toLowerCase()).not.toContain("invalid");
  });

  it("rejects equal neighbours", () => {
    expect(validateMonotonic(pts([-48, -38, -38, -18, -9]))).not.toBeNull();
  });

  it("rejects a short point set", () => {
    expect(validateMonotonic([])).not.toBeNull();
    expect(validateMonotonic(pts([-48, -38, -28, -18, -9]).slice(0, 3))).not.toBeNull();
  });

  it("rejects a mislabelled step, naming the bad label", () => {
    const wrong = pts([-48, -38, -28, -18, -9]);
    wrong[2] = {
      ...wrong[2],
      dynamic_label: "mp" as unknown as CalibrationPoint["dynamic_label"],
    };
    expect(validateMonotonic(wrong)).toContain("mp");
  });

  it("rejects a non-finite reading rather than storing NaN", () => {
    const bad = pts([-48, -38, Number.NaN, -18, -9]);
    expect(validateMonotonic(bad)).toContain("mf");
  });
});

describe("profile label", () => {
  it("requires a name", () => {
    expect(validateLabel("   ")).not.toBeNull();
    expect(validateLabel("Steinway, living room, lid half")).toBeNull();
  });

  it("bounds the name at 120 characters", () => {
    expect(validateLabel("x".repeat(120))).toBeNull();
    expect(validateLabel("x".repeat(121))).toContain("120");
  });
});

describe("activeProfile", () => {
  const profile = (id: number, active: boolean): DynamicsProfile => ({
    id,
    device_id: "mic-1",
    label: `p${id}`,
    active,
    created_at: "",
    points: pts([-48, -38, -28, -18, -9]),
  });

  it("finds the one active profile", () => {
    expect(activeProfile([profile(1, false), profile(2, true)])?.id).toBe(2);
  });

  it("returns null when nothing is calibrated", () => {
    expect(activeProfile([])).toBeNull();
    expect(activeProfile([profile(1, false)])).toBeNull();
  });
});
