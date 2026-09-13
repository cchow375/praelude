# (C) v0.4.0 — Version Record

> **Immutable once filed.** Shipped **2026-07-12**, commit `d3b7f6f`, git tag `v0.4.0`,
> installed at `/Applications/CodaKiller.app`. P4: real-PDF score workspace.

## What this version IS

The score becomes the practice surface. CodaKiller renders the user's real PDF edition and
connects it—lightly and honestly—to the existing Region → block → rep graph. It does not pretend
MusicXML knows printed PDF geometry and does not recognize notes from pixels.

## What shipped

- Bundled PDF.js + local worker; continuous scrolling, direct page jump, previous/next,
  fit-width/manual zoom, high-DPI cap, and visible-page ±1 canvas virtualization.
- Secure Rust edition discovery. Preferred edition survives rescans; validated exact PDF bytes
  cross raw Tauri IPC with no broad filesystem scope, base64, traversal, symlink escape, or
  cross-piece access.
- Edition-specific Region anchors: normalized page rectangles + PDF fingerprint, with visible
  mapped/unmapped/remap states. Multiple boxes, undo, save, clear, safe merge, and split
  invalidation.
- Region sidebar, clickable highlights, active-block overlap highlight, selected Region block
  history, and a prefilled **Practice this Region** block form.
- Silent deterministic commands: **“go to/show page N”** and **“go to/show measure N.”**

## Verification

- Frontend: **28 files / 145 tests passed**; TypeScript and Vite production build passed.
- Rust: **228 unit + 13 integration passed**; 5 live/hardware tests ignored; strict all-targets
  clippy passed.
- Real vault fixtures discovered: seven Scherzo editions up to **20.3 MB / 28 pages** and the
  **85-page** Cortot volume. The real database migrated to schema **v4** with
  `integrity_check = ok` and no foreign-key violations.
- Browser visual QA exercised Region select → map → drag → save → practice. It found and fixed
  score navigation scrolling an outer ancestor and hiding the toolbar.
- Installed bundle reports **0.4.0**, passes strict deep code-sign verification, launches, and
  quits without leaving CodaKiller/`hear` processes. Filesystem + Spotlight each find exactly
  `/Applications/CodaKiller.app`.

## Honest gaps

- Region boxes are manual page geometry, not measure/note recognition. Each edition needs its own
  mapping; replacing a PDF deliberately forces remapping.
- The full real-piano acceptance run is still pending. Automated and visual gates cannot prove
  Christian's voice/room/Steinway workflow feels good.
- The generated Tauri bundle required a manual ad-hoc re-sign after install; the installed bundle
  is valid, but P6 packaging must automate the signing/verification step.
- The brain, knowledge library, calendar/recovery, Practice Universe, references, and final
  packaging remain P5–P6.

## NEXT STEPS

1. Christian maps one Scherzo Region, switches editions, voice-jumps to its measure, and starts a
   practice block from the score during the at-piano acceptance run.
2. Feed any mapping/scroll/voice friction into a bounded v0.4.x fix.
3. Build P5: grounded conversational brain + cited method library, with deterministic planning
   and Gemini fallback—never LLM verdicts about playing.
