import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceFolder, PieceSummary } from "./types";

export type LibraryLocation = "all" | "unfiled" | number;
type LibraryStatus = "active" | "completed" | "archived";

interface PieceLibraryProps {
  pieces: PieceSummary[];
  folders: PieceFolder[];
  location: LibraryLocation;
  onLocationChange: (location: LibraryLocation) => void;
  onOpen: (id: number) => void;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}

type FolderEditor =
  | { mode: "create"; parentId: number | null; name: string }
  | { mode: "rename"; id: number; name: string }
  | null;

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}

export function PieceLibrary({
  pieces,
  folders,
  location,
  onLocationChange,
  onOpen,
  onReload,
  onError,
}: PieceLibraryProps) {
  const [status, setStatus] = useState<LibraryStatus>("active");
  const [menuPieceId, setMenuPieceId] = useState<number | null>(null);
  const [manageFolderId, setManageFolderId] = useState<number | null>(null);
  const [folderEditor, setFolderEditor] = useState<FolderEditor>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (menuPieceId == null && manageFolderId == null) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuPieceId(null);
      setManageFolderId(null);
      setConfirmRemove(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [manageFolderId, menuPieceId]);

  const visible = useMemo(() => {
    const folderIds =
      typeof location === "number"
        ? new Set([location, ...descendantIds(folders, location)])
        : null;
    return pieces
      .filter((piece) => {
        if (status === "archived") return piece.archived_at != null;
        if (piece.archived_at != null) return false;
        if (status === "completed") return piece.completed_at != null;
        return piece.completed_at == null;
      })
      .filter((piece) => {
        if (location === "all") return true;
        if (location === "unfiled") return piece.folder_id == null;
        return piece.folder_id != null && folderIds?.has(piece.folder_id);
      })
      .sort(recentFirst);
  }, [folders, location, pieces, status]);

  const mutate = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await onReload();
      setMenuPieceId(null);
      setManageFolderId(null);
      setConfirmRemove(null);
      setConfirmFolderDelete(null);
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveFolder = async () => {
    if (!folderEditor || !folderEditor.name.trim()) return;
    const editor = folderEditor;
    await mutate(() =>
      editor.mode === "create"
        ? invoke("piece_folder_create", {
            name: editor.name.trim(),
            parentId: editor.parentId,
          })
        : invoke("piece_folder_rename", {
            id: editor.id,
            name: editor.name.trim(),
          }),
    );
    setFolderEditor(null);
  };

  const statusCounts = {
    active: pieces.filter((piece) => piece.archived_at == null && piece.completed_at == null).length,
    completed: pieces.filter((piece) => piece.archived_at == null && piece.completed_at != null).length,
    archived: pieces.filter((piece) => piece.archived_at != null).length,
  };

  return (
    <div className="piece-library-layout">
      <aside className="piece-folder-rail" aria-label="Piece folders">
        <div className="piece-folder-head">
          <strong>Folders</strong>
          <button
            type="button"
            aria-label={typeof location === "number" ? "Add subfolder" : "Add folder"}
            onClick={() =>
              setFolderEditor({
                mode: "create",
                parentId: typeof location === "number" ? location : null,
                name: "",
              })
            }
          >
            +
          </button>
        </div>
        <button
          type="button"
          aria-label="All Pieces"
          className={`piece-folder-row${location === "all" ? " is-selected" : ""}`}
          aria-pressed={location === "all"}
          onClick={() => onLocationChange("all")}
        >
          <span>All Pieces</span><small>{pieces.length}</small>
        </button>
        <button
          type="button"
          aria-label="Unfiled"
          className={`piece-folder-row${location === "unfiled" ? " is-selected" : ""}`}
          aria-pressed={location === "unfiled"}
          onClick={() => onLocationChange("unfiled")}
        >
          <span>Unfiled</span>
          <small>{pieces.filter((piece) => piece.folder_id == null).length}</small>
        </button>
        <div className="piece-folder-tree">
          {folderTree(folders).map(({ folder, depth }) => (
            <div key={folder.id} className="piece-folder-node" style={{ paddingLeft: `${depth * 0.85}rem` }}>
              <button
                type="button"
                aria-label={folder.name}
                className={`piece-folder-row${location === folder.id ? " is-selected" : ""}`}
                aria-pressed={location === folder.id}
                onClick={() => onLocationChange(folder.id)}
              >
                <span>{folder.name}</span>
                <small>{pieces.filter((piece) => piece.folder_id === folder.id).length}</small>
              </button>
              <button
                type="button"
                className="piece-folder-more"
                aria-label={`Folder actions for ${folder.name}`}
                aria-expanded={manageFolderId === folder.id}
                onClick={() => setManageFolderId((current) => current === folder.id ? null : folder.id)}
              >
                ⋯
              </button>
              {manageFolderId === folder.id && (
                <div ref={menuRef} className="piece-context-menu piece-folder-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => setFolderEditor({ mode: "create", parentId: folder.id, name: "" })}>New subfolder</button>
                  <button type="button" role="menuitem" onClick={() => setFolderEditor({ mode: "rename", id: folder.id, name: folder.name })}>Rename</button>
                  <label className="piece-menu-move">
                    <span>Move folder to</span>
                    <select
                      aria-label={`Move ${folder.name} to folder`}
                      value={folder.parent_id ?? ""}
                      onChange={(event) => {
                        const parentId = event.target.value ? Number(event.target.value) : null;
                        void mutate(() => invoke("piece_folder_reparent", { id: folder.id, parentId }));
                      }}
                    >
                      <option value="">Top level</option>
                      {folderTree(folders)
                        .filter(({ folder: candidate }) => candidate.id !== folder.id && !descendantIds(folders, folder.id).includes(candidate.id))
                        .map(({ folder: candidate, depth: candidateDepth }) => (
                          <option key={candidate.id} value={candidate.id}>{`${"— ".repeat(candidateDepth)}${candidate.name}`}</option>
                        ))}
                    </select>
                  </label>
                  {confirmFolderDelete === folder.id ? (
                    <div className="piece-inline-confirm" role="alert">
                      <span>Delete folder? Its contents move up one level.</span>
                      <button type="button" disabled={busy} onClick={() => void mutate(() => invoke("piece_folder_delete", { id: folder.id }))}>Delete</button>
                      <button type="button" onClick={() => setConfirmFolderDelete(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmFolderDelete(folder.id)}>Delete folder…</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {folderEditor && (
          <form
            className="piece-folder-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void saveFolder();
            }}
          >
            <label>
              <span>{folderEditor.mode === "create" ? "Folder name" : "New name"}</span>
              <input
                autoFocus
                value={folderEditor.name}
                onChange={(event) => setFolderEditor({ ...folderEditor, name: event.target.value })}
              />
            </label>
            <div>
              <button type="submit" disabled={busy || !folderEditor.name.trim()}>Save</button>
              <button type="button" onClick={() => setFolderEditor(null)}>Cancel</button>
            </div>
          </form>
        )}
      </aside>

      <section className="piece-library-main">
        <div className="piece-status-tabs" role="tablist" aria-label="Piece status">
          {(["active", "completed", "archived"] as const).map((next) => (
            <button
              key={next}
              type="button"
              role="tab"
              aria-selected={status === next}
              className={status === next ? "is-selected" : ""}
              onClick={() => setStatus(next)}
            >
              {next[0].toUpperCase() + next.slice(1)} <span>{statusCounts[next]}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="pieces-empty-state">
            <p className="pieces-empty">No {status} pieces here.</p>
            <p className="pieces-empty-hint">Add a PDF, choose another folder, or switch status.</p>
          </div>
        ) : (
          <ul className="pieces-list" aria-label={`${status[0].toUpperCase() + status.slice(1)} pieces`}>
            {visible.map((piece, index) => (
              <li key={piece.id} className="piece-library-item">
                <button
                  type="button"
                  className="piece-row ck-fit-reveal"
                  aria-label={`Open ${piece.title}`}
                  onClick={() => onOpen(piece.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuPieceId(piece.id);
                  }}
                >
                  <span className="piece-row-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className="piece-row-main">
                    <span className="piece-row-title ck-fit">{piece.title}</span>
                    {piece.composer && <span className="piece-row-composer ck-fit">{piece.composer}</span>}
                  </span>
                  <span className="piece-row-badges">
                    {piece.has_pdf && <span className="piece-badge is-pdf">PDF</span>}
                    {piece.has_xml && <span className="piece-badge is-xml">XML</span>}
                    {!piece.intake_done && <span className="piece-badge is-intake">needs setup</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className="piece-row-more"
                  aria-label={`Actions for ${piece.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuPieceId === piece.id}
                  onClick={() => setMenuPieceId((current) => current === piece.id ? null : piece.id)}
                >
                  ⋯
                </button>
                {menuPieceId === piece.id && (
                  <div ref={menuRef} className="piece-context-menu" role="menu" aria-label={`Actions for ${piece.title}`}>
                    <button type="button" role="menuitem" onClick={() => onOpen(piece.id)}>Open</button>
                    <label className="piece-menu-move">
                      <span>Move to</span>
                      <select
                        aria-label={`Move ${piece.title} to folder`}
                        value={piece.folder_id ?? ""}
                        onChange={(event) => {
                          const folderId = event.target.value ? Number(event.target.value) : null;
                          void mutate(() => invoke("piece_move", { id: piece.id, folderId }));
                        }}
                      >
                        <option value="">Unfiled</option>
                        {folderTree(folders).map(({ folder, depth }) => (
                          <option key={folder.id} value={folder.id}>{`${"— ".repeat(depth)}${folder.name}`}</option>
                        ))}
                      </select>
                    </label>
                    {piece.archived_at != null ? (
                      <button type="button" role="menuitem" disabled={busy} onClick={() => void mutate(() => invoke("piece_archive_set", { id: piece.id, archived: false }))}>Restore</button>
                    ) : (
                      <>
                        <button type="button" role="menuitem" disabled={busy} onClick={() => void mutate(() => invoke("piece_complete_set", { id: piece.id, completed: piece.completed_at == null }))}>
                          {piece.completed_at == null ? "Mark complete" : "Return to active"}
                        </button>
                        <button type="button" role="menuitem" disabled={busy} onClick={() => void mutate(() => invoke("piece_archive_set", { id: piece.id, archived: true }))}>Archive</button>
                      </>
                    )}
                    {confirmRemove === piece.id ? (
                      <div className="piece-inline-confirm" role="alert">
                        <span>Remove this piece? Its practice history stays in History.</span>
                        <button type="button" disabled={busy} onClick={() => void mutate(() => invoke("piece_remove", { id: piece.id }))}>Remove</button>
                        <button type="button" onClick={() => setConfirmRemove(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmRemove(piece.id)}>Remove…</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function folderTree(folders: PieceFolder[], parentId: number | null = null, depth = 0): { folder: PieceFolder; depth: number }[] {
  return folders
    .filter((folder) => folder.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .flatMap((folder) => [{ folder, depth }, ...folderTree(folders, folder.id, depth + 1)]);
}

function descendantIds(folders: PieceFolder[], id: number): number[] {
  const direct = folders.filter((folder) => folder.parent_id === id).map((folder) => folder.id);
  return direct.flatMap((child) => [child, ...descendantIds(folders, child)]);
}

function recentFirst(a: PieceSummary, b: PieceSummary): number {
  const aTime = a.last_practiced ? Date.parse(a.last_practiced) : 0;
  const bTime = b.last_practiced ? Date.parse(b.last_practiced) : 0;
  return bTime - aTime || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id - b.id;
}
