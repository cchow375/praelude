import { useEffect, useState, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useReceipts } from "../receipts/ReceiptCenter";
import { commandErrorMessage } from "../../services/command";
import { Button, Dialog } from "../../ui";

// The three kebab-case wire values the backend accepts (contract:
// .workflow/scratch/books-contract.md). Shown to the user as plain words.
export type BookKind = "practice-method" | "composer-life" | "interpretation";

/** One manifest book as the backend returns it (snake_case fields, AS-IS). */
export interface BookRecord {
  id: string;
  file_name: string;
  title: string;
  author: string;
  kind: BookKind;
  visual_dependency: boolean;
  available: boolean;
}

export interface BooksApi {
  list: () => Promise<BookRecord[]>;
  add: (input: {
    path: string;
    title: string;
    author: string;
    kind: BookKind;
  }) => Promise<BookRecord>;
  remove: (id: string) => Promise<void>;
}

const defaultBooksApi: BooksApi = {
  list: () => invoke("books_list"),
  add: ({ path, title, author, kind }) =>
    invoke("book_add", { path, title, author, kind }),
  remove: (id) => invoke("book_remove", { id }),
};

const KIND_OPTIONS: BookKind[] = [
  "practice-method",
  "composer-life",
  "interpretation",
];
const KIND_LABELS: Record<BookKind, string> = {
  "practice-method": "practice methods",
  "composer-life": "composer life",
  interpretation: "interpretation",
};

export function BooksPanel({ api = defaultBooksApi }: { api?: BooksApi }) {
  const receipts = useReceipts();
  const [books, setBooks] = useState<BookRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [kind, setKind] = useState<BookKind>("practice-method");
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addReceipt, setAddReceipt] = useState<string | null>(null);

  const [removing, setRemoving] = useState<BookRecord | null>(null);

  useEffect(() => {
    let active = true;
    api
      .list()
      .then((next) => {
        if (active) setBooks(next);
      })
      .catch((cause) => {
        if (active) setLoadError(commandErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [api]);

  // `add` fires from a click, an Enter keypress, or (defensively) a future
  // form submit — all it needs from the event is preventDefault.
  const add = async (event: { preventDefault?: () => void }) => {
    event.preventDefault?.();
    if (adding) return;
    setAddError(null);
    setAddReceipt(null);
    const trimmedPath = path.trim();
    const trimmedTitle = title.trim();
    // Client-side gate: catch the obvious mistakes before a round trip. The
    // backend is still the authority (non-UTF-8, >5 MB, unreadable, duplicate).
    if (!trimmedTitle) {
      setAddError("A title is required.");
      return;
    }
    if (!trimmedPath) {
      setAddError("Choose a .md file to add.");
      return;
    }
    if (!trimmedPath.toLowerCase().endsWith(".md")) {
      setAddError("Only Markdown (.md) files can be added.");
      return;
    }
    setAdding(true);
    try {
      const added = await api.add({
        path: trimmedPath,
        title: trimmedTitle,
        author: author.trim(),
        kind,
      });
      setBooks((current) => [...(current ?? []), added]);
      setAddReceipt(`Added “${added.title}.”`);
      receipts.committed(`Added “${added.title}.”`);
      setPath("");
      setTitle("");
      setAuthor("");
      setKind("practice-method");
    } catch (cause) {
      const message = commandErrorMessage(cause);
      setAddError(message);
      receipts.error(cause, message);
    } finally {
      setAdding(false);
    }
  };

  // Enter-to-submit on every plain text input in the "Add a book" group — the
  // <form> this group used to be gave every text input this for free; wire it
  // back explicitly now that the group is a <div role="group">. (Kind is a
  // <select>, which browsers never Enter-submit, so it's excluded on purpose.)
  const onEnterSubmit = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add(event);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const target = removing;
    try {
      await api.remove(target.id);
      setBooks((current) =>
        (current ?? []).filter((book) => book.id !== target.id),
      );
      receipts.committed(`Removed “${target.title}.”`);
      setRemoving(null);
    } catch (cause) {
      // Rethrow so the dialog keeps the verbatim error in front of the user.
      throw cause;
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = extractDroppedPath(event.dataTransfer);
    if (dropped) setPath(dropped);
  };

  return (
    <div className="settings-group books-panel">
      <BookList books={books} loadError={loadError} onRemove={setRemoving} />

      <div className="books-add" role="group" aria-label="Add a book">
        <div
          className={`books-drop${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <label className="settings-row settings-wide">
            <span>Markdown file</span>
            <input
              aria-label="Markdown file path"
              placeholder="Drop a .md file here, or paste its full path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={onEnterSubmit}
            />
          </label>
        </div>
        <label className="settings-row settings-wide">
          <span>Title</span>
          <input
            aria-label="Book title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={onEnterSubmit}
          />
        </label>
        <label className="settings-row settings-wide">
          <span>Author</span>
          <input
            aria-label="Book author"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            onKeyDown={onEnterSubmit}
          />
        </label>
        <label className="settings-row">
          <span>Kind</span>
          <select
            aria-label="Book kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as BookKind)}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <div className="books-add-actions">
          <Button
            variant="primary"
            type="button"
            disabled={adding}
            onClick={(event) => void add(event)}
          >
            {adding ? "Adding…" : "Add book"}
          </Button>
        </div>
        {addError && (
          <p className="ck-inline-error" role="alert">
            {addError}
          </p>
        )}
        {addReceipt && (
          <p className="settings-success" role="status">
            {addReceipt}
          </p>
        )}
      </div>

      <RemoveDialog
        book={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function BookList({
  books,
  loadError,
  onRemove,
}: {
  books: BookRecord[] | null;
  loadError: string | null;
  onRemove: (book: BookRecord) => void;
}) {
  if (loadError) {
    return (
      <p className="ck-inline-error" role="alert">
        {loadError}
      </p>
    );
  }
  if (books === null) {
    return (
      <p className="settings-note" role="status">
        Loading books…
      </p>
    );
  }
  if (books.length === 0) {
    return <p className="settings-note">No books yet.</p>;
  }
  return (
    <ul className="books-list" aria-label="Books">
      {books.map((book) => (
        <li key={book.id} className="books-item">
          <div className="books-item-text">
            <strong className="books-item-title">{book.title}</strong>
            <span className="books-item-meta">
              {book.author ? `${book.author} · ` : ""}
              {KIND_LABELS[book.kind]}
            </span>
            {!book.available && (
              <span className="books-item-unavailable">file missing</span>
            )}
          </div>
          <Button
            variant="text"
            type="button"
            aria-label={`Remove ${book.title}`}
            onClick={() => onRemove(book)}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function RemoveDialog({
  book,
  onCancel,
  onConfirm,
}: {
  book: BookRecord | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the gate whenever the target book changes (open/close/switch).
  useEffect(() => {
    setTyped("");
    setError(null);
    setBusy(false);
  }, [book]);

  if (!book) return null;
  const matches = typed.trim() === book.title;

  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(commandErrorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      label={`Remove ${book.title}`}
      title={<strong>Remove “{book.title}”?</strong>}
    >
      <div className="books-remove">
        <p className="settings-note">
          The file moves to the library’s trash, not deleted.
        </p>
        <label className="settings-row settings-wide">
          <span>Type the book title to confirm</span>
          <input
            aria-label="Type the book title to confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <div className="books-remove-actions">
          <Button type="button" variant="text" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!matches || busy}
            onClick={() => void run()}
          >
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
        {error && (
          <p className="ck-inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Best-effort absolute path from a native file drop. In the Tauri webview a
 * dropped `File` carries an OS `path`; a plain browser exposes only `name`.
 * Returns null when neither is present so the paste field stays authoritative.
 */
export function extractDroppedPath(data: DataTransfer | null): string | null {
  const file = data?.files?.[0] as (File & { path?: string }) | undefined;
  if (!file) return null;
  if (typeof file.path === "string" && file.path) return file.path;
  if (file.name) return file.name;
  return null;
}
