import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function param() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}
function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}
function source() {
  return {
    ...node(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
    frequency: param(),
    type: "sine",
  };
}
function mockContext(state = "running") {
  const sources: ReturnType<typeof source>[] = [];
  const nodes: ReturnType<typeof node>[] = [];
  const ctx = {
    state,
    currentTime: 10,
    sampleRate: 1000,
    destination: node(),
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    createOscillator: vi.fn(() => {
      const next = source();
      sources.push(next);
      return next;
    }),
    createBufferSource: vi.fn(() => {
      const next = source();
      sources.push(next);
      return next;
    }),
    createGain: vi.fn(() => {
      const next = { ...node(), gain: param() };
      nodes.push(next);
      return next;
    }),
    createDynamicsCompressor: vi.fn(() => {
      const next = {
        ...node(),
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      };
      nodes.push(next);
      return next;
    }),
    createBiquadFilter: vi.fn(() => {
      const next = { ...node(), Q: param(), frequency: param(), type: "" };
      nodes.push(next);
      return next;
    }),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
  };
  const Constructor = vi.fn(function () {
    return ctx;
  });
  vi.stubGlobal("AudioContext", Constructor);
  return { ctx, sources, nodes, Constructor };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("optional musical feedback", () => {
  it("unlocks from start-set gestures, coalesces pending resumes and cleans up listeners", async () => {
    const { ctx, Constructor } = mockContext("suspended");
    let resolve!: () => void;
    ctx.resume.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const audio = await import("./completionSound");
    const cleanup = audio.installCompletionAudioUnlock();
    expect(Constructor).not.toHaveBeenCalled();
    try {
      document.dispatchEvent(new Event("pointerdown"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      audio.unlockCompletionAudio();
      expect(ctx.resume).toHaveBeenCalledTimes(1);
      ctx.state = "running";
      resolve();
      await Promise.resolve();
      await Promise.resolve();
      document.dispatchEvent(new Event("pointerdown"));
      expect(ctx.resume).toHaveBeenCalledTimes(1);
      ctx.state = "suspended";
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", repeat: true }),
      );
      expect(ctx.resume).toHaveBeenCalledTimes(1);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(ctx.resume).toHaveBeenCalledTimes(2);
      resolve();
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      cleanup();
    }
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("contains device failures inside asynchronous ended callbacks and still releases other nodes", async () => {
    const { sources, nodes } = mockContext();
    const audio = await import("./completionSound");
    audio.playRepFeedback("clean");
    sources[0].disconnect.mockImplementation(() => {
      throw new Error("device removed");
    });
    nodes[0].disconnect.mockImplementation(() => {
      throw new Error("device removed");
    });
    for (const s of sources) expect(() => s.onended?.()).not.toThrow();
    expect(nodes.every((n) => n.disconnect.mock.calls.length > 0)).toBe(true);
    expect(sources.every((s) => s.onended === null)).toBe(true);
    expect(() => audio.playRepFeedback("clean")).not.toThrow();
  });

  it("constructs the first context and reuses it (the null-context regression)", async () => {
    const { sources, Constructor } = mockContext();
    const audio = await import("./completionSound");
    audio.unlockCompletionAudio();
    audio.playRepFeedback("clean");
    audio.playCompletionSound("set_complete");
    expect(Constructor).toHaveBeenCalledTimes(1);
    expect(sources.length).toBeGreaterThan(10);
    expect(
      sources.every(
        (s) => s.start.mock.calls.length === 1 && s.stop.mock.calls.length >= 1,
      ),
    ).toBe(true);
  });

  it("replaces a closed context", async () => {
    const first = mockContext();
    const audio = await import("./completionSound");
    audio.playRepFeedback("clean");
    first.ctx.state = "closed";
    const second = mockContext();
    audio.playRepFeedback("clean");
    expect(second.Constructor).toHaveBeenCalledOnce();
    expect(second.sources.length).toBeGreaterThan(0);
  });

  it("adds pitches, duration and air as the clean streak builds, with varied ornaments", async () => {
    const { sources } = mockContext();
    const audio = await import("./completionSound");
    audio.playRepFeedback("clean", { progress: 0.2, setbackCount: 0 });
    const early = [...sources];
    audio.playRepFeedback("clean", { progress: 0.8, setbackCount: 0 });
    const late = sources.slice(early.length);
    expect(late.length).toBeGreaterThan(early.length);
    expect(late[0].frequency.setValueAtTime.mock.calls[0][0]).toBeGreaterThan(
      early[0].frequency.setValueAtTime.mock.calls[0][0],
    );
    const lastBefore = sources.length;
    audio.playRepFeedback("clean", { progress: 0.8, setbackCount: 0 });
    const alternate = sources.slice(lastBefore);
    expect(
      alternate.at(-1)?.frequency.setValueAtTime.mock.calls[0][0],
    ).not.toBe(late.at(-1)?.frequency.setValueAtTime.mock.calls[0][0]);
  });

  it("deepens repeated setbacks without increasing their primary volume", async () => {
    const { sources, ctx } = mockContext();
    const audio = await import("./completionSound");
    audio.playRepFeedback("flawed", { progress: 0, setbackCount: 1 });
    const first = [...sources];
    const earlyGain =
      ctx.createGain.mock.results[1].value.gain.exponentialRampToValueAtTime
        .mock.calls[0][0];
    const offset = ctx.createGain.mock.results.length;
    audio.playRepFeedback("flawed", { progress: 0, setbackCount: 3 });
    const later = sources.slice(first.length);
    expect(later[0].frequency.setValueAtTime.mock.calls[0][0]).toBeLessThan(
      first[0].frequency.setValueAtTime.mock.calls[0][0],
    );
    expect(
      ctx.createGain.mock.results[offset + 1].value.gain
        .exponentialRampToValueAtTime.mock.calls[0][0],
    ).toBe(earlyGain);
    expect(later.length).toBeGreaterThan(first.length);
  });

  it("gives chain completion a longer, wider musical resolution and no reward for exit", async () => {
    const { sources } = mockContext();
    const audio = await import("./completionSound");
    audio.playCompletionSound("set_exit");
    expect(sources).toHaveLength(0);
    audio.playCompletionSound("set_complete");
    const set = [...sources];
    audio.playCompletionSound("chain_complete");
    const chain = sources.slice(set.length);
    expect(chain.length).toBeGreaterThan(set.length);
    expect(chain.length).toBeLessThanOrEqual(48);
    const originalEnd = (s: ReturnType<typeof source>) =>
      s.stop.mock.calls[0][0];
    expect(Math.max(...chain.map(originalEnd))).toBeGreaterThan(
      Math.max(...set.map(originalEnd)),
    );
  });

  it("fades old cues, bounds rapid fanfares and disconnects all nodes when ended", async () => {
    const { sources, nodes } = mockContext();
    const audio = await import("./completionSound");
    for (let i = 0; i < 20; i++) audio.playCompletionSound("chain_complete");
    expect(sources.filter((s) => s.onended).length).toBeLessThanOrEqual(96);
    expect(sources[0].disconnect).toHaveBeenCalled();
    sources.forEach((s) => s.onended?.());
    expect(nodes.every((n) => n.disconnect.mock.calls.length > 0)).toBe(true);
    expect(sources.every((s) => s.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("does not resume from a post-write effect, and keeps only the newest pending cue", async () => {
    const { ctx, sources } = mockContext("suspended");
    let resolve!: () => void;
    ctx.resume.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const audio = await import("./completionSound");
    audio.playRepFeedback("clean");
    expect(ctx.resume).not.toHaveBeenCalled();
    audio.unlockCompletionAudio();
    audio.playRepFeedback("clean");
    audio.playCompletionSound("set_complete");
    ctx.state = "running";
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sources).toHaveLength(17);
  });

  it("drops feedback when gesture resume takes too long", async () => {
    const { ctx, sources } = mockContext("suspended");
    let resolve!: () => void;
    ctx.resume.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const audio = await import("./completionSound");
    audio.unlockCompletionAudio();
    audio.playRepFeedback("clean");
    clock.mockReturnValue(500);
    ctx.state = "running";
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sources).toHaveLength(0);
  });

  it("swallows rejected and throwing resumes", async () => {
    const { ctx, sources } = mockContext("suspended");
    const audio = await import("./completionSound");
    ctx.resume.mockRejectedValueOnce(new Error("blocked"));
    expect(() => audio.unlockCompletionAudio()).not.toThrow();
    audio.playRepFeedback("clean");
    await Promise.resolve();
    await Promise.resolve();
    ctx.resume.mockImplementationOnce(() => {
      throw new Error("device removed");
    });
    expect(() => audio.unlockCompletionAudio()).not.toThrow();
    expect(sources).toHaveLength(0);
  });

  it("tolerates unavailable audio, context creation failures and a broken graph", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const audio = await import("./completionSound");
    expect(() => audio.playRepFeedback("clean")).not.toThrow();
    vi.stubGlobal("AudioContext", function () {
      throw new Error("no device");
    });
    expect(() => audio.unlockCompletionAudio()).not.toThrow();
    const { ctx, sources, nodes } = mockContext();
    ctx.createOscillator.mockImplementationOnce(() => {
      throw new Error("out of resources");
    });
    expect(() => audio.playCompletionSound("set_complete")).not.toThrow();
    expect(nodes.every((n) => n.disconnect.mock.calls.length > 0)).toBe(true);
    expect(sources).toHaveLength(0);
  });

  it("clamps invalid progress and setback values to finite audio parameters", async () => {
    const { sources } = mockContext();
    const audio = await import("./completionSound");
    audio.playRepFeedback("clean", { progress: Infinity, setbackCount: NaN });
    audio.playRepFeedback("flawed", { progress: -1, setbackCount: Infinity });
    for (const s of sources) {
      expect(
        s.frequency.setValueAtTime.mock.calls.flat().every(Number.isFinite),
      ).toBe(true);
      expect(
        s.frequency.exponentialRampToValueAtTime.mock.calls
          .flat()
          .every(Number.isFinite),
      ).toBe(true);
    }
  });
});
