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

vi.mock("./thumbnail", () => ({
  THUMB_MAX_EDGE: 320,
  toThumbnailBase64: () => Promise.resolve("THUMB64"),
  toFullBase64: () => Promise.resolve("FULL64"),
}));

import { DayPhotoCapture } from "./DayPhotoCapture";

const DAY = "2026-08-23";

function stream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

async function openCamera() {
  fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
  return screen.findByRole("button", { name: "Take today's photo" });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});
afterEach(cleanup);

describe("DayPhotoCapture", () => {
  it("captures a frame and saves both sizes in ONE call", async () => {
    const onDone = vi.fn();
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={onDone}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    fireEvent.click(await openCamera());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("day_photo_save", {
        day: DAY,
        jpegBase64: "FULL64",
        thumbBase64: "THUMB64",
      }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("skips in one keypress and writes nothing", async () => {
    const onDone = vi.fn();
    const { container } = render(
      <DayPhotoCapture
        day={DAY}
        onDone={onDone}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    fireEvent.keyDown(container.firstChild as Element, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("F8: Escape still skips even when focus has moved elsewhere on the page — the card is not a focus trap", async () => {
    const onDone = vi.fn();
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={onDone}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    await openCamera();
    // Move focus somewhere outside the card entirely.
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();

    outside.remove();
  });

  it("skips in one button press too — never a two-step toll", async () => {
    const onDone = vi.fn();
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={onDone}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    // No "are you sure" anywhere.
    expect(screen.queryByText(/sure/i)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("falls back to file drop when the camera is denied, without an error state", async () => {
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() =>
          Promise.reject(new DOMException("denied", "NotAllowedError"))
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    expect(await screen.findByTestId("day-photo-dropzone")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Take today's photo" }),
    ).toBeNull();
    // The picker is still one press away.
    expect(screen.getByLabelText("Choose a photo")).toBeTruthy();
  });

  it("falls back to files when camera acquisition throws synchronously", async () => {
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() => {
          throw new Error("mediaDevices unavailable");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    expect(await screen.findByTestId("day-photo-dropzone")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never uses window.confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("never requests the camera merely because the ritual card appeared", async () => {
    const getMedia = vi.fn(() => Promise.resolve(stream()));
    render(<DayPhotoCapture day={DAY} onDone={vi.fn()} getMedia={getMedia} />);

    expect(screen.getByRole("button", { name: "Use camera" })).toBeTruthy();
    expect(screen.getByLabelText("Choose a photo")).toBeTruthy();
    expect(getMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    await screen.findByRole("button", { name: "Take today's photo" });
    expect(getMedia).toHaveBeenCalledTimes(1);
  });

  it("stops the camera track when it unmounts", async () => {
    const stop = vi.fn();
    const { unmount } = render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() =>
          Promise.resolve({
            getTracks: () => [{ stop }],
          } as unknown as MediaStream)
        }
      />,
    );
    await openCamera();
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("F5: a failed save shows an honest inline error and keeps Skip available", async () => {
    invokeMock.mockRejectedValueOnce("day-photos dir unavailable (disk full)");
    const onDone = vi.fn();
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={onDone}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    fireEvent.click(await openCamera());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "day-photos dir unavailable (disk full)",
    );
    // onDone was NOT called — the ritual is not silently lost, the user sees
    // the failure and can act on it.
    expect(onDone).not.toHaveBeenCalled();

    // Skip is still one press away, exactly as always.
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("fits the 720x520 dense floor", async () => {
    const { container } = render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() => Promise.resolve(stream())}
      />,
    );
    const card = container.querySelector(".day-photo-card") as HTMLElement;
    expect(card.className).toContain("day-photo-card");
    // The card is width-capped in CSS, not by an inline pixel size that could
    // exceed the floor.
    expect(card.getAttribute("style")).toBeNull();
  });
});
