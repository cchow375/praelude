import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceDetailData, PieceFolder } from "./types";

interface AddPieceProps {
  folders?: PieceFolder[];
  initialFolderId?: number | null;
  onImported: (piece: PieceDetailData) => void;
  onClose: () => void;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}

function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The low-friction library intake: name it, choose or drop a PDF, add it. */
export function AddPiece({
  folders = [],
  initialFolderId = null,
  onImported,
  onClose,
}: AddPieceProps) {
  const [title, setTitle] = useState("");
  const [composer, setComposer] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<number | null>(initialFolderId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const folderOptions = useMemo(() => flattenFolders(folders), [folders]);

  const choosePdf = useCallback(async () => {
    setError(null);
    try {
      const path = await invoke<string | null>("pick_import_file");
      if (path) setSourcePath(path);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const addPiece = useCallback(async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Give the piece a title.");
      return;
    }
    if (!sourcePath) {
      setError("Choose a PDF first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const piece = await invoke<PieceDetailData>("piece_create_from_pdf", {
        title: cleanTitle,
        composer: composer.trim() || null,
        sourcePath,
        folderId,
      });
      onImported(piece);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }, [composer, folderId, onImported, sourcePath, title]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const off = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDragging(true);
            return;
          }
          if (event.payload.type === "leave") {
            setDragging(false);
            return;
          }
          setDragging(false);
          const path = event.payload.paths?.[0];
          if (path) setSourcePath(path);
        });
        if (cancelled) off();
        else unlisten = off;
      } catch {
        // Tests and plain-browser review have no native webview drop surface.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const openImslp = useCallback(async () => {
    setError(null);
    try {
      await invoke("piece_open_source_url", { url: "https://imslp.org" });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  return (
    <section className="add-score" aria-label="Add a piece">
      <div className="add-score-head">
        <div>
          <p className="ck-kicker">New library item</p>
          <h3 className="add-score-title">Add a piece</h3>
        </div>
        <button type="button" className="ck-back" onClick={onClose}>Cancel</button>
      </div>
      <div className="add-piece-fields">
        <label>
          <span>Title</span>
          <input autoFocus required type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Clair de lune" />
        </label>
        <label>
          <span>Composer <small>optional</small></span>
          <input type="text" value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="e.g. Claude Debussy" />
        </label>
        {folders.length > 0 && (
          <label>
            <span>Folder <small>optional</small></span>
            <select aria-label="Piece folder" value={folderId ?? ""} onChange={(event) => setFolderId(event.target.value ? Number(event.target.value) : null)}>
              <option value="">Unfiled</option>
              {folderOptions.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>{`${"— ".repeat(depth)}${folder.name}`}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={`add-piece-drop${dragging ? " is-dragging" : ""}${sourcePath ? " has-file" : ""}`}>
        <span className="add-piece-file-glyph" aria-hidden="true">PDF</span>
        {sourcePath ? (
          <><strong>{pathBasename(sourcePath)}</strong><span>Ready to add</span></>
        ) : (
          <><strong>Choose your sheet-music PDF</strong><span>or drag the file anywhere onto this window</span></>
        )}
        <button type="button" className="add-score-pick" onClick={choosePdf}>{sourcePath ? "Choose another PDF" : "Choose PDF"}</button>
      </div>
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
      <div className="add-piece-actions">
        <button type="button" className="add-piece-submit" disabled={saving} onClick={() => void addPiece()}>{saving ? "Adding…" : "Add Piece"}</button>
        <button type="button" className="add-piece-imslp" onClick={openImslp}>Find a public-domain score on IMSLP ↗</button>
        <p>Download it there, then return here and choose the PDF.</p>
      </div>
    </section>
  );
}

function flattenFolders(folders: PieceFolder[], parentId: number | null = null, depth = 0): { folder: PieceFolder; depth: number }[] {
  return folders
    .filter((folder) => folder.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .flatMap((folder) => [{ folder, depth }, ...flattenFolders(folders, folder.id, depth + 1)]);
}
