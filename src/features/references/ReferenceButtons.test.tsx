import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferenceButtons, type ReferenceApi } from "./ReferenceButtons";

afterEach(cleanup);

describe("ReferenceButtons", () => {
  it("opens only after an explicit provider click", async () => {
    const api: ReferenceApi = {
      open: vi.fn().mockResolvedValue({ provider: "spotify", url: "https://open.spotify.com/search/x", opened: true }),
    };
    render(<ReferenceButtons pieceId={7} api={api} />);
    expect(api.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search Spotify" }));
    await waitFor(() => expect(api.open).toHaveBeenCalledWith(7, "spotify"));
    expect(await screen.findByText("Spotify search opened.")).toBeTruthy();
  });

  it("keeps both explicit actions and surfaces backend failure", async () => {
    const api: ReferenceApi = { open: vi.fn().mockRejectedValue("Reference handoff rejected.") };
    render(<ReferenceButtons pieceId={7} api={api} />);
    expect(screen.getByRole("button", { name: "Search Spotify" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search YouTube" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Reference handoff rejected");
  });
});
