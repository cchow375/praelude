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

/** IMSLP etiquette: debounce search-as-you-type ≥1.5s (robots Crawl-delay). */
const SEARCH_DEBOUNCE_MS = 1500;
/** Poll cadence for a matching file arriving in ~/Downloads. */
const DOWNLOADS_POLL_MS = 2000;

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
  const [results, setResults] = useState<WorkHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  // Debounced search: wait SEARCH_DEBOUNCE_MS after the last keystroke, then run
  // exactly one search. An empty/whitespace query clears results without a call.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    const generation = ++searchGeneration.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const hits = await invoke<WorkHit[]>("imslp_search", {
            query: trimmed,
          });
          if (generation !== searchGeneration.current) return;
          setResults(hits ?? []);
          setSearchError(null);
        } catch (e) {
          if (generation !== searchGeneration.current) return;
          setSearchError(messageOf(e));
          setResults([]);
        } finally {
          if (generation === searchGeneration.current) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

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
      />

      {searching && <p className="add-score-status">Searching…</p>}
      {searchError && (
        <p className="ck-inline-error" role="alert">
          {searchError}
        </p>
      )}

      {results.length > 0 && (
        <ul className="add-score-results">
          {results.map((hit) => (
            <li key={hit.page_id}>
              <button
                type="button"
                className={
                  hit.is_redirect
                    ? "add-score-hit is-redirect"
                    : "add-score-hit"
                }
                aria-pressed={work?.page_id === hit.page_id}
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
