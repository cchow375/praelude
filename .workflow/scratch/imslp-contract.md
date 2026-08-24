# IMSLP client frontend contract (branch lane/d-imslp-client, commit ee95ce6)

invoke("imslp_search", { query }) → WorkHit[]
WorkHit = { title, page_id, snippet /* HTML w/ highlight spans */, size, word_count, is_redirect }
empty/whitespace query → [] with no network; empty array = no results.

invoke("imslp_editions", { pageTitle }) → Edition[]
Edition = { file_name, description, editor, publisher /* raw wikitext */, copyright, image_type }
empty array = work has no scores — show "no scores found", NOT an error.

invoke("imslp_open_download", { fileName }) → FileInfo { url, size, mime }
Side effect: opens url in the SYSTEM BROWSER (user clears IMSLP bot-check there).
Use mime to warn when not application/pdf; size for a hint.

All errors: rejected promise with an honest user-facing string — display verbatim, no retry loops.
UX per research: debounce search ≥1-2s (IMSLP Crawl-delay); paste-URL fallback also routes through
the browser. Download completion → app-side import (watch Downloads / drag-drop) is a separate
frontend feature (spec D4), not part of this client.
