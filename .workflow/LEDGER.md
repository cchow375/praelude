# v7.0.0 Motivation Layer — Requirements Ledger (2026-08-23)

Spec: docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md (approved; Christian's "push to v7" 2026-08-23 clears the spec-review gate)

## Schema v15
- [x] 1. Drop session.focused_seconds (B74); event-derived metrics stays sole source of truth
- [x] 2. Add day_photo table (day key, app-data-relative path, content hash, created ts); images are files, never blobs
- [x] 3. Add dynamics calibration storage (profile: device id+label, ordered pp→ff measured levels, created ts; one active profile)
- [x] 4. v15 rehearsed on fresh live-DB copy (CODAKILLER_MIGRATION_COPY) before install; live DB never touched from dev code
## Plan A — Galaxy & Ritual
- [x] 5. A1 earned-only living galaxy: piece=star system (focused time→star size, mastered sections orbit, streak glow); deterministic ambient motion; NO physics sim; pure function of events; property test (identical event history ⇒ identical galaxy); replaces static Universe in place (same route + deep links)
- [x] 6. A2 day streak: day counts at ≥10 focused minutes (event-derived, configurable in Settings); current+best in Today AND Calendar; localtime day boundary per v6 convention
- [ ] 7. A3 photo calendar: at day close ("end my day" or midnight auto-close prompt at next launch) offer webcam capture (getUserMedia) + file-drop fallback; skippable in one keypress; Liftoff-style thumbnails in Calendar cells; practice-day-without-photo renders existing planned-vs-done bars unchanged
- [ ] 8. A4 completion animations: set complete, mastery landing, day close; <1.5s, deterministic, paper/ink language, never input-blocking, prefers-reduced-motion → static flourish; paired with existing chime/speech ack policy, no new audio path
## Plan B — Dynamics Checker
- [x] 9. B0 throwaway spike FIRST: cpal input + hear-CLI STT sharing one mic on M2 Air, both live; measure CPU/RSS of meter loop; if coexistence fails → push-to-measure fallback, Christian decides
- [x] 10. B1 level meter core (Rust): cpal → A-weighting filter → short-window RMS+peak streamed at panel rate; exposes dB figures and NOTHING else
- [x] 11. B2 calibration wizard: guided pp/p/mf/f/ff capture; named per-device profiles; recalibrate any time
- [x] 12. B3 live readout: floating dock panel (v6 dock family: draggable, minimizable, clamped) mapping level onto calibrated pp→ff band
- [x] 13. B4 target mode: user-triggered only; pick dynamic or crescendo range; shows zone + where playing landed; NO verdict writes, NO streak effects
## Plan C — Assistant Usefulness
- [ ] 14. C1 practice-data tools: read-only, confirm-gated, over deterministic read models (history days/detail, progress summary, per-piece/per-block stats, streaks); numeric claims ONLY from tool rows
- [ ] 15. C2 book-grounded coaching: 4-book corpus (Roskell, Gebrian, Breth, Gieseking/Leimer) retrieved against current situation, cited; suggestion-only
- [ ] 16. C3 planning help: on request, draft day plan from carry-forward + pass_seconds estimates + break science; user applies or ignores, never auto-imposed
- [ ] 17. C4 piece knowledge: grounded in open piece's actual metadata (edition, composer, regions, goals banner)
## Binding constraints
- [x] 18. Loudness only, forever: no pitch/onset/note detection, no transcription, no grading anywhere in Plan B
- [ ] 19. Earned-only: nothing in galaxy/streak/photo grantable, bought, backfilled, faked; no points/coins/levels; no social; no separate OS windows
- [ ] 20. 8GB M2 Air: no local ML runtimes, no FFT pipeline (weighting filter + RMS only); deterministic hot loop, LLM never in rep/metronome path; Assistant tools read-only + confirm-gated
- [ ] 21. Any voice-router/fast-path touchpoint re-passes narrated corpus (finals AND partial-stream) zero false mutations; no bare prefix word joins fast-path allowlist
- [x] 22. All 85+ legacy CSS token names preserved; paper design language throughout
## Process / verification
- [x] 23. Implementation plans written first (writing-plans format), one per subsystem + shared foundations
- [ ] 24. Per-slice fresh-context adversarial verification before anything counts done; vitest/cargo/tsc/clippy green at merge; commit per numbered item; lanes in ~/.ck-lanes/ (never session scratchpad)
- [ ] 25. 720×520 screenshot QA for every new surface (+ real window size)
- [ ] 26. B75: v7 QA runs measure mapping once on a real score (live datapoint)
- [ ] 27. Ship mechanics: version bump, tag v7.0.0, DMG, pre-install live-DB backup (SHA recorded), rollback tar.gz one-copy rule, install + re-sign, push to GitHub remote
- [ ] 28. Update protocol after ship: vault Changelog, CodaKiller.md, Roadmap, Flaws, Command Center, How To Use (+ Matches line), version record, repo NOTES.md, memory file
