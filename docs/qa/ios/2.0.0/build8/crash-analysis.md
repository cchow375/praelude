# Physical build7 freeze analysis — October 9, 2026

The six physical-iPad crash reports (three from October 7 and three from October 9) and one CPU-resource report agree on one recurring failure: a SwiftUI responder-graph cycle while PDFKit removes a focused score overlay during a page change. This is stronger evidence than the earlier simulator-only responder hypothesis. It does not prove every reported freeze or microphone crash has this cause.

## Evidence and symbolication

- All six crash reports identify app version 2.0.0, build 7. Each is a main-thread watchdog termination (`EXC_CRASH` / `SIGKILL`, `0x8BADF00D`) after the process failed to exit within five seconds. Thermal state is nominal.
- The available build7 arm64 dSYM's Mach-O UUID, inspected with `dwarfdump --uuid`, exactly matches the application's image UUID in all six reports. Symbolication used that matching dSYM, each report's application load address, and its application-frame address with `atos -arch arm64 -o <matching DWARF> -l <load address> <frame address>`.
- All six resolve the same application frame to **`PagedScoreView.updateUIView(_:context:)`, build7 `PagedScoreView.swift:239`**: the call to `view.go(to: target)`.
- The CPU report records **90 seconds of CPU time across 90 seconds, averaging 100% CPU**. All 23 sampled stacks follow the same application/PDFKit/responder/SwiftUI path. Its reported action is `none`; it is evidence of sustained spinning, not a separate termination.

The relevant call chain, in call order, is:

```text
SwiftUI updates the UIViewRepresentable
  PagedScoreView.updateUIView(_:context:) -> view.go(to: target)
  PDFView changes the visible page
  PDFDocumentView removes the old page view
  PDFOverlayViewsController uninstalls its overlay
  UIView.removeFromSuperview / __UIViewWillBeRemovedFromSuperview
  UIResponder.resignFirstResponder
  repeated UIView/UIResponder._setFirstResponder
  SwiftUI._UIHostingView._didChange(toFirstResponder:)
  SwiftUICore.ViewRendererHost.responderNode / updateViewGraph
  AttributeGraph update stack / print_cycle
```

The stall occurs while the representable's existing SwiftUI update is still on the stack and the removal synchronously requests another responder-graph update. The samples show an active graph cycle, rather than a database write, JSON encoding, audio-engine operation, or speech-permission check. These reports therefore support the navigation/responder repair; they do not independently verify the separate speech repair.

Raw reports, device identifiers, process identifiers, user paths, and the private device diagnostic archive remain outside Git. Only the sanitized stack and methodology above are recorded here.

## Candidate repair

`updateUIView` now enqueues the latest requested configuration on the next main-queue turn. Multiple SwiftUI refreshes before that turn coalesce into one application. PDF document replacement, display-mode/parity changes, page navigation, and overlay refresh therefore occur after the representable update has unwound. Programmatic reconfiguration captures its requested page and suppresses PDFKit's transient page-change notifications, so replacement/reflow cannot reset the SwiftUI binding to page 1. Queued updates are discarded when the score is dismantled. PDF overlay-provider cleanup is deferred outside the dismantle transaction for the same reason.

The candidate also removes the hidden tool picker and app-forced canvas focus while retaining native PencilKit responder eligibility for lasso/edit commands. Per-page UndoManagers prevent page histories from sharing a responder-derived manager. Those changes are complementary; removing the forced focus alone would not address a native canvas that legitimately becomes first responder.

Durable checkpoint gates remain in place before page/layer/document changes. Deferring the view update does not mark unsaved ink as saved or bypass a failed checkpoint.

## Regression coverage and limits

`FocusedPDFNavigationTests` adds a real `UIHostingController` + PDFKit hierarchy. It makes each attached PencilKit canvas first responder, marks the page dirty, repeatedly changes SwiftUI's page binding, verifies the prior drawing was checkpointed, changes single/two-page display and replaces the document while retaining requested page 3, and closes the focused score. A second test verifies page-change coalescing and that canceled queued work cannot navigate a dismantled score. A third proves a failed checkpoint blocks page, display-mode, and document changes before PDFKit mutates its hierarchy.

The deferred coordinator explicitly observes the state read by its update. The live-host regression changes pen width/color, finger-drawing policy, and externally saved ink without reading those values in the host's body; each change must reach the attached native canvas. This closes the observation gap exposed by the first deferred-update test run.

The pinch/swipe regression now loads an actual PDF before asserting zoom behavior: PDFKit ignores scale-factor changes without a document, which invalidated the first test harness's claimed zoomed state.

**Native verification checkpoint:** the iPad app-hosted9 run (`/tmp/praelude-build8-ipad-hosted9.log` and matching `.xcresult`) executes **241 tests, with 1 live-account test skipped and 0 failures**. All three focused-navigation regressions, both full-hierarchy touch-routing tests, actual tool-width/color/policy checks, and asynchronous checkpoint cases pass. The earlier hosted8 aggregate retained three failures; its findings drove explicit deferred-state observation and native layout-aware assertions before the successful full rerun. The later UI6 full native checkpoint executes 242 tests with 1 live-account skip and 0 failures. UI5 continuity and UI7 tempo/goal/large-text flows pass; UI8 passes 13 selected annotation/focused-navigation tests. Actual sticky dragging now reaches its destination, but moved-note double-tap editing fails in UI8/9; UI10 failed to reveal the palette; unchanged UI11 reproduced the editor failure and identified a winning single-tap recognizer. The local note multi-tap and pinned selection repairs pass iPad UI12:243 native tests/1 live-account skip/0 failures, plus actual sticky drag/edit/relaunch and accessibility portrait/landscape. Phone1 completed242 native/1 skip/0 failures but its earlier accessibility selection case failed. Phone2 actual rename passes and selection Done is reachable in both orientations, but landscape annotation fails on its tool viewport; the short-writing repair subsequently passes Phone3 accessibility portrait/landscape in 71.631 seconds with independently accepted screenshots. UI13 records two assertions in one note-frame case and a missing actual triple-tap target; the subsequent public-API accessibility repair passes source review and test-build9, with UI14 actual sticky double/triple-tap/permission-denied recovery passing in 71.060 seconds. UI14 native245/1 skip retains two zoom-frame assertions; the narrow coordinate-conversion repair required a further test-fixture correction; final acceptance is recorded below. UI12 does not cover later source edits. These touch-flow checkpoints remain separate from physical acceptance. Those sticky failures do not erase the focused-navigation evidence or establish physical acceptance.

A simulator pass remains separate from sustained Pencil/page/mode behavior on the physical iPad. The six historical crash reports identify the failure path; they cannot certify that the new build is free of all freezes.

**Final source acceptance and delivery checkpoint:** the final native run passes245 tests/1 live-account skip/0 failures in16.881s, including strict crop/zoom checks after a test-only mounted-scene/window correction. UI15 actual complete sticky triple-tap/permission-denied recovery passes59.539s on the same final production source; Phone3 accessibility and scoped source/visual review pass. UI13–15 frame failures remain in the usability ledger. The first two signed device Release attempts failed before compilation with No Accounts / No Profiles; the user now confirms restored sign-in and the final signed build is running. Signing/profile checks and installation remain pending. Build7 remains installed and unchanged.

**Next steps:** finish the candidate's touch-flow acceptance, then perform the guarded same-bundle physical update and explicitly verify repeated focused-canvas page turns and annotation exit on the iPad. Retain the physical diagnostic boundary until that acceptance is observed.
