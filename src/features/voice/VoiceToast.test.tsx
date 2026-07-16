import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

import {
  VoiceToast,
  deliveryDispositionNote,
  isActionableIntent,
  labelForIntent,
} from "./VoiceToast";
import type { VoiceIntent } from "./useVoice";
import type { VoiceDeliveryDisposition } from "./domain/delivery";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isActionableIntent", () => {
  it("returns false for silent kinds (question, ignored)", () => {
    expect(isActionableIntent("question")).toBe(false);
    expect(isActionableIntent("ignored")).toBe(false);
  });

  it("returns true for every other kind", () => {
    for (const kind of [
      "start",
      "set",
      "stop",
      "accent",
      "busy",
      "rep_pass",
      "rep_fail",
      "something_unknown",
    ]) {
      expect(isActionableIntent(kind)).toBe(true);
    }
  });
});

describe("labelForIntent", () => {
  it("labels start/set with a bpm as a tempo readout", () => {
    expect(labelForIntent({ kind: "start", text: "", bpm: 96 })).toBe("♩ = 96");
    expect(labelForIntent({ kind: "set", text: "", bpm: 120 })).toBe("♩ = 120");
  });

  it("labels start/set without a bpm as 'Tempo set'", () => {
    expect(labelForIntent({ kind: "start", text: "", bpm: null })).toBe("Tempo set");
    expect(labelForIntent({ kind: "set", text: "", bpm: null })).toBe("Tempo set");
  });

  it("labels the fixed-text intents", () => {
    expect(labelForIntent({ kind: "stop", text: "", bpm: null })).toBe("Stopped");
    expect(labelForIntent({ kind: "accent", text: "", bpm: null })).toBe("Accent");
    expect(labelForIntent({ kind: "busy", text: "", bpm: null })).toBe("Busy");
    expect(labelForIntent({ kind: "rep_pass", text: "", bpm: null })).toBe("Rep passed");
    expect(labelForIntent({ kind: "rep_fail", text: "", bpm: null })).toBe("Rep failed");
  });

  it("falls back to the raw kind for an unrecognised intent", () => {
    expect(labelForIntent({ kind: "mystery", text: "", bpm: null })).toBe("mystery");
  });
});

describe("deliveryDispositionNote", () => {
  const identity = { delivery_id: "d1", revision: 0 };
  it("notes duplicate and stale-revision drops, nothing else", () => {
    expect(deliveryDispositionNote({ kind: "duplicate", identity })).toBe("Heard that already.");
    expect(
      deliveryDispositionNote({ kind: "stale_revision", identity, latest_revision: 3 }),
    ).toBe("Ignored older speech.");
    expect(deliveryDispositionNote({ kind: "accepted_new", identity })).toBeNull();
    expect(
      deliveryDispositionNote({ kind: "accepted_revision", identity, previous_revision: 0 }),
    ).toBeNull();
    expect(
      deliveryDispositionNote({ kind: "invalid", identity, reason: "empty_delivery_id" }),
    ).toBeNull();
  });
});

describe("VoiceToast component", () => {
  it("surfaces a concise auto-dismissing note for a duplicate delivery", () => {
    vi.useFakeTimers();
    const duplicate: VoiceDeliveryDisposition = {
      kind: "duplicate",
      identity: { delivery_id: "d1", revision: 0 },
    };
    render(
      <VoiceToast
        lastIntent={null}
        status="live"
        downGuidance={null}
        deliveryDisposition={duplicate}
      />,
    );
    expect(screen.getByText("Heard that already.")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText("Heard that already.")).toBeNull();
  });

  it("does not toast an accepted delivery", () => {
    render(
      <VoiceToast
        lastIntent={null}
        status="live"
        downGuidance={null}
        deliveryDisposition={{
          kind: "accepted_new",
          identity: { delivery_id: "d2", revision: 0 },
        }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a toast for a new actionable intent", () => {
    const intent: VoiceIntent = { kind: "start", text: "metronome ninety six", bpm: 96 };
    render(<VoiceToast lastIntent={intent} status="live" downGuidance={null} />);
    expect(screen.getByText("metronome ninety six")).toBeTruthy();
    expect(screen.getByText("♩ = 96")).toBeTruthy();
  });

  it("does not show a toast for a silent kind", () => {
    const intent: VoiceIntent = { kind: "question", text: "what tempo is this", bpm: null };
    render(<VoiceToast lastIntent={intent} status="live" downGuidance={null} />);
    expect(screen.queryByText("what tempo is this")).toBeNull();
  });

  it("auto-dismisses the toast after TOAST_MS", () => {
    vi.useFakeTimers();
    const intent: VoiceIntent = { kind: "stop", text: "stop", bpm: null };
    render(<VoiceToast lastIntent={intent} status="live" downGuidance={null} />);
    expect(screen.getByText("Stopped")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText("Stopped")).toBeNull();
  });

  it("shows the persistent down-guidance banner only when status is down AND downGuidance is truthy", () => {
    const { rerender } = render(
      <VoiceToast lastIntent={null} status="live" downGuidance="ignored while live" />,
    );
    expect(screen.queryByText("ignored while live")).toBeNull();

    rerender(<VoiceToast lastIntent={null} status="down" downGuidance={null} />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <VoiceToast
        lastIntent={null}
        status="down"
        downGuidance="Enable Dictation in System Settings."
      />,
    );
    expect(screen.getByText("Enable Dictation in System Settings.")).toBeTruthy();
  });

  it("persists the down banner (no auto-dismiss) while status stays down", () => {
    vi.useFakeTimers();
    render(
      <VoiceToast
        lastIntent={null}
        status="down"
        downGuidance="Microphone or Speech Recognition permission is off."
      />,
    );
    expect(
      screen.getByText("Microphone or Speech Recognition permission is off."),
    ).toBeTruthy();
    // Unlike the toast, the banner must NOT auto-dismiss on a timer.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getByText("Microphone or Speech Recognition permission is off."),
    ).toBeTruthy();
  });

  it("dismisses the down banner on the dismiss button and keeps it dismissed for the same guidance", () => {
    const guidance = "Enable Dictation in System Settings.";
    const { rerender } = render(
      <VoiceToast lastIntent={null} status="down" downGuidance={guidance} />,
    );
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    act(() => {
      dismiss.click();
    });
    expect(screen.queryByText(guidance)).toBeNull();
    // A re-render with the SAME down guidance must not resurrect it.
    rerender(<VoiceToast lastIntent={null} status="down" downGuidance={guidance} />);
    expect(screen.queryByText(guidance)).toBeNull();
  });

  it("re-shows the banner for a NEW (different) down guidance even after a prior dismissal", () => {
    const first = "Enable Dictation in System Settings.";
    const second =
      "Microphone or Speech Recognition permission is off. Allow CodaKiller, then relaunch.";
    const { rerender } = render(
      <VoiceToast lastIntent={null} status="down" downGuidance={first} />,
    );
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByText(first)).toBeNull();

    // A different down reason must re-show the banner.
    rerender(<VoiceToast lastIntent={null} status="down" downGuidance={second} />);
    expect(screen.getByText(second)).toBeTruthy();
  });

  it("resets dismissal when the pipeline recovers (leaves down) then goes down again", () => {
    const guidance = "Enable Dictation in System Settings.";
    const { rerender } = render(
      <VoiceToast lastIntent={null} status="down" downGuidance={guidance} />,
    );
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByText(guidance)).toBeNull();

    // Recover to live...
    rerender(<VoiceToast lastIntent={null} status="live" downGuidance={null} />);
    // ...then the SAME failure returns: the banner shows again (dismissal reset).
    rerender(<VoiceToast lastIntent={null} status="down" downGuidance={guidance} />);
    expect(screen.getByText(guidance)).toBeTruthy();
  });

  it("re-fires the toast timer when a NEW intent object arrives before the previous timer completes", () => {
    vi.useFakeTimers();
    const first: VoiceIntent = { kind: "start", text: "start", bpm: 96 };
    const { rerender } = render(
      <VoiceToast lastIntent={first} status="live" downGuidance={null} />,
    );
    expect(screen.getByText("♩ = 96")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2000); // before TOAST_MS elapses for the first intent
    });

    const second: VoiceIntent = { kind: "accent", text: "accent every three", bpm: null };
    rerender(<VoiceToast lastIntent={second} status="live" downGuidance={null} />);
    expect(screen.getByText("Accent")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2000); // 4000ms since mount, but only 2000ms since the 2nd intent
    });
    expect(screen.getByText("Accent")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(500); // now 2500ms since the 2nd intent
    });
    expect(screen.queryByText("Accent")).toBeNull();
  });
});
