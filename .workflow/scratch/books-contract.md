# Book library frontend contract (branch lane/d-books-backend, commit 0bf9b27)

- invoke('books_list') → BookListing[]: { id, file_name, title, author, kind, visual_dependency, available }
  (return fields are snake_case AS-IS; only command ARGS are camelCase)
- invoke('book_add', { path, title, author, kind }) → BookListing
  kind ∈ "practice-method" | "composer-life" | "interpretation" (kebab-case wire values).
  Rejects non-.md, unreadable/non-UTF-8, >5MB, empty title. Added books visual_dependency:false.
- invoke('book_remove', { id }) → null. FRONTEND owns the confirm dialog. Built-ins removable.
  Backend moves file to knowledge-dir .trash/, never hard-deletes.
- invoke('book_excerpt', { sourceId, heading?, contains? }) → { source_id, title, author, heading, text }
  text = raw markdown section (heading → next same/higher heading). For the quote reader: pass the
  quote's verbatim text as `contains` (precise), heading as fallback. Missing match → Err(string).

All errors: rejected promise with honest human-readable string.

READER CAVEAT (verifier-confirmed, 2026-07-28): contains-matching is whitespace-normalized —
pass quotes.json text verbatim and it locates 182/182. BUT for a book with NO markdown headings
(gieseking-leimer: OCR plain text) the returned excerpt is the WHOLE book body with heading:"".
The D2 reader MUST window the display around the quote text client-side (e.g. center on the first
whitespace-normalized occurrence, show ±N paragraphs, "show more" affordances) rather than
rendering text verbatim unconditionally.
Quotes source: .workflow/scratch/quotes-draft.json (182 verified entries: id, text, source_id,
author, book, heading, themes) → ship as src/content/quotes.json in the D-frontend lane, with a
build/test-time verbatim check against the corpus via book_excerpt or file read.
