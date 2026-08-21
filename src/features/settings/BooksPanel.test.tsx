import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BooksPanel,
  extractDroppedPath,
  type BooksApi,
  type BookRecord,
} from "./BooksPanel";

const BUILTINS: BookRecord[] = [
  {
    id: "roskell-complete-pianist",
    file_name: "the-complete-pianist.md",
    title: "The Complete Pianist",
    author: "Penelope Roskell",
    kind: "practice-method",
    visual_dependency: true,
    available: true,
  },
  {
    id: "gieseking-leimer-technique",
    file_name: "gieseking-leimer-piano-technique.md",
    title: "Piano Technique",
    author: "Walter Gieseking and Karl Leimer",
    kind: "interpretation",
    visual_dependency: true,
    available: false,
  },
];

function api(overrides: Partial<BooksApi> = {}): BooksApi {
  return {
    list: vi.fn().mockResolvedValue(BUILTINS),
    add: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe("BooksPanel", () => {
  it("renders loading, then the list with plain-word kinds and a quiet unavailable marker", async () => {
    render(<BooksPanel api={api()} />);
    expect(screen.getByText("Loading books…")).toBeTruthy();

    const list = await screen.findByRole("list", { name: "Books" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Plain words, never the kebab wire value.
    expect(within(rows[0]).getByText(/practice methods/)).toBeTruthy();
    expect(within(list).queryByText(/practice-method/)).toBeNull();
    expect(within(rows[1]).getByText(/interpretation/)).toBeTruthy();
    // available:false → one quiet marker; the available book has none.
    expect(within(rows[1]).getByText("file missing")).toBeTruthy();
    expect(within(rows[0]).queryByText("file missing")).toBeNull();
  });

  it("shows an honest empty state", async () => {
    render(<BooksPanel api={api({ list: vi.fn().mockResolvedValue([]) })} />);
    expect(await screen.findByText("No books yet.")).toBeTruthy();
  });

  it("renders a list-load failure verbatim", async () => {
    render(
      <BooksPanel
        api={api({
          list: vi.fn().mockRejectedValue("Knowledge folder is unreadable."),
        })}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Knowledge folder is unreadable.");
  });

  it("adds a book, invoking with the kebab-case kind and showing a save receipt", async () => {
    const added: BookRecord = {
      id: "added-1",
      file_name: "focus.md",
      title: "On Focus",
      author: "A. Writer",
      kind: "composer-life",
      visual_dependency: false,
      available: true,
    };
    const books = api({ add: vi.fn().mockResolvedValue(added) });
    render(<BooksPanel api={books} />);
    await screen.findByRole("list", { name: "Books" });

    fireEvent.change(screen.getByLabelText("Markdown file path"), {
      target: { value: "/vault/Knowledge/focus.md" },
    });
    fireEvent.change(screen.getByLabelText("Book title"), {
      target: { value: "On Focus" },
    });
    fireEvent.change(screen.getByLabelText("Book author"), {
      target: { value: "A. Writer" },
    });
    fireEvent.change(screen.getByLabelText("Book kind"), {
      target: { value: "composer-life" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add book" }));

    await waitFor(() =>
      expect(books.add).toHaveBeenCalledWith({
        path: "/vault/Knowledge/focus.md",
        title: "On Focus",
        author: "A. Writer",
        kind: "composer-life",
      }),
    );
    // Save receipt + the book now in the list.
    expect(await screen.findByText("Added “On Focus.”")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Books" });
    expect(within(list).getByText("On Focus")).toBeTruthy();
  });

  // B72: the removed <form> gave every text input in the group Enter-to-submit
  // for free (path, title, author — Kind is a <select>, browsers don't
  // Enter-submit those, so it's excluded). Cover all three explicitly so none
  // silently regress to a no-op Enter.
  it.each([
    "Markdown file path",
    "Book title",
    "Book author",
  ])(
    "submits on Enter in the %s field (B72 de-nest kept this working)",
    async (fieldLabel) => {
      const added: BookRecord = {
        id: "added-2",
        file_name: "focus.md",
        title: "On Focus",
        author: "A. Writer",
        kind: "practice-method",
        visual_dependency: false,
        available: true,
      };
      const books = api({ add: vi.fn().mockResolvedValue(added) });
      render(<BooksPanel api={books} />);
      await screen.findByRole("list", { name: "Books" });

      fireEvent.change(screen.getByLabelText("Markdown file path"), {
        target: { value: "/vault/Knowledge/focus.md" },
      });
      fireEvent.change(screen.getByLabelText("Book title"), {
        target: { value: "On Focus" },
      });
      fireEvent.change(screen.getByLabelText("Book author"), {
        target: { value: "A. Writer" },
      });

      fireEvent.keyDown(screen.getByLabelText(fieldLabel), { key: "Enter" });

      await waitFor(() =>
        expect(books.add).toHaveBeenCalledWith({
          path: "/vault/Knowledge/focus.md",
          title: "On Focus",
          author: "A. Writer",
          kind: "practice-method",
        }),
      );
    },
  );

  it("has no <form> in its tree (B72: the add group is a div/role=group)", async () => {
    const books = api();
    const { container } = render(<BooksPanel api={books} />);
    await screen.findByRole("list", { name: "Books" });
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByRole("group", { name: "Add a book" })).toBeTruthy();
  });

  it("validates before invoking: title required, then .md required", async () => {
    const books = api({ add: vi.fn() });
    render(<BooksPanel api={books} />);
    await screen.findByRole("list", { name: "Books" });

    // No title → gated, no invoke.
    fireEvent.click(screen.getByRole("button", { name: "Add book" }));
    expect(await screen.findByText("A title is required.")).toBeTruthy();
    expect(books.add).not.toHaveBeenCalled();

    // Title present but non-.md path → gated on extension.
    fireEvent.change(screen.getByLabelText("Book title"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByLabelText("Markdown file path"), {
      target: { value: "/vault/notes.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add book" }));
    expect(
      await screen.findByText("Only Markdown (.md) files can be added."),
    ).toBeTruthy();
    expect(books.add).not.toHaveBeenCalled();
  });

  it("renders an add failure verbatim", async () => {
    const books = api({
      add: vi.fn().mockRejectedValue("focus.md exceeds the 5 MB text limit"),
    });
    render(<BooksPanel api={books} />);
    await screen.findByRole("list", { name: "Books" });
    fireEvent.change(screen.getByLabelText("Markdown file path"), {
      target: { value: "/vault/focus.md" },
    });
    fireEvent.change(screen.getByLabelText("Book title"), {
      target: { value: "Focus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add book" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("focus.md exceeds the 5 MB text limit");
    expect(books.add).toHaveBeenCalledTimes(1);
  });

  it("gates removal on the typed book title", async () => {
    const books = api();
    render(<BooksPanel api={books} />);
    await screen.findByRole("list", { name: "Books" });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove The Complete Pianist" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Remove The Complete Pianist",
    });
    // The honest trash line is present.
    expect(
      within(dialog).getByText(/moves to the library’s trash, not deleted/),
    ).toBeTruthy();

    const confirm = within(dialog).getByRole("button", { name: "Remove" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // Wrong title stays gated.
    fireEvent.change(
      within(dialog).getByLabelText("Type the book title to confirm"),
      {
        target: { value: "wrong" },
      },
    );
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(books.remove).not.toHaveBeenCalled();

    // Exact title unlocks + invokes with the book id.
    fireEvent.change(
      within(dialog).getByLabelText("Type the book title to confirm"),
      {
        target: { value: "The Complete Pianist" },
      },
    );
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(books.remove).toHaveBeenCalledWith("roskell-complete-pianist"),
    );
    // Row is gone.
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Books" })).queryByText(
          "The Complete Pianist",
        ),
      ).toBeNull(),
    );
  });

  it("keeps a remove failure verbatim in the dialog", async () => {
    const books = api({
      remove: vi.fn().mockRejectedValue("The trash folder is not writable."),
    });
    render(<BooksPanel api={books} />);
    await screen.findByRole("list", { name: "Books" });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove The Complete Pianist" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Remove The Complete Pianist",
    });
    fireEvent.change(
      within(dialog).getByLabelText("Type the book title to confirm"),
      {
        target: { value: "The Complete Pianist" },
      },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("The trash folder is not writable.");
  });
});

describe("extractDroppedPath", () => {
  it("prefers a Tauri file path, falls back to name, else null", () => {
    const withPath = {
      files: [
        Object.assign(new File([""], "focus.md"), { path: "/vault/focus.md" }),
      ],
    } as unknown as DataTransfer;
    expect(extractDroppedPath(withPath)).toBe("/vault/focus.md");

    const nameOnly = {
      files: [new File([""], "focus.md")],
    } as unknown as DataTransfer;
    expect(extractDroppedPath(nameOnly)).toBe("focus.md");

    const empty = { files: [] } as unknown as DataTransfer;
    expect(extractDroppedPath(empty)).toBeNull();
    expect(extractDroppedPath(null)).toBeNull();
  });
});
