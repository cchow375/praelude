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
  // 1500ms made the panel look dead before it even started; 250ms sat BELOW
  // ordinary typing speed, so every keystroke past ~260ms/char fired its own
  // request. 450ms clears real typing gaps (including word-boundary pauses)
  // while still feeling immediate. IMSLP etiquette lives in the Rust client's
  // rate guard, off the UI thread.
  it("debounces the search by ~450ms, then calls imslp_search once", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });

    // No call before the debounce elapses.
    await tick(400);
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

    await tick(500);
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
    await tick(500);

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
    await tick(500);

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
    await tick(500);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await tick(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Nocturnes, Op.9 (Chopin)")).toBeTruthy();
  });

  // AT MOST ONE imslp_search may be on the wire. `imslp_search` blocks on the
  // Rust client's ≥1s rate guard, so parallel calls do not overlap — they drain
  // one per second with the newest query last, which is precisely how a 250ms
  // debounce turned fast typing into a ten-second wait.
  it("never puts a second imslp_search on the wire while one is in flight", async () => {
    const resolvers: ((hits: unknown) => void)[] = [];
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "imslp_search"
        ? new Promise((resolve) => resolvers.push(resolve))
        : Promise.resolve(null),
    );
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");

    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(500);
    expect(searchCalls()).toHaveLength(1);

    // Three more debounce expiries while the first call hangs: none of them may
    // start a request, and only the LAST one may survive the wait.
    for (const value of ["chopin s", "chopin sch", "chopin scherzo"]) {
      fireEvent.change(box, { target: { value } });
      await tick(500);
    }
    expect(searchCalls()).toHaveLength(1);
    // The panel already names the query the user is actually waiting for.
    expect(
      screen.getByText(/Searching IMSLP for .chopin scherzo./),
    ).toBeTruthy();

    // When the first answer lands, the newest query goes out — and only it.
    await act(async () => {
      resolvers[0]([]);
    });
    expect(searchCalls()).toHaveLength(2);
    expect(searchCalls()[1][1]).toEqual({ query: "chopin scherzo" });
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

    // "chopin" goes out and hangs; the user types on, so "liszt" is queued.
    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(500);
    fireEvent.change(box, { target: { value: "liszt" } });
    await tick(500);
    expect(resolvers).toHaveLength(1);

    // The stale "chopin" answer finally arrives. It must not paint anything —
    // the panel belongs to "liszt" now — and it must release the queued query.
    await act(async () => {
      resolvers[0](HITS);
    });
    expect(screen.queryByText("Nocturnes, Op.9 (Chopin)")).toBeNull();
    expect(screen.getByText(/Searching IMSLP for .liszt./)).toBeTruthy();
    expect(searchCalls()).toHaveLength(2);
    expect(searchCalls()[1][1]).toEqual({ query: "liszt" });

    await act(async () => {
      resolvers[1](HITS);
    });
    expect(screen.getByText(/1 result for .liszt./)).toBeTruthy();
  });

  // The Rust client drops a search the instant a newer one starts (imslp.rs
  // `SEARCH_SUPERSEDED`). That is a control signal, not a failure: showing it as
  // "IMSLP search failed" would turn the fix into a visible bug.
  it("swallows a superseded search instead of showing it as an error", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "imslp_search"
        ? Promise.reject(new Error("IMSLP search superseded by a newer query."))
        : Promise.resolve(null),
    );
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin" },
    });
    await tick(500);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/No matches for/)).toBeNull();
    // The panel stays on "searching" — the newer search owns it from here.
    expect(screen.getByText(/Searching IMSLP for .chopin./)).toBeTruthy();
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
    await tick(500);

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

  // The title is the row's whole identity (page_id is always 0), so a response
  // that repeated one would mean a duplicate React key AND a click pressing two
  // rows. Live IMSLP has never sent a duplicate — this makes the panel hold the
  // invariant anyway instead of trusting the API to.
  it("survives a response that repeats a title, with no duplicate React key", async () => {
    const keyWarnings: unknown[][] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        if (String(args[0] ?? "").includes("same key")) keyWarnings.push(args);
      });

    const DUPLICATED = ["Scherzo No.1, Op.20 (Chopin, Frédéric)"]
      .flatMap((title) => [title, title])
      .concat("Scherzo No.2, Op.31 (Chopin, Frédéric)")
      .map((title, index) => ({
        title,
        page_id: 0,
        snippet: `row ${index}`,
        size: 1,
        word_count: 1,
        is_redirect: false,
      }));
    mock({ imslp_search: DUPLICATED });
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search IMSLP"), {
      target: { value: "chopin scherzo" },
    });
    await tick(500);

    // The repeat collapsed: two rows, not three, and the count agrees.
    const rows = screen.getAllByRole("button", { name: /Scherzo No\./ });
    expect(rows).toHaveLength(2);
    expect(screen.getByText(/2 results for/)).toBeTruthy();
    expect(rows[0].textContent).toContain("row 0"); // first occurrence kept

    // One click presses exactly one row — the bug was BOTH going aria-pressed.
    fireEvent.click(rows[0]);
    await tick(0);
    expect(
      screen
        .getAllByRole("button", { name: /Scherzo No\./ })
        .filter((b) => b.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(1);

    expect(keyWarnings).toEqual([]);
    consoleError.mockRestore();
  });

  it("drops the previous work's editions when a new query is typed", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");
    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(500);
    fireEvent.click(screen.getByText("Nocturnes, Op.9 (Chopin)"));
    await tick(0);
    expect(screen.getByText("Download in your browser")).toBeTruthy();

    // A new search must not leave the old work's download button on screen.
    fireEvent.change(box, { target: { value: "liszt" } });
    await tick(500);
    expect(screen.queryByText("Download in your browser")).toBeNull();
  });

  it("returns to idle when the query is cleared", async () => {
    mock();
    render(<AddScore onImported={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText("Search IMSLP");
    fireEvent.change(box, { target: { value: "chopin" } });
    await tick(500);
    expect(screen.getByText("Nocturnes, Op.9 (Chopin)")).toBeTruthy();

    fireEvent.change(box, { target: { value: "  " } });
    await tick(500);
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

// ---------------------------------------------------------------------------
// Request-budget measurement for search-as-you-type.
//
// This is the regression that came back: a 250ms debounce fired one request per
// KEYSTROKE for anyone typing slower than ~4 chars/second, and every one of them
// queued behind the Rust client's ≥1s rate guard, so the query the user actually
// wanted started last. Measured on the shipped 250ms component: "chopin scherzo"
// at 300ms/char = 14 requests ⇒ ≥13s before the newest search could begin.
//
// The five patterns below are the traces that measurement used, replayed against
// a backend model that mirrors `imslp.rs` exactly: a reserved slot every
// RATE_GUARD_MS plus a ROUND_TRIP_MS wire time (live IMSLP answered in 0.23–0.31s
// on 2026-07-30). The last two type SLOWER than the debounce on purpose: past
// that point the debounce does nothing, and it is the one-at-a-time cap that has
// to keep the budget bounded and the final query prompt.
// ---------------------------------------------------------------------------

/** `MIN_REQUEST_SPACING` in src-tauri/src/imslp.rs. */
const RATE_GUARD_MS = 1000;
/** Live IMSLP round trip, measured 2026-07-30 (0.23–0.31s); the pessimistic end. */
const ROUND_TRIP_MS = 310;

const BUDGET_HITS = [
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

/** Every inter-keystroke gap the same. */
const evenGaps = (text: string, ms: number) =>
  Array.from({ length: Math.max(0, text.length - 1) }, () => ms);

/** Fast within words, a longer think-pause after each space. */
const wordPausedGaps = (text: string, fast: number, pause: number) =>
  Array.from({ length: Math.max(0, text.length - 1) }, (_, i) =>
    text[i] === " " ? pause : fast,
  );

/** Deterministic jitter (seeded LCG) uniform over 180–350ms, mean ≈ 265ms. */
function jitteredGaps(text: string): number[] {
  let seed = 20260730;
  return Array.from({ length: Math.max(0, text.length - 1) }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 180 + (seed % 171);
  });
}

interface Measurement {
  /** Every imslp_search query issued, in order. */
  requests: string[];
  /** ms from the LAST keystroke to the final query's request going out. */
  finalRequestMs: number;
  /** ms from the LAST keystroke to the final query's results being on screen. */
  finalResultMs: number;
}

async function measureTyping(
  text: string,
  gaps: number[],
): Promise<Measurement> {
  const requests: { query: string; at: number }[] = [];
  // Mirrors imslp.rs `RequestQueue::reserve_slot`: each request takes the next
  // free slot and pushes the following one out by the spacing interval.
  let nextSlot = 0;
  invokeMock.mockImplementation((cmd: string, args: unknown) => {
    if (cmd !== "imslp_search") return Promise.resolve(null);
    const query = String(((args ?? {}) as { query?: unknown }).query ?? "");
    const now = Date.now();
    requests.push({ query, at: now });
    const startAt = Math.max(now, nextSlot);
    nextSlot = startAt + RATE_GUARD_MS;
    return new Promise((resolve) =>
      setTimeout(() => resolve(BUDGET_HITS), startAt - now + ROUND_TRIP_MS),
    );
  });

  const { container } = render(
    <AddScore onImported={vi.fn()} onClose={vi.fn()} />,
  );
  const box = screen.getByLabelText("Search IMSLP");
  for (let i = 0; i < text.length; i += 1) {
    if (i > 0) await tick(gaps[i - 1]);
    fireEvent.change(box, { target: { value: text.slice(0, i + 1) } });
  }
  const lastKeystroke = Date.now();

  const painted = `${BUDGET_HITS.length} results for “${text}”`;
  let finalResultMs = Number.POSITIVE_INFINITY;
  for (let waited = 0; waited <= 30_000; waited += 25) {
    if ((container.textContent ?? "").includes(painted)) {
      finalResultMs = Date.now() - lastKeystroke;
      break;
    }
    await tick(25);
  }

  const finalRequest = requests.find((r) => r.query === text);
  return {
    requests: requests.map((r) => r.query),
    finalRequestMs: finalRequest
      ? finalRequest.at - lastKeystroke
      : Number.POSITIVE_INFINITY,
    finalResultMs,
  };
}

describe("AddScore search-as-you-type request budget", () => {
  const PATTERNS = [
    {
      label: "120ms/char",
      text: "chopin scherzo",
      gaps: (t: string) => evenGaps(t, 120),
    },
    {
      label: "fast + 400ms word pauses",
      text: "chopin nocturne op 9",
      gaps: (t: string) => wordPausedGaps(t, 90, 400),
    },
    {
      label: "260ms/char",
      text: "chopin",
      gaps: (t: string) => evenGaps(t, 260),
    },
    {
      label: "300ms/char",
      text: "chopin scherzo",
      gaps: (t: string) => evenGaps(t, 300),
    },
    {
      label: "jittered, mean ~265ms",
      text: "rachmaninoff prelude op 23",
      gaps: jitteredGaps,
    },
    // Above the debounce, where the one-at-a-time cap — not the debounce — is
    // what keeps the budget bounded and the final query prompt.
    {
      label: "500ms/char (above the debounce)",
      text: "chopin scherzo",
      gaps: (t: string) => evenGaps(t, 500),
    },
    {
      label: "600ms/char (above the debounce)",
      text: "chopin scherzo",
      gaps: (t: string) => evenGaps(t, 600),
    },
  ];

  it("issues a bounded number of requests and the latest query always wins", async () => {
    // Measure everything first, print the table, THEN assert — the numbers are
    // the deliverable, so a regression must show them rather than hide them.
    const measured: {
      label: string;
      text: string;
      span: number;
      m: Measurement;
    }[] = [];
    for (const pattern of PATTERNS) {
      invokeMock.mockReset();
      const gaps = pattern.gaps(pattern.text);
      const m = await measureTyping(pattern.text, gaps);
      cleanup();
      measured.push({
        label: `${pattern.label} — “${pattern.text}”`,
        text: pattern.text,
        span: gaps.reduce((a, b) => a + b, 0),
        m,
      });
    }

    const table = measured.map(({ label, span, m }) =>
      [
        label.padEnd(56),
        `typed over ${String(span).padStart(4)}ms`,
        `requests ${String(m.requests.length).padStart(2)}`,
        `final query out +${String(m.finalRequestMs).padStart(4)}ms`,
        `results +${String(m.finalResultMs).padStart(4)}ms`,
      ].join(" | "),
    );
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(`\nsearch-as-you-type request budget\n${table.join("\n")}\n`);

    for (const { label, text, span, m } of measured) {
      // The query the user ended on is always the last one requested…
      expect(m.requests.at(-1), label).toBe(text);
      // …and it is on screen within one extra rate-guard slot of typing
      // stopping. (Never a 13-second wait behind dead requests.)
      expect(m.finalResultMs, label).toBeLessThanOrEqual(
        2 * (RATE_GUARD_MS + ROUND_TRIP_MS),
      );
      // Never one request per keystroke — that is the defect being fixed.
      expect(m.requests.length, label).toBeLessThan(text.length);
      // With one call on the wire at a time, the floor on request spacing is the
      // round trip, not the keystroke rate: `span` ms of typing can cost at most
      // one request per round trip, plus the final one after typing stops.
      expect(m.requests.length, label).toBeLessThanOrEqual(
        Math.ceil(span / ROUND_TRIP_MS) + 1,
      );
    }
  });

  it("collapses every real typing trace into a single request", async () => {
    // The five traces measured on the 250ms build (1, 4, 6, 14 and 17 requests)
    // all sit below the 450ms debounce, so each now costs exactly one.
    for (const pattern of PATTERNS.slice(0, 5)) {
      invokeMock.mockReset();
      const m = await measureTyping(pattern.text, pattern.gaps(pattern.text));
      cleanup();
      expect({ label: pattern.label, requests: m.requests }).toEqual({
        label: pattern.label,
        requests: [pattern.text],
      });
    }
  });
});
