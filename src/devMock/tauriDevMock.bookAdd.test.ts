import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// Books panel (D3): `book_add`/`book_remove` had zero coverage anywhere in
// src/ — every existing books-panel test (e.g. TodayWorkspace.test.tsx via
// book_excerpt) stubs `@tauri-apps/api/core` with `vi.mock`, which never
// executes this file's code at all. This proves the mock's OWN validation
// (mirroring the real `brain::add_book` contract: title required, only .md
// accepted) actually rejects the same way native does, and that a successful
// add/remove round-trips through `books_list`.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockBook {
  id: string;
  file_name: string;
  title: string;
  author: string;
  kind: string;
  available: boolean;
}

describe("dev-mock book_add / book_remove handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("rejects a book with no title", async () => {
    await expect(
      seamInvoke("book_add", {
        path: "/vault/Knowledge/notes.md",
        title: "",
        author: "Someone",
        kind: "practice-method",
      }),
    ).rejects.toBe("A book needs a title.");
  });

  it("rejects a non-.md source file", async () => {
    await expect(
      seamInvoke("book_add", {
        path: "/vault/Knowledge/scan.pdf",
        title: "Scanned Notes",
        author: "Someone",
        kind: "practice-method",
      }),
    ).rejects.toBe("Only Markdown (.md) files can be added to the library.");
  });

  it("adds a valid book and it appears in books_list", async () => {
    const added = await seamInvoke<MockBook>("book_add", {
      path: "/vault/Knowledge/new-method.md",
      title: "A New Method",
      author: "A. Pedagogue",
      kind: "practice-method",
    });
    expect(added.title).toBe("A New Method");
    expect(added.file_name).toBe("new-method.md");
    expect(added.available).toBe(true);

    const list = await seamInvoke<MockBook[]>("books_list");
    expect(list.some((book) => book.id === added.id)).toBe(true);
  });

  it("removes a book so it no longer appears in books_list", async () => {
    const added = await seamInvoke<MockBook>("book_add", {
      path: "/vault/Knowledge/removable.md",
      title: "Removable",
      author: "A. Pedagogue",
      kind: "practice-method",
    });
    await seamInvoke("book_remove", { id: added.id });

    const list = await seamInvoke<MockBook[]>("books_list");
    expect(list.some((book) => book.id === added.id)).toBe(false);
  });
});
