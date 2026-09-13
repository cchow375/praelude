# CodaKiller v1.1.0 — Version Record

> **Shipped:** 2026-07-13 · **Tag:** `v1.1.0` · **Schema:** 6 (unchanged)  
> **Purpose:** make the app behave like one connected practice system instead of overlapping forms.

## 🧭 Quick nav

[Snapshot](#-snapshot) · [Problem](#-problem) · [Model](#-one-canonical-model) ·
[Changes](#-what-shipped) · [Proof](#-what-was-proved) · [Data](#-data-safety) ·
[Artifacts](#-artifacts) · [Limits](#-honest-limits) · [Next](#-next-steps)

## 📍 Snapshot

| Question | Answer |
|---|---|
| What is this? | P6 coherence/editing release |
| Core change | Region is the one Tricky Section across Score, Details, practice, Calendar, and Brain |
| Score change | Editable color-coded boxes, highlights, and text notes plus direct linked practice |
| Planning/navigation | Dated Big Goals show in Calendar; constellation stars open exact pieces |
| Data change | No migration; schema remains v6 |
| Installed app | `/Applications/CodaKiller.app` |

## 🔴 Problem

Christian correctly called out that the UI had too many text entries claiming to be the same idea.
Tricky Section notes/measures could diverge by surface, practice entry from the score lacked explicit
section identity, PDF boxes were difficult to revise, Goals did not visibly synchronize to Calendar,
and a constellation star stopped at the piece list. Individually functional controls had produced a
system that was harder to reason about than its data model required.

## 🧩 One canonical model

One Region row is the Tricky Section. Its ID owns its note/name, measure range, color, linked blocks,
Calendar association, and PDF annotations. Score and Details now present the same editor against that
record. A Calendar Daily Work title remains separate on purpose: it is the exact scheduled action
under the Goal, not a second copy of the Goal name.

## 🛠️ What shipped

- Add/edit/delete/recolor/merge/split Tricky Sections from Score and Details with explicit outcomes.
- Start practice directly from a selected score section with explicit Region ownership.
- Add box, highlight, or text-note score marks; move, resize, retype, recolor, remove, or clear them.
- Persist marks per PDF edition/fingerprint and reject stale geometry after a source change.
- Show dated Big Goals as Calendar milestones and resolve renamed Goal text live there.
- Confirm Goal deletion and cascade its linked Calendar rows intentionally.
- Make Region split one atomic backend operation; keep block/Calendar history safe on delete/merge.
- Open the exact constellation piece and ignore stale piece/score responses.
- Backfill valid legacy intake hard spots into Regions once, without a duplicate UI/Brain field.

## ✅ What was proved

| Check | Result |
|---|---|
| Full frontend | **35 files / 198 tests passed** |
| Rust library | **320 passed / 5 hardware-live ignored** |
| Rust integration | **22 passed / 2 live TTS ignored** |
| TypeScript/Vite + strict Clippy | **Passed** |
| Transaction tests | Split rollback, delete/merge Calendar safety, Goal cascades **passed** |
| Async tests | Direct star selection and stale-response rejection **passed** |
| Fresh adversarial review | First review found four real issues; fixes re-reviewed and **approved, no P0–P2** |
| Native release | Sealed install, relaunch, checksum, and exact-one-app audit **passed** |

## 🔐 Data safety

- Schema remains 6; no migration was necessary.
- Backup made before release:
  `~/Library/Application Support/com.christian.codakiller/backups/(C) pre-v1.1.0-2026-07-13.db`.
- Post-launch integrity and foreign-key checks passed.
- Counts stayed **5 pieces / 24 Regions / 20 blocks / 165 reps / 9 Goals / 9 Daily Work**.
- Region deletion preserves block and Calendar records while clearing only their Region link.
- Goal deletion is the explicit cascade and requires confirmation.

## 📦 Artifacts

| Item | Value |
|---|---|
| App | `/Applications/CodaKiller.app` |
| DMG | `~/codakiller/releases/v1.1.0/CodaKiller-1.1.0.dmg` |
| DMG bytes | `8,584,073` |
| SHA-256 | `691057b306c48f9d23ec9ebe1534194efc1035523c6c4d42a4766a784aec307f` |
| Git tag | `v1.1.0` |
| Signature | Ad-hoc local seal; not Developer ID signed or notarized |

## ⚠️ Honest limits

- Score annotations persist on the displayed PDF but do not rewrite/export the original PDF bytes.
- Manual marks are geometry, not optical/music recognition; multiple systems need multiple marks.
- Splitting a Tricky Section clears its marks because their correct half cannot be inferred safely.
- The complete real-piano session remains unrun; automated/native proof is not lived usability.
- The repository still lacks an off-disk private remote.

## ⟶ Next steps

1. Home → choose one star and confirm the exact piece opens.
2. Edit one Tricky Section's measures/note/color in Score, edit one mark, then confirm Details shows
   the same values.
3. Start a practice block from that section and confirm it stays grouped there in history.
4. Run the full at-piano session, then fix only friction Christian actually experiences.
