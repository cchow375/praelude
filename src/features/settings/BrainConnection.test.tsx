import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainConnection } from "./BrainConnection";
import type { CommandInvoker } from "../../services/command";

afterEach(cleanup);

/** A command invoker that resolves each command name to a fixed payload. */
function invokerFrom(map: Record<string, unknown>): CommandInvoker {
  return vi.fn(async (command: string) => {
    if (command in map) return map[command];
    throw new Error(`unexpected command ${command}`);
  });
}

describe("BrainConnection", () => {
  it("shows the truthful offline reason from brain_status", async () => {
    const invoker = invokerFrom({
      brain_status: {
        online: false,
        provider: null,
        reason: "no key configured",
      },
    });
    render(<BrainConnection invoker={invoker} />);
    expect(await screen.findByText(/no key configured/i)).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it("shows configured provider from brain_status without claiming a network check", async () => {
    const invoker = invokerFrom({
      brain_status: { online: true, provider: "gemini", reason: null },
    });
    render(<BrainConnection invoker={invoker} />);
    expect(await screen.findByText(/configured/i)).toBeTruthy();
    expect(screen.getByText(/gemini/i)).toBeTruthy();
  });

  it("renders model + latency after a successful Test connection", async () => {
    const invoker = invokerFrom({
      brain_status: { online: true, provider: "gemini", reason: null },
      brain_test_connection: {
        ok: true,
        provider: "gemini",
        model: "gemini-flash-latest",
        latency_ms: 412,
        error: null,
      },
    });
    render(<BrainConnection invoker={invoker} />);
    await screen.findByText(/configured/i);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    expect(await screen.findByText(/gemini-flash-latest/)).toBeTruthy();
    expect(screen.getByText(/412/)).toBeTruthy();
  });

  it("renders the exact error after a failed Test connection", async () => {
    const invoker = invokerFrom({
      brain_status: { online: true, provider: "gemini", reason: null },
      brain_test_connection: {
        ok: false,
        provider: null,
        model: null,
        latency_ms: null,
        error: "provider error: HTTP 503",
      },
    });
    render(<BrainConnection invoker={invoker} />);
    await screen.findByText(/configured/i);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(screen.getByText(/provider error: HTTP 503/)).toBeTruthy(),
    );
  });
});
