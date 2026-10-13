# Build18 camera controls

Target physical setup: user-reported face distance 2.5–3 feet (about0.76–0.91m), upright iPad. This setup is not yet a measured recognition or latency pass.

Open a score → Score options → Camera gestures. Enable camera and calibrate while seated normally, looking at the score. The labels in settings are tests only; score commands remain paused there.

- Next page uses **Look right**; Previous page uses **Look left**. Turn your head slightly toward the corresponding shoulder. These are head looks, not eye-only gaze.
- **Look down** lowers your chin relative to your calibrated score-reading position and controls the assigned command. Fresh defaults use Clean; versioned decoding moves an existing nod verdict to Look down. Other verdict assignments and opt-in remain intact.
- A quick look fires on its measured onset, before return. Center your head briefly to re-arm. Holding a look issues one command. **Head-look interval** defaults to0.4s and adjusts0.25–1s; **Sensitivity → Easy** accepts smaller head movement. Expression hold does not delay quick looks.
- Choose an expression for each fixed command. Moving an expression clears its previous command. Older Shake head or Nod mappings show **paused** while quick looks use that same axis; choose another expression or unassign the conflicting quick looks.
- After a short 3D tracking loss, the same camera stream can use **Distance camera landmarks** for the rest of the session, recalibrating once. Stop/re-enable retries3D tracking. Face frames/measurements stay local and are discarded.
- Recent signed motion can continue through a loss of at most0.3s. Disappearance does not issue a command. Strong rising horizontal evidence plus measured neutral reacquisition may finish one page turn; it never infers a rep. Multi-face, dark, stale, prolonged loss and tracker changes revoke unfinished motion. Once a command is recognized, later tracking loss or automatic fallback does not discard its pending save; explicit camera Off, remapping, calibration, rotation or score-context changes still cancel it.
- Rep commands still require **Allow gestures to record reps**, a running set, score focus off and the first-attempt choice complete. Resume paused practice before reporting real reps.

Native and synthetic results do not establish camera range, real direction alignment, recognition reliability or page/rep responsiveness. Test those at the piano after installation.

Next steps: complete final package/delivery gates, then check right/left/down at the stated distance and report misses, accidental commands or pauses.
