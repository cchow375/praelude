# CodaKiller v1.1.0 — Release Gate

> **Result: PASS · 2026-07-13**  
> Coherence/editing release installed at `/Applications/CodaKiller.app`.

## 🧭 Quick nav

[Problem](#-problem) · [Canonical model](#-canonical-model) · [What shipped](#-what-shipped) ·
[Gates](#-release-gates) · [Data](#-data-safety) · [Artifacts](#-release-artifacts) ·
[Limits](#-honest-limits) · [Next](#-next-action)

## 🔴 Problem

The product had correct individual features but too many disconnected entry points. Tricky Section
notes/measures could not be edited consistently from Score and Details, score practice did not carry
explicit Region identity, PDF boxes were mostly one-shot geometry, Big Goals were absent from their
Calendar target dates, and a constellation star stopped at piece selection instead of the piece.

## 🧩 Canonical model

One `region` row is now the Tricky Section. Its ID owns the name/note, measure range, color, practice
blocks, Daily Work association, and edition-specific PDF annotations. Score and Details render the
same editor against that row. A Daily Work title remains separate by design: it is the exact action
scheduled under a Goal, not another copy of the Goal name.

## 🛠️ What shipped

- Add, edit, recolor, split, merge, and confirm-delete Tricky Sections from Score or Details.
- Start Region-linked practice directly on Score; changing block measures no longer changes its
  selected Region ownership.
- Create box, highlight, and on-score text-note marks; move/resize/retype/delete existing marks and
  save or clear them with explicit confirmation.
- Show Big Goal milestones on target dates and resolve their name live in Calendar; Goal deletion
  explicitly cascades linked Calendar items.
- Open the exact piece from its constellation star, guarded against stale async responses.
- Make Region split atomic; keep practice/Calendar history safe through split, merge, and delete.
- Convert valid legacy intake hard spots into canonical Regions without duplicating them in the UI
  or Brain context.

## ✅ Release gates

| Gate | Result |
|---|---|
| Full frontend | **35 files / 198 tests passed** |
| TypeScript + Vite production build | **Passed** |
| Rust library | **320 passed / 5 hardware-live ignored** |
| Rust integrations | **22 passed / 2 live TTS ignored** |
| Strict Clippy | **Passed** |
| Diff hygiene | `git diff --check` **passed** |
| Fresh adversarial review | **Approved; no remaining P0–P2 findings** |
| Native release | Build, stage, seal, install, DMG, checksum, and one-copy audit **passed** |
| Installed launch | Running from `/Applications/CodaKiller.app/Contents/MacOS/codakiller` |

The first review correctly rejected non-atomic Region split, unsafe Calendar foreign-key handling,
one-shot annotation geometry/type, and stale async selection. Each was fixed and re-reviewed before
release approval.

## 🔐 Data safety

- Schema remains **6**; there is no migration.
- Pre-release backup:
  `~/Library/Application Support/com.christian.codakiller/backups/(C) pre-v1.1.0-2026-07-13.db`.
- After launching the installed app, `PRAGMA integrity_check` returned `ok` and the foreign-key
  check returned no rows.
- Live counts remained **5 pieces / 24 Regions / 20 blocks / 165 reps / 9 Goals / 9 Daily Work**.
- Region delete preserves blocks and Calendar work by clearing only the Region link; Goal delete is
  the intentional exception and confirms before cascading linked Calendar rows.

## 📦 Release artifacts

| Item | Value |
|---|---|
| Installed app | `/Applications/CodaKiller.app` |
| Version | `1.1.0` |
| Bundle ID | `com.christian.codakiller` |
| DMG | `releases/v1.1.0/CodaKiller-1.1.0.dmg` |
| DMG bytes | `8,584,073` |
| SHA-256 | `691057b306c48f9d23ec9ebe1534194efc1035523c6c4d42a4766a784aec307f` |
| Signature | Valid ad-hoc local seal; not Developer ID signed or notarized |
| Duplicate audit | Exactly one bundle: `/Applications/CodaKiller.app` |

## ⚠️ Honest limits

- PDF marks appear on the actual rendered score and persist with its edition/fingerprint, but the
  original PDF file is not rewritten. That is intentional source-file protection, not a claim of
  exported PDF markup.
- Region split clears the old marks because software cannot infer which geometry belongs to which
  half; the confirmation says so.
- The complete voice/metronome/score flow at Christian's Steinway remains the human acceptance run.
- The repository still has no off-disk private remote.

## ⟶ Next action

Christian: choose a constellation star, select a Tricky Section, edit its measures/note/color, drag
and resize one score mark, save, then switch to Details and confirm the same values appear. Start one
practice block there and confirm it appears under that same Tricky Section.
