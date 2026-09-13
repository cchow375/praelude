# CodaKiller v1.2.0 — Version Record

> **Shipped:** 2026-07-13 · **Tag:** `v1.2.0` · **Schema:** 7 · **Result:** PASS

## 🧭 Quick nav

[Problem](#-problem) · [Model](#-canonical-model) · [Shipped](#-what-shipped) ·
[Scherzo](#-scherzo-tutorial) · [Proof](#-release-proof) · [Data](#-data-safety) ·
[Artifacts](#-artifacts) · [Limits](#-honest-limits) · [Next](#-next-action)

## 🔴 Problem

The canonical data existed in v1.1.0, but the interface still made it needlessly hard to use.
Section headers and notes behaved like one field, editing/practice lived below a long list, score
scale was too rigid, and a useful 39:57 Scherzo tutorial was a disconnected desktop file.

## 🧩 Canonical model

- `region.name` = the visible, editable section title.
- `region.notes` = the longer Practice notes.
- Score and Details edit the same Region ID; the Region owns its measures, color, blocks, Calendar
  links, score marks, and tutorial mappings.
- `tutorial_video` stores validated local-file metadata, never bytes.
- `tutorial_chapter` stores one reusable title/note/start/end interval.
- `tutorial_clip` maps chapters many-to-many to Regions. Editing a shared chapter changes every
  linked section; removing a clip detaches only that Region.

## 🛠️ What shipped

- Measure-sorted, searchable Score accordion; one row opens at a time.
- Row-local **Practice / Edit / Score marks / Tutorial** tabs; detached bottom inspector removed.
- Independent Section title and Practice notes in Score and Details.
- Region-linked practice without a duplicated label field; advanced ladder/variants stay collapsed
  until requested.
- 25–200% slider, Fit width, Fit page, 2-page view, and Hide/Show sections.
- Clickable saved annotations and guarded unsaved mapping changes.
- Schema-7 normalized tutorial graph with scan, secure local playback, seek/start-stop chapter
  cards, add/edit/remove mappings, shared-edit warning, Finder reveal, and confirmed stale cleanup.
- Nullable patch wire semantics repaired across Region, tutorial, block, rep, Goal, Daily Work, and
  piece updates: omitted means unchanged; JSON `null` now actually clears optional data.
- Region merge transfers/deduplicates tutorial links; delete removes mappings and orphan chapters;
  shared updates are transactional.

## 🎥 Scherzo tutorial

- Source analyzed: `/Users/c3/Desktop/scherzo tut.mp4`.
- Copied byte-for-byte to
  `Piano Practice/Pieces/Chopin - Scherzo No.2 Op.31/tutorials/Scherzo No. 2 Tutorial.mp4`.
- Media: H.264/AAC, 1280×720 at 25 fps, **39:57.019**, 111,336,990 bytes.
- SHA-256: `b83c5a2e1c100caa5f0172ad5d6442fa541b64a98cfe6b76330da04bff2ff8a1`.
- Identified 20 title-card Practice Sections; seeded 11 useful chapter rows and 13 links covering
  every one of the 12 live Scherzo Regions. The overlapping mm. 544–570 Region intentionally uses
  Sections 13 and 14.
- Readable companion: [[(C) Scherzo Tutorial Map]].

## ✅ Release proof

| Gate | Result |
|---|---|
| Frontend | **36 files / 211 tests passed** |
| TypeScript + Vite build | **Passed** |
| Rust library | **331 passed / 5 hardware-live ignored** |
| Rust integrations | **22 passed / 2 live-TTS ignored** |
| Strict Clippy | **Passed** |
| Diff hygiene | `git diff --check` **passed** |
| Migration rehearsal | Real schema-6 backup copy → schema 7; integrity/FKs/counts clean |
| Fresh adversarial review | **PASS; no known P0–P2 defects** |
| Native release | Build, seal, install, DMG, checksum, one-copy audit **passed** |
| Installed visual acceptance | v1.2.0 rendered Scherzo page 5, opened a row-local Tutorial, sought to **15:13**, and visibly played the mapped frame |

The fresh verifier initially found real defects: null clear semantics, shared-chapter transaction
safety, merge/delete link handling, stale video lifecycle, title/note limits, unsaved mapping state,
and Details ordering. They were fixed and re-reviewed; the final result was PASS.

## 🔐 Data safety

- Pre-release backup:
  `~/Library/Application Support/com.christian.codakiller/backups/(C) pre-v1.2.0-2026-07-13.db`.
- Post-launch: `PRAGMA user_version=7`, `quick_check=ok`, and no foreign-key violations.
- Core live counts preserved: **5 pieces / 24 Regions / 20 blocks / 165 reps / 9 Goals /
  9 Daily Work**.
- New tutorial counts: **1 video / 11 chapters / 13 Region links**.
- Scanner accepts only regular, non-symlink media inside the selected piece's `tutorials/` folder;
  Finder reveal resolves a validated database ID. Static asset scope remains empty.

## 📦 Artifacts

| Item | Value |
|---|---|
| Installed app | `/Applications/CodaKiller.app` |
| Version | `1.2.0` |
| Bundle ID | `com.christian.codakiller` |
| DMG | `~/codakiller/releases/v1.2.0/CodaKiller-1.2.0.dmg` |
| DMG bytes | `8,702,990` |
| SHA-256 | `01e9659a2944e55d2feced4e762d834e96c96459b9edb168309fd11a28ceb8fb` |
| Signature | Valid ad-hoc local seal; not Developer ID signed or notarized |
| Duplicate audit | Exactly one bundle: `/Applications/CodaKiller.app` |

## ⚠️ Honest limits

- Tutorial mapping is manual. It does not transcribe video or infer score measures.
- The Scherzo mm. 551–552 Section 13/14 boundary is medium-confidence. The presenter identifies
  himself only as Paul; there is no embedded source/title/author metadata, so no surname is claimed.
- Renaming/deleting a tutorial outside the app breaks its path; the UI then offers confirmed
  **Forget broken video**. It removes mappings/metadata, never a file.
- Score marks remain protected overlays; source PDFs are not rewritten.
- Native visual playback passed. The full voice/metronome flow at Christian's Steinway is still the
  critical human acceptance run, and the repo still lacks an off-disk private remote.

## ⟶ Next action

Christian: open **Scherzo → Score → mm. 65–117 → Tutorial**, play the mapped chapter, write one
specific cue in Practice notes, and log one linked rep from the same accordion row.

