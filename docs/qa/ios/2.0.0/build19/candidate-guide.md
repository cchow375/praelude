# Build19 candidate — phone practice and passage cards

Date: 2026-10-16. Native 2.0.0/build19/schema5 source candidate. This guide describes Build19, now installed/opened/read back on the personal iPhone. The personal iPad remains Build18 and friend iPad Build12; new tablet controls remain source/simulator-verified until a separately authorized update. Mac v11.1.0/schema21 is unchanged.

## Practice from paper or a PDF

On iPhone, open a piece or a card to see Counter by default. iPad keeps Score by default; choose Counter above the score for the same paper-friendly controls. The device remembers that display choice. Score remains available for reading, annotation and selecting passages. During Counter practice, the music thumbnail identifies the target while the large repetition counter, verdicts and click controls take priority.

Use Clean, Sloppy or Again after playing. These are your reports; Praelude does not judge piano audio. A clean-streak set counts consecutive Clean reports, while a total-plays set counts plays. Undo reverses the last repetition. Pause stops active practice time; Stop ends the set. Metronome on/off, exact tempo, tap tempo and small tempo nudges remain available. Existing sound/haptic preferences apply to saved-verdict feedback; Reduce Motion applies to the new button/count animations.

## Make and review visual cards

Open the separate Passages tab (iPhone) or Passages sidebar destination (iPad). All existing nonarchived PDF selections appear as cards. The first stored selection box is the cover, even if later boxes are on earlier pages; the complete set of boxes remains on the score and in practice history.

Choose Add photo to photograph a passage from paper or select Photos. Drag the crop corners or use Fine tune crop, rotate if needed, and optionally improve paper contrast. Retake or choose another photo before saving. Enter the work title and an optional passage name/focus. Only the crop is saved. Each photo is an immutable one-page private score asset with an ordinary passage; multiple photos never overwrite a shared score. Photo entries are visibly identified and placed in a Photo passages folder in Pieces. You can keep using your paper score throughout.

Tap an image to enlarge it. Practice opens the usual first-attempt/arming workflow. Grading the first attempt Clean, Shaky or Missed drives the configured review ladder; ordinary repetition buttons do not move the review date. Start without grading remains available when exploring new music. Due cards and Today show saved music and dates. Review details shows the actual first-attempt history, timing and the current Rules configuration. Opening or skipping a card never grades it. Overdue is a reminder, never a playing failure.

## Ten additional practice tools

1. **Reference-tempo percentages (50/75/100%)** — move deliberately between slow work and a stated goal; earlier reps retain their actual tempo.
2. **Return to last clean tempo** — recover the last successful tempo within this set after experimenting too fast.
3. **Hand-rest timer (30/60/120 seconds)** — pauses practice and the click; it never resumes or records a repetition automatically.
4. **Optional counter screen wake** — keeps the controls visible only during running practice, with ownership restored on exit/background.
5. **Shuffle visible cards** — vary starting points without changing due dates or manufacturing grades.
6. **Recall and reveal** — optionally picture the opening before revealing the music; all verdicts remain yours.
7. **Unpracticed-card filter** — find passages with no effective saved reps, excluding undone attempts.
8. **Pinch-to-enlarge passage image** — inspect music without opening a complete digital book.
9. **Hide a review until tomorrow, with Show today** — defer a card explicitly without rewriting its due date or erasing history.
10. **Calendar session drill-down** — select a marked practice day to see the sessions, target images and saved repetitions behind the totals.

New surfaces also expose existing hand-specific recording, focus cues, active time, count-in, meter, sound and tempo entry. These are not counted as newly invented practice engines.

## Sync and acceptance

Use the same Supabase account on both native devices. Private PDFs (including photo crops), passages/regions/schedules, annotations, practice records, recordings, supported preferences and planning fields use the existing owner-scoped queue/storage protocol. Offline edits stay local until uploaded; a signed-in label alone does not prove another device has downloaded every asset. Counter display, temporary rest, shuffle/recall and camera preferences are device-local. Active live sets do not move between devices. The installed Mac remains a separate product; Mac import is an additive snapshot, not continuous Mac/native sync.

Source/native/simulator/backend evidence and remaining physical/two-device gates are recorded in practice-cards.md. No flawless-camera, audible-click, zero-lag or real-account convergence claim is made from a simulator run.

## Next steps

Scoped native/UI/unsigned Release verification passes. Signed first-install/open/readback on the personal iPhone also passes; see personal-iphone-install.json. Further device delivery requires its own guarded update. Physically test camera/Photos/retake/crop in both orientations, audio/haptics, interruptions, phone legibility at the piano, and offline two-device account convergence without touching personal data during automated tests.
