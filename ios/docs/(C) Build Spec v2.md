# (C) Praelude for iPad — Full Build Spec v2 (condensed working copy of Christian's spec, 2026-09-24)

## Current behavior override — November15, 2026

Christian's build22 feedback replaces the bulky dashboard/overdue pile with one bounded daily
passage round, delayed target recall, work/retention separation, short confidence rebuilding,
compact grouped navigation, shared piece target,75% unchosen starts and integrated visual beats.
`USING_MOBILE.md`, `(C) Rules Engine.md` and `docs/qa/ios/2.0.0/build22/` own the current candidate
contract. Source is2.0.0/build22/schema5, not physically installed. The condensed September spec
below is historical where it conflicts with these later decisions or the current AGENTS manual,
including its old filename-prefix/private-repository instructions. No personal content is bundled.


## 0. Ground rules

Audit every item as works / partially works / missing. Build on existing iPad app (ios/). Mac app (repo root: src/, src-tauri/) is behavior reference (set contracts, streaks, ladders, variants, routines, retention/review, warmups, rewards), not UI reference. Never lose user data (reps, passages, annotations, scores, profile survive updates, sync conflicts, sign-out/in, reinstall). Files authored get prefix "(C)". No service-role key in repo/app; only anon key. Repo must be private.

## 1. What the app is

Score reader + practice system for ANY musician on any instrument, plus social layer. Read music on iPad; mark trouble spots visually with finger; practice with metronome; speak verdict after each attempt ("clean","sloppy","again"); practice rules decide what next/tempo/slow down/split/stop/move on; spaced review (Anki-like); rewards, streaks, friends.

## 2. Non-goals

No audio grading. No AI/LLM in practice loop; deterministic rules that show reasons.

## 3. Design

3a Look: monochrome black/white/grays, at most one rare accent for live states. Light = "paper and ink", dark = "stage", both designed on purpose; score page paper-white in both. Typography: one characterful engraving/musical typeface + clean workhorse UI face; tabular figures for tempo/streak/BPM, large. NOT Inter, Geist, Instrument Serif, Fraunces; not cream+serif+sage. Custom consistent-stroke iconography, no emoji icons. Asymmetric layout, dense where needed, score is hero.
3b Banned: purple/indigo gradients, gradient text; glassmorphism everywhere, neon glow, blobs; rows of 3 identical cards; same corner radius everywhere; shadow+thin gray border on every card; colored left-edge line on panels; pill badges above headlines; same fade-in everywhere; bouncy effects everywhere; default component-library look; generic 3D illustrations; vague motivational copy.
3c Motion: spring-based, interruptible gestures, spatial transitions (passage expands out of score; completed set collapses into history; page turn feels like paper). Every animation communicates. Celebrations only at meaningful moments, never mid-attempt. 120fps ProMotion, no dropped frames while metronome runs. Reduce Motion alternatives. Haptics on verdicts, set completion, toggles.
3d Ergonomics: primary controls large at edges; practice HUD readable at ~1 m; nothing covers music while practicing; start/stop, metronome, tempo, verdict fallback, undo always one tap; portrait+landscape+split view.

## 4. Accounts, profiles, sync (Supabase)

4a: Supabase project, schema as migrations in repo, RLS on every table (own-private; friends per privacy settings), storage buckets (profile photos, score PDFs private, recordings private, note media) with policies.
4b Auth: Sign in with Apple, email+password, magic link, password reset, sign out, in-app delete account (removes all data+storage), offline guest mode upgradeable without data loss.
4c Profile: display name, unique @username, photo, bio, instruments (primary+others with level), teacher/school optional, coarse location optional, currently-working-on pieces, upcoming performances, join date. Stats: current streak, longest streak, total practice time, pieces performance-ready, ranks/badges. Per-field privacy Public/Friends/Only me (default Friends except name/username/photo). Edit + preview-as-others.
4d Sync: offline-first; syncs library/scores, annotations, passages, reps/sets (append-only), scheduling state, settings/variants/routines, rewards, profile. Conflicts: rep logs append-only; field-level last-write-wins; annotations merge by stroke. Quiet sync status indicator + stuck message. Same account on iPhone; layout adapts.

## 5. Social

5a Friends tab: activity feed (session finished, streak milestone, passage performance-ready, new piece, performance date set, note posted, rank/badge). "Practicing now" live presence strip. Friend cards (photo, name, instrument, streak, current practice). Reactions (music-flavored) + comments. Notes (Instagram-Notes style, 24h, optional piece, private replies).
5b Connections: username search, invite links + QR, opt-in contacts suggestions, friend requests accept/decline, private accounts approve followers, shared repertoire (same piece/composer), studios/groups with shared goals, friends-only weekly leaderboards (time, days, reviews) opt-out.
5c Safety: report user/note/comment, block, offensive-text filter on usernames/notes/comments, developer contact, moderation queue in Supabase, Settings for who sees presence/streaks/pieces/notes, conservative defaults (no location/school unless shared), age gate + stricter defaults for minors if public.

## 6. Instruments

Onboarding instrument pick: keyboard, strings, woodwinds, brass, percussion, voice, guitar/plucked, other. Adapts: parts wording (Hands RH/LH/Both for keyboard; strings LH only/bow only/together; etc.); instrument-appropriate variant defaults (keyboard dotted/hands separate/blocked chords; strings open strings/bowing/slurred-separate; winds articulation/slurred-tongued/breath; voice vowel/"nee"/rhythm only); tuner + drone for non-fixed-pitch; transposition awareness (concert vs written). One-tap instrument switch; each piece tied to an instrument. Voice commands work for all instruments incl. winds/voice (verdicts spoken between attempts).

## 7. Library & score reader

Import: Files, share sheet, AirDrop, iCloud Drive, cloud providers; photos/camera multi-page scan to cleaned PDF; original always kept. Library: cover grid + list; title, composer, instrument, tags, difficulty, status Active/Completed/Resting, folders; search; sort by recently practiced/title/composer; auto covers + custom cover. Setlists (ordered pieces/movements). Reading: instant sharp render incl heavy scans; portrait single + landscape two-page; half-page turns; swipe or tap-zone turning; performance mode (locks UI, hides chrome). Annotations: Pencil+finger; pens, highlighter, eraser, lasso move/resize, undo/redo, colors/widths; music stamps (fingerings, dynamics, breath marks, bowings, accidentals, circles, "watch" glasses); text boxes; layers mine/teacher/performance show/hide; never modify PDF. Page tools non-destructive: crop margins per page/all, rotate, reorder, delete, insert blank/staff pages. Links: tap repeat/D.S./coda to jump, jump-back. Bookmarks: movements/sections with quick jump menu. Export annotated PDF; share piece with friend incl annotations optionally. Resume position per piece.

## 8. Passages

Draw box with finger/Pencil = passage (only requirement). Multi-region, multi-page; practicing auto-turns pages. Measure numbers optional one tap, never asked. Subtle outlines on score; tap outline -> practice immediately; long-press -> edit/rename/recolor/split/merge/delete. Quick-create sub-passage by drawing while practicing. Deleting archives history, never silently erased.

## 9. Voice control

Words: Clean (counts), Sloppy (resets), Again (neither), Undo. Set control: Start, Stop, Pause, Slower, Faster, Tempo [number], Metronome on/off, Next. Cold attempt grading: Clean/Shaky/Missed. On-device only, offline, fixed vocabulary, robust to ringing acoustic instrument (essentially never false-triggers), ~0.5 s latency, every command confirmed visibly+audibly (distinct sound per verdict + HUD flash), Undo by voice/tap, misrecognitions logged locally, mic indicator always visible + one-tap mute, works with metronome playing (click never misheard). Fallback large on-screen verdict buttons always present. Onboarding voice setup (say each word a few times to check recognition in room).

## 10. Practice loop

10a: from anywhere to practicing in <=2 taps (tap passage, then Start). Defaults from rules + last session. Tempo in one gesture: drag/scroll on number, ±1/±5, tap tempo, voice. Never a modal/keyboard.
10b: Contract Clean streak (N consecutive Clean at working tempo, optional ladder) or Total plays. Goal of set: Tempo, Notes & accuracy, Phrasing, Dynamics, Memory, Parts/Coordination, Other; non-tempo goals turn click off by default. Tempo ladder start/target/step, advances after clean streak per rung. Variant chains ordered with per-variant clean target; saved variants and routines reusable. Pause/resume set with state intact.
10c HUD: streak/goal huge, tempo, ladder rung, variant, passage name, mic indicator; at screen edge never over passage; collapsible to strip. After every set, one-line next step with reason.

## 11. Rules (all on by default, editable params in Settings, one-line reason when fire, one-tap override, overrides logged)

R1 small chunks (~4 measures; box > ~2 systems -> suggest split). R2 join the seams (two neighboring passages in Review -> offer join passage). R3 cold attempt first of day graded Clean/Shaky/Missed drives schedule. R4 spaced review New->Learning->Review->Performance-ready; Clean grows gap 1->3->7->14->30 d; Shaky -> 2 d; Missed -> Learning due tomorrow; history kept. R5 streak goal 5 Learning / 3 Review; Sloppy resets; Again neutral. R6 slow down: 3 resets in a row without half goal -> drop one tempo step (~6% or ladder step). R7 speed up: finishing set -> next set up one step toward target, max 2 increases/passage/day. R8 split weak spot: after Sloppy optional tap where it broke; 3+ clustered taps -> offer sub-passage. R9 stop grinding: 10 min or 3 sets w/o progress -> park "Back tomorrow". R10 performance-ready: clean cold at perf tempo on 3 different days incl one as first thing in session. R11 performance date: cap intervals, all reviewed final week, run-throughs final 2 weeks, flag not-ready. R12 variants when stuck: 2 slow-downs in a day -> suggest variant chain. R13 parts separately: 2 consecutive Missed cold -> suggest parts separately. R14 pulse check: near target tempo, metronome drops out N bars (default 2) then returns. R15 session builder: available time -> due reviews (nearest perf date first), learning, <=3 new, run-throughs if perf near, warmups at start; drag reorder, skip; skipped stay due.

## 12. Warmups, scales, technique

Library of instrument-appropriate scales/arpeggios/exercises (major, all minor forms, modes, chromatic, thirds/sixths/octaves, custom from user-drawn passage). Instant choosing: one-tap "Next in rotation", favorites, last used, visual key picker (circle of fifths or keyboard/fingerboard). Same metronome/verdicts/ladders/rules/rewards. Rotation covers all keys and shows neglected keys.

## 13. Metronome, tuner, drone, recording

Metronome sample-accurate, zero drift 10+ min under UI load; meter, subdivisions, accents, count-in, several sounds (one cuts through loud instrument), volume, visual pulse; ladders; pulse-check dropouts; tap tempo; runs in background/screen locked if chosen. Tuner (non-fixed pitch) and drone (any pitch, timbre, volume, alongside metronome). Recording: optional per-rep/per-set; tap passage to hear last recording; compare today vs week ago; never graded; storage use shown + cleanup.

## 14. Rewards

Port Mac reward system: verdict sounds, set-completion finales, layered reward sounds, ranks & divisions, coins, Studio (room/shop/furnishings), streaks. Improve: reward honesty (coins from completed reps/sets, on-time reviews, performance-ready passages; Sloppy never punished). Daily practice streak (15 min or 1 set), earnable streak freezes. Big celebrations: passage perf-ready, piece fully ready, new rank, streak milestone; small for set completion; none mid-set. Sound design musical, in tune, never confusable with metronome; volume/intensity settings. Share milestones to feed auto/manual. Badges (30 days reviews on time, first perf-ready piece, all 12 keys in a month...).

## 15. Today, history, calendar, notebook

Today: session (R15), due reviews, streak status, one-tap Start session, upcoming performances w/ countdowns. Calendar: practice days, time/day, performances. History: sessions, sets, per-passage history (grades/tempos over time), CSV/JSON export. Notebook: daily notes per piece, lesson notes, lesson-prep list; one tap -> Note (5a).

## 16. Data

Score heatmap (passages + break-point taps colored by recent results; toggle). Session summary (moved up, dropped back, parked, due tomorrow, time). Piece readiness (states, days to performance, at risk). Weekly recap shareable to friends.

## 17. Testing

17a: rep log survives force-quit mid-set, offline, sign-out/in; two-device sync identical history; RLS tests; metronome 10 min @120 aligned with UI load; voice real-room 100 commands >=98%, <1 false trigger/10 min, with metronome; every rule R1–R15 fires on staged data + reason + override; cross-page passages; annotations aligned across rotation/zoom/crop/sync.
17b UX audit: screenshots every screen portrait/landscape, smallest/largest iPads, split view, light/dark, largest Dynamic Type; checklist (overlap, covers music, >1 tap for key actions, taps to first rep <=3, tempo pain, scale choice 1 tap next/<=2 specific, conditions <=2 taps, targets <44pt, HUD 1 m, 3b tells, stutter, empty states, copy, first-timer to first set < 3 min). Save as "(C) UX Audit.md".

## 18. Done

All sections implemented, audit all "works", functional + UX pass, two-device sync demo, real voice-only session.
