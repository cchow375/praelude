import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

// Tauri IPC seam.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
// Webview drag-drop is unavailable in jsdom; the dynamic import rejects harmlessly.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

import { AddScore } from "./AddScore";

const HITS = [
  {
    title: "Nocturnes, Op.9 (Chopin)",
    page_id: 6789,
    snippet:
      'Complete <span class="searchmatch">Nocturnes</span> <script>alert(1)</script>',
    size: 42942,
    word_count: 3000,
    is_redirect: false,
  },
];
const EDITIONS = [
  {
    file_name: "PMLP02312-Chopin_Nocturnes.pdf",
    description: "Complete Score",
    editor: "{{FE}} (German)",
    publisher: "{{P|Kistner|Leipzig}}",
    copyright: "Public Domain",
    image_type: "Normal Scan",
  },
];
const PDF_FILE = {
  url: "https://imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes.pdf",
  size: 100,
  mime: "application/pdf",
};

function mock(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    imslp_search: HITS,
    imslp_editions: EDITIONS,
    imslp_open_download: PDF_FILE,
    downloads_list: [],
    piece_import_pdf: "/vault/Pieces/Chopin - Nocturne",
    ...overrides,
  };
  invokeMock.mockImplementation((cmd: string) =>
    Promise.resolve(table[cmd] ?? null),
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const searchCalls = () =>
  invokeMock.mock.calls.filter((c) => c[0] === "imslp_search");

describe("AddScore", () => {
  // The debounce was 1500ms, which made the panel look dead for a second and a
  // half before it even started. IMSLP etiquette now lives in the Rust client's
  // rate guard (off the UI thread), so the UI can respond promptly.
  it("debounces the search by ~250ms, then calls imslp_search once", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });

    // No call before the debounce elapses.
    await tick(200);
    expect(searchCalls()).toHaveLength(0);

    // Exactly one call after it does.
    await tick(100);
    expect(invokeMock).toHaveBeenCalledWith("imslp_search", {
      query: "chopin",
    });
    expect(searchCalls()).toHaveLength(1);
  });

  it("searches immediately on Enter, without a duplicate debounced call", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");

    fireEvent.change(box, { target: { value: "chopin" } });
    fireEvent.keyDown(box, { key: "Enter" });

    // Fired now — well inside the debounce window.
    await tick(0);
    expect(searchCalls()).toHaveLength(1);

    // The pending debounce was cancelled, so no second request lands.
    await tick(600);
    expect(searchCalls()).toHaveLength(1);
  });

  it("shows a searching state while the call is in flight", async () => {
    let release: (hits: unknown) => void = () => {};
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "imslp_search"
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(null),
    );
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });

    await tick(300);
    expect(screen.getByText(/Searching IMSLP for/)).toBeTruthy();

    await act(async () => {
      release(HITS);
    });
    expect(screen.queryByText(/Searching IMSLP for/)).toBeNull();
    expect(screen.getByText(/1 result for/)).toBeTruthy();
  });

  it("says 'no matches' rather than rendering an empty void", async () => {
    mock({ imslp_search: [] });
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "zzzzz" },
    });
    await tick(300);

    expect(screen.getByText(/No matches for .zzzzz. on IMSLP/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("surfaces the underlying cause when the search fails", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "imslp_search"
        ? Promise.reject(
            new Error("Could not reach IMSLP. Check your connection."),
          )
        : Promise.resolve(null),
    );
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });
    await tick(300);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not reach IMSLP");
    // An error must never masquerade as "no matches" or as a blank list.
    expect(screen.queryByText(/No matches for/)).toBeNull();
    expect(screen.queryByText(/Searching IMSLP for/)).toBeNull();
  });

  it("retries a failed search from the error state", async () => {
    let attempt = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd !== "imslp_search") return Promise.resolve(null);
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("network down"))
        : Promise.resolve(HITS);
    });
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });
    await tick(300);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await tick(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Nocturnes, Op.9 (Chopin)")).toBeTruthy();
  });

  it("ignores a slow earlier response that resolves after a newer one", async () => {
    const resolvers: ((hits: unknown) => void)[] = [];
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "imslp_search"
        ? new Promise((resolve) => resolvers.push(resolve))
        : Promise.resolve(null),
    );
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");

    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(300);
    fireEvent.change(box, { target: { value: "liszt" } });
    await tick(300);
    expect(resolvers).toHaveLength(2);

    // The NEWER call answers first, then the stale one arrives late.
    await act(async () => {
      resolvers[1](HITS);
    });
    await act(async () => {
      resolvers[0]([]);
    });

    // The stale empty response must not clobber the newer results.
    expect(screen.getByText("Nocturnes, Op.9 (Chopin)")).toBeTruthy();
    expect(screen.queryByText(/No matches for/)).toBeNull();
  });

  // Regression: the live IMSLP API sends no `pageid`, so every real hit arrives
  // with page_id 0. Keying the list on it produced duplicate React keys and made
  // `aria-pressed` true for EVERY row as soon as one was chosen.
  it("keeps hits distinct when every page_id is 0, as live IMSLP sends them", async () => {
    const LIVE_SHAPE = [
      "Scherzo No.1, Op.20 (Chopin, Frédéric)",
      "Scherzo No.2, Op.31 (Chopin, Frédéric)",
      "Scherzo No.3, Op.39 (Chopin, Frédéric)",
    ].map((title) => ({
      title,
      page_id: 0,
      snippet: "score",
      size: 1,
      word_count: 1,
      is_redirect: false,
    }));
    mock({ imslp_search: LIVE_SHAPE });
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin scherzo" },
    });
    await tick(300);

    // All three render, none collapsed away by a duplicate key.
    const rows = screen.getAllByRole("button", { name: /Scherzo No\./ });
    expect(rows).toHaveLength(3);

    // Choosing the second selects exactly one row.
    fireEvent.click(rows[1]);
    await tick(0);
    const pressed = screen
      .getAllByRole("button", { name: /Scherzo No\./ })
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toContain("Scherzo No.2");

    // …and the editions request used that row's title.
    expect(invokeMock).toHaveBeenCalledWith("imslp_editions", {
      pageTitle: "Scherzo No.2, Op.31 (Chopin, Frédéric)",
    });
  });

  it("drops the previous work's editions when a new query is typed", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");
    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(300);
    fireEvent.click(screen.getByText("Nocturnes, Op.9 (Chopin)"));
    await tick(0);
    expect(screen.getByText("Download in your browser")).toBeTruthy();

    // A new search must not leave the old work's download button on screen.
    fireEvent.change(box, { target: { value: "liszt" } });
    await tick(300);
    expect(screen.queryByText("Download in your browser")).toBeNull();
  });

  it("returns to idle when the query is cleared", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");
    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(300);
    expect(screen.getByText("Nocturnes, Op.9 (Chopin)")).toBeTruthy();

    fireEvent.change(box, { target: { value: "  " } });
    await tick(300);
    expect(screen.queryByText("Nocturnes, Op.9 (Chopin)")).toBeNull();
    expect(screen.queryByText(/No matches for/)).toBeNull();
    expect(screen.queryByText(/result/)).toBeNull();
  });

  it("renders the snippet as plain text (a <script> in it is inert)", async () => {
    mock();
    const { container } = render(
      <AddScore onImported={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });
    await tick(1600);

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/Complete Nocturnes alert\(1\)/)).toBeTruthy();
  });

  it("warns quietly when the chosen edition's mime is not a PDF", async () => {
    mock({
      imslp_open_download: {
        url: "https://imslp.org/x.tiff",
        size: 1,
        mime: "image/tiff",
      },
    });
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });
    await tick(1600);

    fireEvent.click(screen.getByText("Nocturnes, Op.9 (Chopin)"));
    await tick(0);
    fireEvent.click(screen.getByText("Download in your browser"));
    await tick(0);

    expect(screen.getByText(/isn't a PDF/)).toBeTruthy();
  });

  it("offers a matching Downloads file and imports it via piece_import_pdf", async () => {
    mock({
      downloads_list: [
        {
          name: "PMLP02312-Chopin_Nocturnes (1).pdf",
          path: "/Users/you/Downloads/PMLP02312-Chopin_Nocturnes (1).pdf",
          modified_ms: 1,
        },
      ],
    });
    const onImported = vi.fn();
    render(<AddScore onImported={onImported} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });
    await tick(1600);
    fireEvent.click(screen.getByText("Nocturnes, Op.9 (Chopin)"));
    await tick(0);
    fireEvent.click(screen.getByText("Download in your browser"));
    await tick(0); // resolves open_download + the immediate downloads poll

    const importButton = screen.getByRole("button", {
      name: /Import .PMLP02312-Chopin_Nocturnes \(1\)\.pdf./,
    });
    fireEvent.click(importButton);
    await tick(0);

    expect(invokeMock).toHaveBeenCalledWith("piece_import_pdf", {
      folderName: "Nocturnes, Op.9 (Chopin)",
      sourcePath: "/Users/you/Downloads/PMLP02312-Chopin_Nocturnes (1).pdf",
    });
    expect(onImported).toHaveBeenCalled();
  });
});
