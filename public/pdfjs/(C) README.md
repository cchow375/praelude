# PDF.js runtime assets

These directories are copied verbatim from the installed `pdfjs-dist` package at the same version
as CodaKiller's display and worker modules:

- `wasm/` — JBIG2, CCITT fax, JPEG 2000, and ICC color decoders plus JavaScript fallbacks
- `cmaps/` — packed character maps
- `standard_fonts/` — PDF base-font metrics/data
- `iccs/` — bundled CMYK ICC profile

CodaKiller's scores are predominantly scanned-image PDFs. Loading only PDF.js's JavaScript modules
can produce valid page counts and completely white canvases when these decoder files are missing.
`ScoreView` passes explicit same-origin URLs for every directory. Vite copies `public/` unchanged
into the native app bundle.

When updating `pdfjs-dist`, replace all four directories from the new package together. Never mix
API, worker, and decoder versions.
