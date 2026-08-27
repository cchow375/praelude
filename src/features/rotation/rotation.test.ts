import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROTATION_SETTINGS,
  readRotationSettings,
  rotationOpenRequest,
  shuffleRotation,
  validateRotationTarget,
  type RotationTarget,
} from "./rotation";
import { DEFAULT_POSITION, PANEL_WIDTH } from "./RotationPanel";
import { DENSE_LAYOUT_FLOOR, NAV_RAIL_WIDTH } from "../dock/dockState";

const target: RotationTarget = {
  key: "2:9",
  piece_id: 2,
  region_id: 9,
  piece_title: "Scherzo",
  label: "Rolled chords",
  m_start: 552,
  m_end: 576,
  sound_target: "grand, without banging",
};

describe("practice rotation", () => {
  it("opens each station as a normal region-backed practice set", () => {
    expect(rotationOpenRequest(target, 5)).toEqual({
      args: expect.objectContaining({
        piece_id: 2,
        region_id: 9,
        m_start: 552,
        m_end: 576,
        required_clean_streak: 5,
        focus: "phrasing",
        use_metronome: false,
      }),
      context: expect.objectContaining({
        judging_axis: "grand, without banging",
        method: "timed rotation",
      }),
    });
  });

  it("uses a real Fisher-Yates order without mutating the saved circuit", () => {
    const values = [target, { ...target, key: "2:10", region_id: 10 }, { ...target, key: "3:1", piece_id: 3, region_id: 1 }];
    const shuffled = shuffleRotation(values, () => 0);
    expect(shuffled.map((item) => item.key)).toEqual(["2:10", "3:1", "2:9"]);
    expect(values.map((item) => item.key)).toEqual(["2:9", "2:10", "3:1"]);
  });

  it("fails closed on corrupt persisted settings", () => {
    const storage = { getItem: () => "{broken" };
    expect(readRotationSettings(storage)).toEqual(DEFAULT_ROTATION_SETTINGS);
  });

  it("rebuilds stored targets strictly, trims copy, deduplicates, and ignores legacy auto-switch", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          targets: [
            { ...target, piece_title: "  Scherzo  ", label: "  Rolled chords  " },
            target,
            { ...target, key: "wrong-key", region_id: 12 },
            { ...target, key: "2:13", region_id: 13, m_start: 600, m_end: 599 },
            { ...target, key: "2:14", region_id: 14, sound_target: 42 },
          ],
          station_minutes: 7.4,
          shuffle: true,
          auto_switch: true,
        }),
    };

    expect(readRotationSettings(storage)).toEqual({
      targets: [
        {
          ...target,
          piece_title: "Scherzo",
          label: "Rolled chords",
        },
      ],
      station_minutes: 7,
      shuffle: true,
    });
  });

  it("rejects incomplete, non-positive, mismatched-key, and unbounded targets", () => {
    expect(validateRotationTarget({ ...target, piece_id: 0 })).toBeNull();
    expect(validateRotationTarget({ ...target, m_start: 0 })).toBeNull();
    expect(
      validateRotationTarget({ ...target, m_end: 0x1_0000_0000 }),
    ).toBeNull();
    expect(validateRotationTarget({ ...target, key: "9:2" })).toBeNull();
    expect(validateRotationTarget({ ...target, label: " ".repeat(400) })).toBeNull();
    expect(validateRotationTarget({ ...target, piece_title: undefined })).toBeNull();
    expect(validateRotationTarget(target)).toEqual(target);
  });

  it("keeps the Rotation default clear of the rail and fully inside 720px", () => {
    expect(DEFAULT_POSITION.x).toBeGreaterThanOrEqual(NAV_RAIL_WIDTH + 12);
    expect(DEFAULT_POSITION.x).toBeGreaterThanOrEqual(160);
    expect(DEFAULT_POSITION.x + PANEL_WIDTH).toBeLessThanOrEqual(
      DENSE_LAYOUT_FLOOR.width,
    );
    expect(DEFAULT_POSITION.y).toBeLessThan(DENSE_LAYOUT_FLOOR.height);
  });
});
