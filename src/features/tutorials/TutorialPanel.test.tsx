import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const convertMock = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => convertMock(path),
}));

import { formatTutorialTime, TutorialPanel } from "./TutorialPanel";

const video = {
  id: 3,
  piece_id: 2,
  title: "Scherzo tutorial",
  file_path: "/pieces/scherzo/tutorials/scherzo.mp4",
  duration_seconds: 2397,
  clips: [{
    id: 8,
    chapter_id: 5,
    video_id: 3,
    region_id: 17,
    start_seconds: 568.92,
    end_seconds: 913.28,
    title: "Con anima voicing",
    notes: "Hear the fifth finger as the bass voice.",
    order: 0,
  }],
};

describe("TutorialPanel", () => {
  beforeEach(() => {
    invokeMock.mockReset().mockImplementation((command: string) => {
      if (command === "tutorial_video_scan") return Promise.resolve([video]);
      return Promise.resolve(undefined);
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows only this Region's mapped chapters beside its player", async () => {
    render(<TutorialPanel pieceId={2} regionId={17} />);
    expect(await screen.findByText("Con anima voicing")).toBeTruthy();
    expect(screen.getByText("9:29–15:13")).toBeTruthy();
    expect(screen.getByText("Hear the fifth finger as the bass voice.")).toBeTruthy();
    expect(screen.getByText("This device cannot play the tutorial video.")).toBeTruthy();
    expect(convertMock).toHaveBeenCalledWith(video.file_path);
    fireEvent.click(screen.getByRole("button", { name: "Show file" }));
    expect(invokeMock).toHaveBeenCalledWith("tutorial_video_reveal", { id: 3 });
  });

  it("edits an existing Region-to-video mapping", async () => {
    render(<TutorialPanel pieceId={2} regionId={17} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit chapter" }));
    fireEvent.change(screen.getByDisplayValue("Con anima voicing"), { target: { value: "Bass voicing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("tutorial_clip_update", {
      id: 8,
      patch: expect.objectContaining({ title: "Bass voicing", start_seconds: 568.92, end_seconds: 913.28 }),
    }));
  });

  it("formats chapter timestamps", () => {
    expect(formatTutorialTime(2269.34)).toBe("37:49");
  });

  it("persists a newly scanned video's real duration after metadata loads", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "tutorial_video_scan") return Promise.resolve([{ ...video, duration_seconds: null }]);
      return Promise.resolve(undefined);
    });
    render(<TutorialPanel pieceId={2} regionId={17} />);
    const player = await screen.findByText("Con anima voicing").then(() => document.querySelector("video") as HTMLVideoElement);
    Object.defineProperty(player, "duration", { configurable: true, value: 2397.019 });
    fireEvent.loadedMetadata(player);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("tutorial_video_update", {
      id: 3,
      patch: { duration_seconds: 2397.019 },
    }));
  });

  it("warns before editing chapter metadata shared by multiple sections", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "tutorial_video_scan") return Promise.resolve([{
        ...video,
        clips: [video.clips[0], { ...video.clips[0], id: 9, region_id: 18 }],
      }]);
      return Promise.resolve(undefined);
    });
    render(<TutorialPanel pieceId={2} regionId={17} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit shared chapter" }));
    expect(screen.getByText(/linked to 2 tricky sections/)).toBeTruthy();
  });

  it("can forget a confirmed broken video entry without claiming to delete its file", async () => {
    render(<TutorialPanel pieceId={2} regionId={17} />);
    const player = await screen.findByText("Con anima voicing").then(() => document.querySelector("video") as HTMLVideoElement);
    fireEvent.error(player);
    fireEvent.click(screen.getByRole("button", { name: "Forget broken video" }));
    expect(screen.getByText(/video file itself will not be changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("tutorial_video_delete", { id: 3 }));
    expect(await screen.findByText("No tutorial video yet.")).toBeTruthy();
  });
});
