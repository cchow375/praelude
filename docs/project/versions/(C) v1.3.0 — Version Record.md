# CodaKiller v1.3.0 — Version Record

> **Shipped: 2026-07-13 · tag `v1.3.0` · installed at `/Applications/CodaKiller.app`**  
> Compact workspace + contextual Practice Brain. This record is immutable after ship except factual
> corrections.

## What this version is

v1.3.0 turns the existing cited Brain into a useful companion beside the real PDF. The app is
smaller and scalable, the score/Brain surfaces move aside on demand, and each answer can combine
the exact selected piece/Tricky Section, current practice state, bounded MusicXML notation facts,
and retrieved passages from Christian's three external practice books. The app still never hears or
grades piano; Christian reports the problem and decides whether any suggestion is worth trying.

## What shipped

- Interface scale 75–125% (90% default), compact control/radius/padding pass, 720×520 native minimum.
- Collapsible score section rail with full-width PDF and narrow-window overlay behavior.
- Persistent right overlay Practice Brain drawer; arrow/Escape collapse, focus return, conversation
  preserved while hidden. Active Rep remains a movable/collapsible window without a fixed gutter.
- Read-only cached lexical RAG for exactly:
  - *The Complete Pianist* (Penelope Roskell)
  - *Learn Faster, Perform Better* (Noa Kageyama/Gebrian conversion)
  - *The Piano Student's Guide to Effective Practicing* (Nancy O'Neill Breth)
- Bounded, source-balanced retrieval with path-free allowlisted citations; local retrieval works in
  offline/private mode. Retrieved excerpts reach Claude/Gemini only when the sharing setting is on.
- Bounded MusicXML facts for the exact selected measure range: key/time, tempo/directions/dynamics,
  voices/staves, note/rest/chord counts, limited pitch/rhythm tokens, and ties. Filesystem escape,
  symlinks, false `.xml` roots, external-DTD resolution, oversized/deep/event-heavy documents, and
  unbounded field growth are rejected. `.mxl` is explicit unsupported analysis.
- Canonical Rust-owned context: explicit piece/Region only, current goals/blocks/session, bounded
  recent reps/notes, exact active Rep only when piece-matched, deterministic Next work, MusicXML,
  retrieved chunks, and embedded methods. No paths, keys, settings secrets, or stale persisted-piece
  fallback cross the boundary.
- Six-exchange/2,000-character-per-turn conversation; user disagreement and alternative/no-drill
  requests are first-class. Conversation is in-memory only.
- Per-answer grounding receipt showing exact identity/mm., rep count, book hit count, MusicXML
  status, excerpt-sharing state, and warnings.
- Hardened output policy, citation/privacy authorization, stale request handling, score-timewise
  parsing, Markdown asset stripping, and Spotlight release indexing.

## Verification

- Frontend: **36 files / 217 tests passed**; TypeScript + Vite production build passed.
- Rust: **358 passed / 9 ignored**; integrations **9 + 9 + 4 passed**; strict clippy passed.
- Fresh adversarial verifier: **SHIP; no P0/P1/P2 findings** after fix rounds.
- Real external fixtures passed without printing copyrighted text or secrets:
  - three-book wrong-memory/ineffective-slow-practice routing;
  - Scherzo selected MusicXML mm. 40–42;
  - Griffes validated plain `.xml` discovery;
  - live configured provider returned an allowlisted external-book citation.
- Responsive browser QA: 1280 px and 720 px layouts, overlay/collapse/no-overflow behavior, and
  mounted thread passed. Installed native launch visibly showed v1.3.0 and live Practice Universe.
- Release script: app build, stage, ad-hoc seal, strict codesign verification, rollback install,
  DMG, checksum, generated-bundle cleanup, one-copy filesystem/LaunchServices/Spotlight audit passed.

## Data and artifacts

- Schema remains **7**; no migration was required.
- Pre-release backup: `~/Library/Application Support/com.christian.codakiller/backups/(C)
  pre-v1.3.0-2026-07-13.db`.
- Installed-launch database: `quick_check=ok`, zero FK rows; **5 pieces / 24 Regions / 21 blocks /
  169 reps / 9 Goals / 9 Daily Work / 1 tutorial video / 11 chapters / 13 links**.
- DMG: `~/codakiller/releases/v1.3.0/CodaKiller-1.3.0.dmg` — **8,813,450 bytes**.
- SHA-256: `9ac4346b43a1bfff6f4977768980a754842308d4abd24dacf86ec9fd1866d82b`.
- Signature: valid local ad-hoc seal; not Developer ID signed or notarized.
- Exactly one bundle identifier instance: `/Applications/CodaKiller.app`.

## Honest gaps

- Christian has not used v1.3.0 at the Steinway. The interaction, voice pickup, metronome loudness,
  retrieval usefulness, answer quality, and chosen 90% scale are still unproven in the real session.
- The three books stay external and copyrighted; they are not bundled. Retrieval is lexical, not an
  embedding/vector database or proof of correct interpretation.
- MusicXML describes notation, not Christian's playing. Editions/measure numbers can disagree with
  the open PDF; selected context is capped at 24 measures; `.mxl` analysis is not implemented.
- The conversation disappears on relaunch. This avoids silently storing/provider-resending book
  prose but means it is not a durable practice journal.
- Provider prose can still be wrong even when cited. The grounding receipt is evidence to inspect,
  not a truth guarantee.
- The repo still has no off-disk private remote.

## ⟶ Next steps

1. Christian runs one complete v1.3.0 at-piano acceptance: set scale, narrow the window, collapse
   the score rail, select a real Scherzo section, describe an actual failure, verify the grounding
   receipt/source, disagree and request an alternative, then manually record the chosen experiment.
2. Capture exact friction and change only what the session proves weak—especially retrieval terms,
   answer dose, drawer width, scale default, voice vocabulary, or ladder behavior.
3. Create and push the private off-disk git remote.

