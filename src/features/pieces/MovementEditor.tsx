import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import type { PieceMovement } from "./types";

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Page-range starts for a multi-movement PDF. End pages are derived from the
 * next row, so editing “II starts on page 7” is all the input required. */
export function MovementEditor({ pieceId }: { pieceId: number }) {
  const [movements, setMovements] = useState<PieceMovement[]>([]);
  const [title, setTitle] = useState("");
  const [startPage, setStartPage] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMovements(
        (await invoke<PieceMovement[]>("piece_movement_list", { pieceId })) ??
          [],
      );
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [pieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const page = Number(startPage);
    if (!title.trim() || !Number.isInteger(page) || page < 1) {
      setError("Enter a movement title and a start page of 1 or later.");
      return;
    }
    setBusy(true);
    try {
      await invoke("piece_movement_create", {
        input: { piece_id: pieceId, title: title.trim(), start_page: page },
      });
      setTitle("");
      setStartPage(String(page + 1));
      await load();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="movement-editor" aria-label="PDF movements">
      <div className="piece-section-heading">
        <div>
          <span className="ck-label">PDF movements</span>
          <p>
            Add only each movement’s first PDF page. Praelude derives where it
            ends and scopes the score automatically.
          </p>
        </div>
      </div>
      <form
        className="movement-add"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          <span className="ck-label">Movement</span>
          <input
            aria-label="New movement title"
            maxLength={200}
            placeholder="I · Allegro"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span className="ck-label">Starts on PDF page</span>
          <input
            aria-label="New movement start page"
            type="number"
            min="1"
            value={startPage}
            onChange={(event) => setStartPage(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add movement"}
        </button>
      </form>
      {movements.length === 0 ? (
        <p className="history-empty">
          No movement split yet — the whole PDF stays visible.
        </p>
      ) : (
        <div className="movement-list">
          {movements.map((movement, index) => (
            <MovementRow
              key={movement.id}
              movement={movement}
              endPage={movements[index + 1]?.start_page - 1 || null}
              onChanged={load}
              onError={setError}
            />
          ))}
        </div>
      )}
      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function MovementRow({
  movement,
  endPage,
  onChanged,
  onError,
}: {
  movement: PieceMovement;
  endPage: number | null;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState(movement.title);
  const [startPage, setStartPage] = useState(String(movement.start_page));
  const [busy, setBusy] = useState(false);
  const page = Number(startPage);
  const valid =
    title.trim().length > 0 &&
    title.trim().length <= 200 &&
    Number.isInteger(page) &&
    page >= 1;
  const dirty = title.trim() !== movement.title || page !== movement.start_page;

  async function save() {
    if (!valid || !dirty) return;
    setBusy(true);
    try {
      await invoke("piece_movement_update", {
        id: movement.id,
        patch: { title: title.trim(), start_page: page },
      });
      await onChanged();
      onError(null);
    } catch (reason) {
      onError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="movement-row">
      <label>
        <span className="ck-label">Title</span>
        <input
          aria-label={`Movement title ${movement.title}`}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        <span className="ck-label">First page</span>
        <input
          aria-label={`${movement.title} start page`}
          type="number"
          min="1"
          value={startPage}
          onChange={(event) => setStartPage(event.target.value)}
        />
      </label>
      <span className="movement-range">
        pp. {movement.start_page}–{endPage ?? "end"}
      </span>
      <button type="button" disabled={!valid || !dirty || busy} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>
      <ConfirmDelete
        label={`Delete movement “${movement.title}”? The score, sections and practice history stay; its pages return to whole-score view.`}
        onConfirm={async () => {
          try {
            await invoke("piece_movement_delete", { id: movement.id });
            await onChanged();
            onError(null);
          } catch (reason) {
            onError(messageOf(reason));
          }
        }}
      >
        <button type="button" className="movement-delete">
          Delete
        </button>
      </ConfirmDelete>
    </div>
  );
}
