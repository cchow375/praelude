# Build12 candidate guide

This describes candidate source, not the installed build11. Installation and physical acceptance
remain separate. See [practice-upgrade.md](practice-upgrade.md) for current gates and all19 items.

- **Focus:** while reading, tap the center third near the top or bottom16% of the score, or use
  Score options → Focus. Controls and rep count hide. Rep recording, rep Undo and Reset are
  suspended; the set and prior history remain. Use Exit focus or the same middle-edge tap to
  restore counting. Listening can continue for other supported commands.
- **Control position:** tap the up/down control beside the microphone, or use Settings → score
  controls position. The main dock and annotation entry move together. The preference is local
  to this device. The microphone starts hands-free mode directly; its active button opens the
  hands-free panel.
- **Hands:** L / Both / R sit directly above Clean in a running set. The choice is captured for
  the next reported verdict; switching it does not change older reps or the original set contract.
- **Passage names:** double-tap the selected passage name to rename it. Today → Name and
  organize passages opens a searchable naming list without opening a score or beginning practice.
  Pencil buttons provide an explicit alternative to double-tapping.
- **Reading:** tap a white side margin to turn a page; left goes back, right advances. Top/bottom
  middle focus zones take precedence. Drawing, passage selection and modal editors retain their
  own gestures. Page buttons and keyboard arrows remain available. A250ms deferred bookmark write
  keeps persistence out of the immediate turn callback; closing/backgrounding flushes the bookmark.
- **Drawing:** Undo/Redo follow queued edits in order and reject obsolete asynchronous saves.
  Clean recent-page histories are retained for two detached pages; memory pressure can evict older
  Undo histories while saved ink remains. Huge pages use a normalized native canvas so PencilKit's
  width clamp does not collapse Fine/Medium/Bold into the same stroke.
- **Stamps:** accidentals come first in rows. Collapse stamp choices or minimize/move the palette
  to uncover the score. Pencil lift places a stamp; a finger creates a preview and Place confirms it.
- **Notes:** open Formatting for background color/opacity or Transparent, text color, size, font,
  emphasis and alignment. Resize from a corner. Text shrinks within the box to a12-point floor.
  The expanded reading inspector uses readable system colors; your chosen colors remain saved
  for the score and PDF export.
- **Voice:** Score options → Hands-free commands → Customize command phrases lets you add up
  to three phrases per supported action; built-in phrases remain available. Tempo phrases are a
  prefix followed by a number. Conflicting phrases are rejected with an editable error. Repaired
  or ambiguous phrases require confirmation; Cancel/expiry leaves history unchanged. Only actions
  supported in the current context are offered. Microphone diagnostics show permissions, route,
  ownership, received audio and recognition timing. Simulator checks do not prove speech over piano.
- **History:** Score options → Practice balance & full-tempo target, or History → By piece. Set
  an optional20–300 BPM full-tempo reference, using the same beat unit as practice BPM. It is separate
  from Start and Tempo goal. New sets capture it; older BPM is preserved and comparisons explicitly
  use today's reference. Last14 days, All history and individual session views show hands, tempo
  bands (including20–30% around quarter tempo), named variants, reps and sessions. Optional minimum
  shares define the suggested signal. Missing attribution or sparse records show insufficient
  information; this is not a judgment of playing or a prescribed practice mix.
- **Measure map:** Score options → Score tools → Measure map. Choose a source page, drag a box
  around one bar or system, enter first/last measure (same number for one bar), and confirm. Tap a
  confirmed range to correct it. Draw passages fully within confirmed regions to use their labels.
  A system rectangle yields the whole system range, not exact individual bar locations. Scan printed
  numbers provides untrusted hints; confirm them manually. Real-score host scanning succeeds but
  actual iPad map correctness and manual-flow acceptance remain pending.

## Next steps

Source/native/scoped iPad review and signing pass. The personal iPad is connected and its fresh
preflight has a completed set. Commit/tag and run guarded refresh, then check complete file
preservation and launch/readback. Physically check focus/count resumption, both control positions,
rapid ordinary/huge page turns, Pencil Undo/Redo through zoom/save/relaunch, brush widths, stamp lift,
transparent-note readability, commands over piano and a manually confirmed real-score measure map.
Phone largest-text stamps/actual landscape and real-account sync remain unaccepted.
