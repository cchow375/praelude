import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceFolder, PieceSummary } from "./types";
import { coverPalette, normalizePieceSearch, preparePieceCover } from "./pieceCovers";
import { LibraryMenu } from "./LibraryMenu";

export type LibraryLocation = "all" | "unfiled" | number;
type LibraryStatus = "active" | "completed" | "archived";
const STATUS_LABELS: Record<LibraryStatus, string> = { active: "Active", completed: "Completed", archived: "Resting" };
const PAGE_SIZE = 24;

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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
  const [covers, setCovers] = useState<Record<number, string>>({});
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverNotice, setCoverNotice] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia?.("(max-width: 760px)").matches ?? false);
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const coverTargetRef = useRef<number | null>(null);
  const coverVersions = useRef<Record<number, number>>({});
  const actionTriggers = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => setPageLimit(PAGE_SIZE), [location, query, sort, status]);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const change = () => setCompact(media.matches);
    change();
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, []);

  const closeMenu = (restoreFocus = true) => {
    const key = menuPieceId != null ? `piece-${menuPieceId}` : `folder-${manageFolderId}`;
    setMenuPieceId(null);
    setManageFolderId(null);
    setConfirmRemove(null);
    setConfirmFolderDelete(null);
    if (restoreFocus) actionTriggers.current.get(key)?.focus({ preventScroll: true });
  };

  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLSelectElement) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)'));
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  };

  useEffect(() => {
    if (menuPieceId != null || manageFolderId != null) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [manageFolderId, menuPieceId]);

  useEffect(() => {
    if (menuPieceId == null && manageFolderId == null) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if ([...actionTriggers.current.values()].some((trigger) => trigger.contains(event.target as Node))) return;
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
      .filter((piece) => normalizePieceSearch(`${piece.title} ${piece.composer ?? ""}`).includes(normalizePieceSearch(query)))
      .sort(sort === "title" ? (a, b) => a.title.localeCompare(b.title) : sort === "composer" ? (a, b) => (a.composer ?? "").localeCompare(b.composer ?? "") || a.title.localeCompare(b.title) : recentFirst);
  }, [folders, location, pieces, query, sort, status]);

  const shown = useMemo(() => visible.slice(0, pageLimit), [pageLimit, visible]);
  const shownIds = shown.map((piece) => piece.id).join(",");
  useEffect(() => {
    let cancelled = false;
    const ids = shownIds ? shownIds.split(",").map(Number) : [];
    const versions = { ...coverVersions.current };
    void (async () => {
      try {
        const loaded: Record<number, string> = {};
        for (let offset = 0; offset < ids.length; offset += 48) {
          Object.assign(loaded, await invoke<Record<number, string>>("piece_covers_get", { ids: ids.slice(offset, offset + 48) }));
        }
        if (!cancelled) {
          setCovers((current) => {
            const next = { ...current };
            for (const id of ids) if ((versions[id] ?? 0) === (coverVersions.current[id] ?? 0)) {
              if (loaded[id]) next[id] = loaded[id];
              else delete next[id];
            }
            return next;
          });
          setCoverError(null);
        }
      } catch {
        if (!cancelled) setCoverError("Your custom covers could not be loaded. Your scores are still available.");
      }
    })();
    return () => { cancelled = true; };
  }, [shownIds]);

  const saveCover = async (id: number, file: File | null) => {
    if (busy) return;
    setBusy(true);
    setCoverNotice(null);
    try {
      const dataUrl = file ? await preparePieceCover(file) : null;
      await invoke("piece_cover_set", { id, dataUrl });
      coverVersions.current[id] = (coverVersions.current[id] ?? 0) + 1;
      setCovers((current) => {
        const next = { ...current };
        if (dataUrl) next[id] = dataUrl;
        else delete next[id];
        return next;
      });
      setCoverNotice(file ? "Cover saved." : "Original cover restored.");
      setCoverError(null);
      closeMenu();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      await onReload();
      setMenuPieceId(null);
      setManageFolderId(null);
      setConfirmRemove(null);
      setConfirmFolderDelete(null);
      return true;
    } catch (cause) {
      onError(messageOf(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveFolder = async () => {
    if (!folderEditor || !folderEditor.name.trim()) return;
    const editor = folderEditor;
    const saved = await mutate(() =>
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
    if (saved) setFolderEditor(null);
  };

  const statusCounts = {
    active: pieces.filter((piece) => piece.archived_at == null && piece.completed_at == null).length,
    completed: pieces.filter((piece) => piece.archived_at == null && piece.completed_at != null).length,
    archived: pieces.filter((piece) => piece.archived_at != null).length,
  };

  return (
    <div className="piece-library-layout">
      <input ref={coverInputRef} className="piece-cover-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a piece cover image" onChange={(event) => {
        const file = event.target.files?.[0];
        const id = coverTargetRef.current;
        event.target.value = "";
        if (file && id != null) void saveCover(id, file);
      }} />
      <aside className="piece-folder-rail" aria-label="Piece folders">
        <div className="piece-folder-head">
          {compact ? <button type="button" className="piece-folder-toggle" aria-label="Show piece folders" aria-expanded={foldersExpanded} onClick={() => setFoldersExpanded((value) => !value)}>Folders <span aria-hidden="true">{foldersExpanded ? "⌃" : "⌄"}</span></button> : <strong>Folders</strong>}
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
        <div className="piece-folder-tree" hidden={compact && !foldersExpanded}>
          {folderTree(folders).map(({ folder, depth }) => (
            <div key={folder.id} className="piece-folder-node" style={{ paddingLeft: `${depth * 0.85}rem` }}>
              <button
                type="button"
                aria-label={folder.name}
                className={`piece-folder-row${location === folder.id ? " is-selected" : ""}`}
                aria-pressed={location === folder.id}
                onClick={() => { onLocationChange(folder.id); if (compact) setFoldersExpanded(false); }}
              >
                <span>{folder.name}</span>
                <small>{pieces.filter((piece) => piece.folder_id === folder.id).length}</small>
              </button>
              <button
                type="button"
                className="piece-folder-more"
                ref={(node) => { if (node) actionTriggers.current.set(`folder-${folder.id}`, node); else actionTriggers.current.delete(`folder-${folder.id}`); }}
                aria-label={`Folder actions for ${folder.name}`}
                aria-expanded={manageFolderId === folder.id}
                onClick={() => { setMenuPieceId(null); setManageFolderId((current) => current === folder.id ? null : folder.id); }}
              >
                ⋯
              </button>
              {manageFolderId === folder.id && (
                <LibraryMenu menuRef={menuRef} anchor={actionTriggers.current.get(`folder-${folder.id}`) ?? null} folder label={`Actions for folder ${folder.name}`} onKeyDown={menuKeys} onFocusLeave={() => closeMenu(false)}>
                  <button type="button" role="menuitem" onClick={() => { closeMenu(false); setFolderEditor({ mode: "create", parentId: folder.id, name: "" }); }}>New subfolder</button>
                  <button type="button" role="menuitem" onClick={() => { closeMenu(false); setFolderEditor({ mode: "rename", id: folder.id, name: folder.name }); }}>Rename</button>
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
                </LibraryMenu>
              )}
            </div>
          ))}
        </div>
        {compact && !foldersExpanded && typeof location === "number" && <span className="piece-folder-current">{folders.find((folder) => folder.id === location)?.name}</span>}
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
        <div className="piece-library-toolbar">
          <label className="piece-library-search">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <input type="search" aria-label="Search pieces" placeholder="Search title or composer" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && visible.length === 1) onOpen(visible[0].id); }} />
          </label>
          <select className="piece-library-sort" aria-label="Sort pieces" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">Recently practiced</option><option value="title">Title</option><option value="composer">Composer</option>
          </select>
          <div className="piece-library-view" role="group" aria-label="Library layout">
            <button type="button" aria-label="Cover grid" aria-pressed={view === "grid"} title="Cover grid" onClick={() => setView("grid")}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></svg></button>
            <button type="button" aria-label="Compact list" aria-pressed={view === "list"} title="Compact list" onClick={() => setView("list")}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10M3 5h1M3 10h1M3 15h1"/></svg></button>
          </div>
        </div>
        <div className="piece-status-tabs" role="tablist" aria-label="Piece status">
          {(["active", "completed", "archived"] as const).map((next) => (
            <button
              key={next}
              type="button"
              role="tab"
              aria-selected={status === next}
              className={status === next ? "is-selected" : ""}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
                const current = tabs.indexOf(event.currentTarget);
                const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
                tabs[index]?.click();
                tabs[index]?.focus();
              }}
              onClick={() => { setStatus(next); setMenuPieceId(null); }}
            >
              {STATUS_LABELS[next]} <span>{statusCounts[next]}</span>
            </button>
          ))}
        </div>
        {status === "archived" && <p className="piece-library-rest-hint">Give these pieces a rest. Your scores and practice history stay here, ready whenever you are.</p>}
        {coverError && <p className="ck-inline-error" role="status">{coverError}</p>}
        <span className="piece-cover-notice" role="status">{busy ? "Saving…" : coverNotice}</span>

        {visible.length === 0 ? (
          <div className="pieces-empty-state">
            <span className="piece-empty-glyph" aria-hidden="true">♫</span>
            <p className="pieces-empty">{query ? "No matching pieces" : status === "archived" ? "Nothing resting here" : pieces.length === 0 ? "Your next piece starts here" : `No ${status} pieces here`}</p>
            <p className="pieces-empty-hint">{query ? "Try another title or composer, or check a different status." : status === "archived" ? "Use a piece’s menu to put it to rest and keep your active library focused." : "Add a PDF, choose another folder, or switch status."}</p>
            {query && <button type="button" className="piece-library-clear" onClick={() => setQuery("")}>Clear search</button>}
          </div>
        ) : (
          <ul className={`pieces-list piece-collection is-${view}`} aria-label={`${STATUS_LABELS[status]} pieces`}>
            {shown.map((piece) => (
              <li key={piece.id} className="piece-library-item">
                <button
                  type="button"
                  className="piece-row ck-fit-reveal"
                  aria-label={`Open ${piece.title}`}
                  onClick={() => onOpen(piece.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setManageFolderId(null);
                    setMenuPieceId(piece.id);
                  }}
                >
                  <span className={`piece-cover palette-${coverPalette(piece.title, piece.composer)}`} aria-hidden="true">
                    {covers[piece.id] ? <img src={covers[piece.id]} alt="" loading="lazy" decoding="async" onError={() => {
                      setCovers((current) => { const next = { ...current }; delete next[piece.id]; return next; });
                      setCoverError("A custom cover could not be displayed. You can choose another image from the piece’s menu.");
                    }} /> : <>
                      <span className="piece-cover-lines" /><span className="piece-cover-orbit" />
                      <span className="piece-cover-letter">{(piece.composer?.trim() || piece.title.trim()).slice(0, 1)}</span>
                      <span className="piece-cover-caption">PRAELUDE · SCORE</span>
                    </>}
                  </span>
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
                  ref={(node) => { if (node) actionTriggers.current.set(`piece-${piece.id}`, node); else actionTriggers.current.delete(`piece-${piece.id}`); }}
                  aria-label={`Actions for ${piece.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuPieceId === piece.id}
                  onClick={() => { setManageFolderId(null); setMenuPieceId((current) => current === piece.id ? null : piece.id); }}
                >
                  ⋯
                </button>
                {menuPieceId === piece.id && (
                  <LibraryMenu menuRef={menuRef} anchor={actionTriggers.current.get(`piece-${piece.id}`) ?? null} label={`Actions for ${piece.title}`} onKeyDown={menuKeys} onFocusLeave={() => closeMenu(false)}>
                    <button type="button" role="menuitem" onClick={() => onOpen(piece.id)}>Open</button>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { coverTargetRef.current = piece.id; coverInputRef.current?.click(); }}>{covers[piece.id] ? "Change cover…" : "Choose cover…"}</button>
                    {covers[piece.id] && <button type="button" role="menuitem" disabled={busy} onClick={() => void saveCover(piece.id, null)}>Reset cover</button>}
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
                        <button type="button" role="menuitem" disabled={busy} onClick={() => void mutate(() => invoke("piece_archive_set", { id: piece.id, archived: true }))}>Put to rest</button>
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
                  </LibraryMenu>
                )}
              </li>
            ))}
          </ul>
        )}
        {visible.length > PAGE_SIZE && <div className="piece-library-pagination"><span>Showing {shown.length} of {visible.length} pieces</span>{shown.length < visible.length && <button type="button" onClick={() => setPageLimit((limit) => limit + PAGE_SIZE)}>Show more</button>}</div>}
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
