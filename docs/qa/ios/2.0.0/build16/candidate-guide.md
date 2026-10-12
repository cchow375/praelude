# Build16 — camera controls and physical acceptance

This describes the native2.0.0/build16/schema5 candidate. Read `personal-ipad-install.json` when present for actual delivery; simulator checks alone do not establish a working physical camera.

1. Open a score, choose **Score options → Camera gestures**, then **Enable camera**. The live preview opens. Sit as you will at the piano, relax your face and keep the iPad in its normal position. A stable recent face calibrates automatically; use **Recalibrate neutral face** after moving the iPad.
2. Under **Choose an expression for each command**, pick an expression or **Unassigned** for **Next page**, **Previous page**, **Clean**, **Sloppy** and **Again**. Each expression controls one command; moving it makes its previous command Unassigned and explains the change.
3. Available expressions are **Nod**, **Shake head**, **Grin**, **Open mouth** and **Close both eyes**. Nod up or down and return; shake to one side then the other and center. Hold a smile/open mouth briefly, then relax. Deliberate eye closure needs at least0.6seconds; ordinary blinks and a single closed eye are ignored.
4. **Sensitivity** offers Easy, Standard and Deliberate. **Expression hold** defaults to0.4seconds (0.2–1.2); **Time between commands** defaults to1.25seconds (0.5–3). Easy accepts smaller movements; the gesture must still finish and return to relaxed before a command can fire.
5. Test expressions in this panel: recognized input appears beside the preview, while score commands remain paused. **Available** names the gestures supported by current measurements. Missing pose or an individual landmark does not disable unrelated expressions; newly steady measurements can be recovered automatically without moving existing neutral.
6. **Show live preview** shows/hides the video without restarting capture; **Show face landmarks** controls the overlay. Use **Turn camera off** to stop capture. Startup/shutdown stays asynchronous; the button waits for shutdown before another camera can start.
7. Choose **Done** to use page commands on the score in Reading mode. Rep commands additionally need **Allow gestures to record reps**, a running set, score focus off and the first-attempt grade already chosen. The user supplies every verdict. Blocked contexts are explained rather than falsely reporting a recorded rep.

Frames stay on-device and are discarded; no video recording, face identity or cloud upload is added. Camera mappings remain device-local and do not alter practice schema/history or create continuous desktop sync.

## Physical acceptance still required

Start in the settings panel so testing cannot alter practice records. Repeatedly hide/show the actual live preview and landmarks, then disable/enable camera. Confirm no freeze/crash and that camera off ends capture. At normal piano distance/light, confirm automatic calibration and each assigned expression's recognition/return/cooldown. Then verify an assigned page command on the score and optional rep commands with deliberate input in an eligible set. Check rotation, background/return, interruptions and sustained practice separately.

No current physical crash stack proves the original crash cause. Source repairs, synthetic measurements and empty capture graph tests do not establish live-camera recognition or absence of future crashes.

**Next steps:** finish the scoped verification/delivery record, then obtain real preview/recognition evidence from the connected personal iPad. Keep the other iPad held unless Christian explicitly requests it.
