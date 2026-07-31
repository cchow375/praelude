import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  downloadBasename,
  matchesDownloadName,
  stripHighlightHtml,
  stripWikiTemplates,
  type Edition,
  type FileInfo,
  type WorkHit,
} from "./imslpText";

// ---------------------------------------------------------------------------
// Add a score from IMSLP. In-app search + browse, browser-assisted download,
// then file the arriving PDF into the vault. The app NEVER fetches IMSLP's
// CAPTCHA-gated file bytes — imslp_open_download hands the URL to the system
// browser and the user's browser does the download; we then import the file.
// ---------------------------------------------------------------------------

/**
 * Debounce for search-as-you-type. Deliberately short: the panel used to wait
 * 1.5s before it even *started*, which read as "the search is broken". IMSLP
 * etiquette is enforced where it belongs — the Rust client's 1s rate guard
 * between real requests (`imslp.rs`), which now runs off the UI thread.
 */
const SEARCH_DEBOUNCE_MS = 250;
/** Poll cadence for a matching file arriving in ~/Downloads. */
const DOWNLOADS_POLL_MS = 2000;

/**
 * The search box's one source of truth. Modelled as a union so the panel can
 * never render the ambiguous state it used to: an empty result list that might
 * equally mean "still searching", "nothing matched", or "the call failed".
 */
type SearchState =
  | { kind: "idle" }
  | { kind: "searching"; query: string }
  | { kind: "results"; query: string; hits: WorkHit[] }
  | { kind: "empty"; query: string }
  | { kind: "error"; query: string; message: string };

/** One regular file in ~/Downloads (mirrors Rust `DownloadEntry`). */
interface DownloadEntry {
  name: string;
  path: string;
  modified_ms: number;
}

interface AddScoreProps {
  /** Called after a successful import so the parent can rescan the vault. */
  onImported: () => void;
  onClose: () => void;
}

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** A reasonable default piece folder name from an IMSLP work title. */
function defaultFolderName(title: string): string {
  return title.replace(/[/\\]/g, "-").trim();
}

export function AddScore({ onImported, onClose }: AddScoreProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });

  const [work, setWork] = useState<WorkHit | null>(null);
  const [editions, setEditions] = useState<Edition[] | null>(null);
  const [editionsLoading, setEditionsLoading] = useState(false);
  const [editionsError, setEditionsError] = useState<string | null>(null);

  const [file, setFile] = useState<FileInfo | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [folderName, setFolderName] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const searchGeneration = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Run one search now. Stale in-flight calls are discarded by generation, so a
   * slow earlier request can never overwrite a newer one's results.
   */
  const runSearch = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      searchGeneration.current += 1; // abandon anything in flight
      setSearch({ kind: "idle" });
      return;
    }
    const generation = ++searchGeneration.current;
    setSearch({ kind: "searching", query: trimmed });
    try {
      const hits = await invoke<WorkHit[]>("imslp_search", { query: trimmed });
      if (generation !== searchGeneration.current) return;
      const list = hits ?? [];
      setSearch(
        list.length > 0
          ? { kind: "results", query: trimmed, hits: list }
          : { kind: "empty", query: trimmed },
      );
    } catch (e) {
      if (generation !== searchGeneration.current) return;
      setSearch({ kind: "error", query: trimmed, message: messageOf(e) });
    }
  }, []);

  // Debounced search-as-you-type. An empty/whitespace query returns to idle
  // without a call.
  useEffect(() => {
    // A new query invalidates the previously chosen work: without this, the
    // editions of the OLD work stayed on screen underneath the NEW results,
    // complete with a live "Download in your browser" button for a piece the
    // user is no longer looking at. The import step (`file`) is deliberately
    // left alone so an in-progress download is never thrown away.
    setWork(null);
    setEditions(null);
    setEditionsError(null);

    const trimmed = query.trim();
    if (!trimmed) {
      searchGeneration.current += 1;
      setSearch({ kind: "idle" });
      return;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [query, runSearch]);

  /** Enter searches immediately, cancelling the pending debounce so the
   *  keystroke does not also fire a second, identical request. */
  const searchNow = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    void runSearch(query);
  }, [query, runSearch]);

  const chooseWork = useCallback(async (hit: WorkHit) => {
    setWork(hit);
    setEditions(null);
    setEditionsError(null);
    setFile(null);
    setDownloadError(null);
    setImported(null);
    setFolderName(defaultFolderName(hit.title));
    setEditionsLoading(true);
    try {
      const list = await invoke<Edition[]>("imslp_editions", {
        pageTitle: hit.title,
      });
      setEditions(list ?? []);
    } catch (e) {
      setEditionsError(messageOf(e));
    } finally {
      setEditionsLoading(false);
    }
  }, []);

  const chooseEdition = useCallback(async (edition: Edition) => {
    setDownloadError(null);
    setFile(null);
    setImported(null);
    setHandingOff(true);
    try {
      // Resolves the direct URL AND opens it in the system browser (Rust side).
      const info = await invoke<FileInfo>("imslp_open_download", {
        fileName: edition.file_name,
      });
      setFile(info);
    } catch (e) {
      setDownloadError(messageOf(e));
    } finally {
      setHandingOff(false);
    }
  }, []);

  // While the import step is open, poll ~/Downloads for the arriving file.
  useEffect(() => {
    if (!file) return;
    let active = true;
    const poll = async () => {
      try {
        const entries = await invoke<DownloadEntry[]>("downloads_list");
        if (active) setDownloads(entries ?? []);
      } catch {
        // A transient read failure is not fatal to the panel.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), DOWNLOADS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [file]);

  const expectedName = useMemo(
    () => (file ? downloadBasename(file.url) : ""),
    [file],
  );
  const matches = useMemo(
    () =>
      downloads.filter((entry) =>
        matchesDownloadName(entry.name, expectedName),
      ),
    [downloads, expectedName],
  );

  const runImport = useCallback(
    async (sourcePath: string) => {
      const folder = folderName.trim();
      if (!folder) {
        setImportError("Name the piece folder first.");
        return;
      }
      setImporting(true);
      setImportError(null);
      try {
        await invoke<string>("piece_import_pdf", {
          folderName: folder,
          sourcePath,
        });
        setImported(folder);
        onImported(); // parent rescans so the piece appears
      } catch (e) {
        setImportError(messageOf(e));
      } finally {
        setImporting(false);
      }
    },
    [folderName, onImported],
  );

  // Drag-and-drop of the downloaded file onto the panel (Tauri gives real paths).
  useEffect(() => {
    if (!file) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const off = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const dropped = event.payload.paths?.[0];
          if (dropped) void runImport(dropped);
        });
        if (cancelled) off();
        else unlisten = off;
      } catch {
        // No webview drag-drop available (e.g. tests); manual paths still work.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [file, runImport]);

  const pickFile = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_import_file");
      if (path) await runImport(path);
    } catch (e) {
      setImportError(messageOf(e));
    }
  }, [runImport]);

  const openPastedUrl = useCallback(async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    setDownloadError(null);
    try {
      await invoke("piece_open_source_url", { url });
      // Reuse the same import step: synthesize a FileInfo from the pasted URL so
      // the Downloads poll + drag-drop + manual pick all light up.
      setFile({ url, size: 0, mime: "" });
    } catch (e) {
      setDownloadError(messageOf(e));
    }
  }, [pasteUrl]);

  const nonPdf =
    file != null && file.mime !== "" && file.mime !== "application/pdf";

  return (
    <div className="add-score" aria-label="Add a score from IMSLP">
      <div className="add-score-head">
        <h3 className="add-score-title">Add a score</h3>
        <button type="button" className="ck-back" onClick={onClose}>
          Done
        </button>
      </div>

      <input
        type="search"
        className="add-score-search"
        placeholder="Search IMSLP by title or composer"
        aria-label="Search IMSLP"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            searchNow();
          }
        }}
      />

      {/* Every search outcome is named. An empty list is never rendered as a
          silent void — the panel always says which of the four it is. */}
      {search.kind === "searching" && (
        <p className="add-score-status is-searching" role="status">
          <span className="add-score-spinner" aria-hidden="true" />
          Searching IMSLP for “{search.query}”…
        </p>
      )}
      {search.kind === "error" && (
        <p className="ck-inline-error" role="alert">
          IMSLP search failed: {search.message}
          <button
            type="button"
            className="add-score-retry"
            onClick={() => void runSearch(search.query)}
          >
            Try again
          </button>
        </p>
      )}
      {search.kind === "empty" && (
        <p className="add-score-status" role="status">
          No matches for “{search.query}” on IMSLP.
        </p>
      )}

      {search.kind === "results" && (
        <p className="add-score-status" role="status">
          {search.hits.length} result{search.hits.length === 1 ? "" : "s"} for “
          {search.query}”
        </p>
      )}
      {search.kind === "results" && (
        <ul className="add-score-results">
          {/* Identity is the TITLE, never page_id: IMSLP's `list=search` does
              not return a `pageid`, so every real hit arrives as page_id 0.
              Keying on it gave every row the same React key and made selecting
              one work light up the whole list. Titles are unique per wiki page
              and are what `imslp_editions` is called with anyway. */}
          {search.hits.map((hit) => (
            <li key={hit.title}>
              <button
                type="button"
                className={
                  hit.is_redirect
                    ? "add-score-hit is-redirect"
                    : "add-score-hit"
                }
                aria-pressed={work?.title === hit.title}
                onClick={() => void chooseWork(hit)}
              >
                <span className="add-score-hit-title ck-fit">{hit.title}</span>
                {/* Snippet rendered as PLAIN TEXT — never dangerouslySetInnerHTML. */}
                <span className="add-score-hit-snippet ck-fit">
                  {stripHighlightHtml(hit.snippet)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {work && (
        <div
          className="add-score-editions"
          aria-label={`Editions of ${work.title}`}
        >
          {editionsLoading && (
            <p className="add-score-status">Loading editions…</p>
          )}
          {editionsError && (
            <p className="ck-inline-error" role="alert">
              {editionsError}
            </p>
          )}
          {editions != null && editions.length === 0 && !editionsLoading && (
            <p className="add-score-status">No scores found for this work.</p>
          )}
          {editions != null && editions.length > 0 && (
            <ul className="add-score-edition-list">
              {editions.map((edition, index) => (
                <li key={`${edition.file_name}-${index}`}>
                  <div className="add-score-edition">
                    <span className="add-score-edition-desc ck-fit">
                      {edition.description || edition.file_name}
                    </span>
                    <dl className="add-score-edition-meta">
                      {stripWikiTemplates(edition.editor) && (
                        <div>
                          <dt>Editor</dt>
                          <dd className="ck-fit">
                            {stripWikiTemplates(edition.editor)}
                          </dd>
                        </div>
                      )}
                      {stripWikiTemplates(edition.publisher) && (
                        <div>
                          <dt>Publisher</dt>
                          <dd className="ck-fit">
                            {stripWikiTemplates(edition.publisher)}
                          </dd>
                        </div>
                      )}
                      {edition.copyright && (
                        <div>
                          <dt>Copyright</dt>
                          <dd className="ck-fit">{edition.copyright}</dd>
                        </div>
                      )}
                      {edition.image_type && (
                        <div>
                          <dt>Scan</dt>
                          <dd className="ck-fit">{edition.image_type}</dd>
                        </div>
                      )}
                    </dl>
                    <button
                      type="button"
                      className="add-score-download"
                      disabled={handingOff}
                      onClick={() => void chooseEdition(edition)}
                    >
                      Download in your browser
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {downloadError && (
        <p className="ck-inline-error" role="alert">
          {downloadError}
        </p>
      )}

      {file && (
        <div
          className="add-score-import"
          aria-label="Import the downloaded file"
        >
          <p className="add-score-status">
            Your browser is finishing the download — clear IMSLP's check there.
          </p>
          {nonPdf && (
            <p className="add-score-warn" role="status">
              This edition isn't a PDF ({file.mime}); import may not work.
            </p>
          )}

          <label className="add-score-folder">
            <span>Piece folder</span>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              aria-label="Piece folder name"
            />
          </label>

          {matches.length > 0 && (
            <ul className="add-score-matches">
              {matches.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="add-score-import-one"
                    disabled={importing}
                    onClick={() => void runImport(entry.path)}
                  >
                    Import “{entry.name}”
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="add-score-import-manual">
            <button
              type="button"
              className="add-score-pick"
              disabled={importing}
              onClick={() => void pickFile()}
            >
              Choose the file…
            </button>
            <input
              type="text"
              className="add-score-manual-path"
              placeholder="…or paste the file's full path"
              aria-label="Downloaded file path"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
            />
            <button
              type="button"
              disabled={importing || !manualPath.trim()}
              onClick={() => void runImport(manualPath.trim())}
            >
              Import
            </button>
          </div>

          {importError && (
            <p className="ck-inline-error" role="alert">
              {importError}
            </p>
          )}
          {imported && (
            <p className="add-score-done" role="status">
              Imported into “{imported}”.
            </p>
          )}
        </div>
      )}

      <div className="add-score-paste">
        <label>
          <span>Have a direct link? Paste it</span>
          <input
            type="url"
            placeholder="https://imslp.org/…"
            aria-label="Paste a score URL"
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!pasteUrl.trim()}
          onClick={() => void openPastedUrl()}
        >
          Open in browser
        </button>
      </div>
    </div>
  );
}
