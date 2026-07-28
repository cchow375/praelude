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

describe("AddScore", () => {
  it("debounces the search ≥1.5s before calling imslp_search", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });

    // No call before the debounce elapses.
    await tick(1400);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "imslp_search",
      expect.anything(),
    );

    // Exactly one call after it does.
    await tick(300);
    expect(invokeMock).toHaveBeenCalledWith("imslp_search", {
      query: "chopin",
    });
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === "imslp_search"),
    ).toHaveLength(1);
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
