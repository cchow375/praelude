# CodaKiller v1.2.0 — Release Gate

> **Result: PASS · 2026-07-13**  
> Actionable Score/tutorial release installed at `/Applications/CodaKiller.app`.

## 🧭 Quick nav

[Problem](#-problem) · [What shipped](#-what-shipped) · [Gates](#-release-gates) ·
[Native proof](#-native-proof) · [Data](#-data-safety) · [Artifacts](#-release-artifacts) ·
[Limits](#-honest-limits) · [Next](#-next-action)

## 🔴 Problem

Section headers and notes were conflated, actions were detached below a long sidebar, score density
was rigid, and the Scherzo tutorial was disconnected from its practice sections.

## 🛠️ What shipped

- Independent Region title and Practice notes, shared across Score and Details.
- Measure-sorted searchable one-open accordion with row-local Practice/Edit/Score marks/Tutorial.
- 25–200% zoom, Fit page, Fit width, 2-page, Hide sections; clickable saved marks and unsaved guard.
- Schema-7 validated local tutorial video/chapter/clip graph with secure scan/play/reveal, shared
  chapter editing, per-Region unlink, stale-file cleanup, and transaction-safe Region mutations.
- All 12 live Scherzo Regions mapped via 13 links to 11 useful analyzed tutorial chapters.
- Correct JSON-null wire behavior across every nullable patch field.

## ✅ Release gates

| Gate | Result |
|---|---|
| Frontend | **36 files / 211 tests passed** |
| TypeScript + Vite production build | **Passed** |
| Rust library | **331 passed / 5 hardware-live ignored** |
| Rust integrations | **22 passed / 2 live-TTS ignored** |
| Strict Clippy | **Passed** |
| Diff hygiene | `git diff --check` **passed** |
| Real-backup schema 6→7 rehearsal | **Passed; integrity/FKs/counts clean** |
| Fresh adversarial verifier | **PASS; no known P0–P2 defects** |
| Native release | Build, stage, seal, install, DMG, checksum, one-copy audit **passed** |

The verifier's earlier rejection was useful: it found broken explicit-null clearing, unsafe shared
chapter updates, missing merge/delete graph handling, stale-file lifecycle, mismatched input limits,
an unsaved-section switch, and Details ordering. Every finding was fixed before the final PASS.

## 🖥️ Native proof

The actual installed `/Applications/CodaKiller.app` showed badge **v1.2.0**, opened the Scherzo,
painted its scanned score, exposed Fit page/2-page/25–200%/Hide sections, opened the mm. 117–130
row in place, selected **Tutorial**, sought to **Practice Section 4 — Coordination (15:13–17:12)**,
and visibly played the presenter at 15:15 beside rendered page 5 and the section's PDF marks.

This proves the packaged Tauri asset path, local-video authorization, chapter seek, inline layout,
and PDF paint together—not merely a mocked React tree.

## 🔐 Data safety

- Backup: `~/Library/Application Support/com.christian.codakiller/backups/(C) pre-v1.2.0-2026-07-13.db`.
- Live DB after installed launch: schema 7, `quick_check=ok`, zero FK violations.
- Preserved: **5 pieces / 24 Regions / 20 blocks / 165 reps / 9 Goals / 9 Daily Work**.
- Added: **1 tutorial video / 11 chapters / 13 Region links**.
- Source PDF and video bytes are never rewritten; tutorial scanner rejects symlinks and path escape.

## 📦 Release artifacts

| Item | Value |
|---|---|
| Installed app | `/Applications/CodaKiller.app` |
| Version | `1.2.0` |
| Bundle ID | `com.christian.codakiller` |
| DMG | `releases/v1.2.0/CodaKiller-1.2.0.dmg` |
| DMG bytes | `8,702,990` |
| SHA-256 | `01e9659a2944e55d2feced4e762d834e96c96459b9edb168309fd11a28ceb8fb` |
| Signature | Valid ad-hoc local seal; not Developer ID signed or notarized |
| Duplicate audit | Exactly one bundle: `/Applications/CodaKiller.app` |

## ⚠️ Honest limits

- Chapter-to-measure mapping is human-authored, not automatic transcription or score recognition.
- A renamed/deleted source produces a visible error and confirmed forget flow; it cannot be
  magically relocated. Forget removes metadata/mappings, never a file.
- The Scherzo mm. 551–552 split is medium-confidence; the presenter says Paul but has no embedded
  surname/source metadata.
- Full voice/metronome use at Christian's Steinway remains the human acceptance run.
- The repository still has no off-disk private remote.

## ⟶ Next action

Open Scherzo → mm. 65–117 → Tutorial, play the mapped chapter, edit one Practice note, and record
one linked rep from that same accordion row.

