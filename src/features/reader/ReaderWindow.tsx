import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  findQuoteParagraphIndex,
  parseInline,
  shouldWindow,
  splitParagraphs,
  type BookExcerpt,
} from "./excerpt";
import "./ReaderWindow.css";

/** How many paragraphs flank the quote when the excerpt is windowed. */
const WINDOW_RADIUS = 4;
/** How many more paragraphs each "Show more" reveals. */
const WINDOW_STEP = 6;

export interface ReaderQuoteRef {
  /** The book id (source_id) — resolves the source file via the books manifest. */
  readonly sourceId: string;
  /** Verbatim quote text; passed as `contains` for a precise section match. */
  readonly text: string;
  /** Quiet fallbacks shown in the header while the excerpt loads. */
  readonly author?: string;
  readonly book?: string;
  readonly heading?: string;
}

export type ExcerptFetcher = (req: {
  sourceId: string;
  contains: string;
}) => Promise<BookExcerpt>;

/** The real fetch: the native `book_excerpt` command (books-contract). */
export const fetchBookExcerpt: ExcerptFetcher = (req) =>
  invoke<BookExcerpt>("book_excerpt", {
    sourceId: req.sourceId,
    contains: req.contains,
  });

export interface ReaderWindowProps {
  readonly quote: ReaderQuoteRef;
  readonly onClose: () => void;
  /** Injectable for tests; defaults to the native command. */
  readonly fetchExcerpt?: ExcerptFetcher;
}

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    switch (token.type) {
      case "strong":
        return <strong key={index}>{token.value}</strong>;
      case "em":
        return <em key={index}>{token.value}</em>;
      case "code":
        return <code key={index}>{token.value}</code>;
      default:
        return <span key={index}>{token.value}</span>;
    }
  });
}

/**
 * The scholarly excerpt reader (D2, ledger 28). Opens the book's section around
 * a quote: a quiet attribution header, the passage as readable prose, the quote
 * itself scrolled into view and quietly marked. A heading-less whole-book body
 * or a long section is windowed client-side (±paragraphs with Show more), so the
 * huge OCR book never dumps its entire text. Esc and × close.
 *
 * Exported and reusable: Assistant citations (C4) can open the same reader by
 * passing a `ReaderQuoteRef`.
 */
export function ReaderWindow({
  quote,
  onClose,
  fetchExcerpt = fetchBookExcerpt,
}: ReaderWindowProps) {
  const [excerpt, setExcerpt] = useState<BookExcerpt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extraBefore, setExtraBefore] = useState(0);
  const [extraAfter, setExtraAfter] = useState(0);

  const closeRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let alive = true;
    setExcerpt(null);
    setError(null);
    setExtraBefore(0);
    setExtraAfter(0);
    fetchExcerpt({ sourceId: quote.sourceId, contains: quote.text })
      .then((result) => {
        if (alive) setExcerpt(result);
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(
            cause instanceof Error
              ? cause.message
              : typeof cause === "string" && cause.trim() !== ""
                ? cause
                : "That passage could not be opened.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [quote.sourceId, quote.text, fetchExcerpt]);

  // Focus the close control when the window opens (keyboard users land inside).
  useEffect(() => {
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const view = useMemo(() => {
    if (!excerpt) return null;
    const paragraphs = splitParagraphs(excerpt.text);
    const quoteIndex = findQuoteParagraphIndex(paragraphs, quote.text);
    const windowed = shouldWindow(excerpt) && quoteIndex >= 0;
    let start = 0;
    let end = paragraphs.length;
    if (windowed) {
      start = Math.max(0, quoteIndex - WINDOW_RADIUS - extraBefore);
      end = Math.min(
        paragraphs.length,
        quoteIndex + 1 + WINDOW_RADIUS + extraAfter,
      );
    }
    return {
      paragraphs,
      quoteIndex,
      windowed,
      start,
      end,
      hasMoreBefore: windowed && start > 0,
      hasMoreAfter: windowed && end < paragraphs.length,
    };
  }, [excerpt, quote.text, extraBefore, extraAfter]);

  // Scroll the quote into view once its paragraph is rendered.
  useEffect(() => {
    if (view && anchorRef.current) {
      // Optional call: jsdom (tests) has no scrollIntoView, and it is a pure
      // convenience anyway — the anchor is already marked in the DOM.
      anchorRef.current.scrollIntoView?.({ block: "center", behavior: "auto" });
    }
  }, [view]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const headerHeading = excerpt?.heading?.trim() || quote.heading?.trim() || "";
  const headerAuthor = excerpt?.author || quote.author || "";
  const headerBook = excerpt?.title || quote.book || "";
  const attribution = [headerAuthor, headerBook, headerHeading]
    .filter((part) => part && part.length > 0)
    .join(" · ");

  return (
    <div className="reader-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reader"
        tabIndex={-1}
        className="reader-window"
        data-testid="reader-window"
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="reader-head">
          <p className="reader-attribution" data-testid="reader-attribution">
            {attribution}
          </p>
          <button
            ref={closeRef}
            type="button"
            className="reader-close"
            aria-label="Close reader"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </header>

        <div className="reader-body">
          {error && (
            <p className="reader-state" role="alert">
              {error}
            </p>
          )}
          {!error && !view && (
            <p className="reader-state">Opening the passage…</p>
          )}
          {view && (
            <article className="reader-prose">
              {view.hasMoreBefore && (
                <button
                  type="button"
                  className="reader-more"
                  onClick={() => setExtraBefore((n) => n + WINDOW_STEP)}
                >
                  Show more above
                </button>
              )}
              {view.paragraphs.slice(view.start, view.end).map((para, i) => {
                const index = view.start + i;
                const isAnchor = index === view.quoteIndex;
                return (
                  <p
                    key={index}
                    ref={isAnchor ? anchorRef : undefined}
                    className={
                      isAnchor ? "reader-para is-quote" : "reader-para"
                    }
                    data-testid={isAnchor ? "reader-quote-anchor" : undefined}
                  >
                    {renderInline(para)}
                  </p>
                );
              })}
              {view.hasMoreAfter && (
                <button
                  type="button"
                  className="reader-more"
                  onClick={() => setExtraAfter((n) => n + WINDOW_STEP)}
                >
                  Show more below
                </button>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
