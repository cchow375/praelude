# v8.2.1 — compact Score composer correction QA

> **Evidence class: browser/devMock source candidate, 2026-08-28.** This record covers the narrow
> density/reachability fix prompted by Christian's first installed v8.2.0 screenshot. It does not
> prove a packaged 8.2.1 app, WKWebView scrolling, native IPC/SQLite, microphone behavior or
> at-piano acceptance. Schema remains 20. Source commit, package identity, artifact checksum,
> install and release tag are pending.

## Accepted 720x520 interaction

- The measure range is one two-column row: **From measure / To measure**.
- Tempo is one two-column row: **Start BPM / Target BPM**.
- **Practice focus** and the compact **Metronome** toggle share one row.
- **Set target** keeps target mode and count on one row at the supported rail width.
- **Start set** lives in the composer header, remains immediately visible, and stays pinned while
  optional composer controls move beneath it.
- Variant presets remain a single horizontal chip line; the custom text field is absent until
  **+ Custom** is pressed, then receives focus.
- Tricky Sections remains the sole vertical scroll owner. The composer introduces no nested
  scrollbar and the narrow rail has no horizontal overflow.

This evidence verifies the browser source layout at the stated viewport. It does not upgrade the
still-open packaged-native Score feel gate.

## Automated gates

- Frontend: **2,680 passed / 1 skipped / 0 failed**.
- TypeScript: **PASS**.
- Production build: **PASS**.
- Runtime semantics/schema: unchanged by this frontend-only patch.

## Release evidence

- [x] Source version metadata agrees on 8.2.1 across package/package-lock, Cargo/Cargo.lock and
      Tauri configuration.
- [ ] Full release-script version/artifact gate.
- [ ] Signed app/DMG/checksum and one-copy audit.
- [ ] Fresh installed launch and read-only live schema-20 integrity/count audit.
- [ ] Release commit and pushed tag.
- [ ] Installed-native 720x520 Score/composer interaction verdict.

## Next steps

Package and install the candidate only after the normal patch gates; then repeat this exact
composer walk in `/Applications/CodaKiller.app`. Keep the separate microphone/Steinway and
provider-mapping gates honest.
