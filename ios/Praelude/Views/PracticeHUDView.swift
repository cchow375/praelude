import SwiftUI

/// §10c: "HUD: streak/goal huge, tempo, ladder rung, variant, passage name, mic indicator; at
/// screen edge never over passage; collapsible to a thin strip." Lives in `ScoreWorkspace`'s bottom
/// `safeAreaInset`, the same structural placement the practice dock already used — a `safeAreaInset`
/// reserves its own screen region rather than floating over content, which is what already keeps
/// nothing covering the score; collapsing only shrinks the big readout, never the controls
/// (§3d: "start/stop, metronome toggle, tempo, verdict fallback, undo always one tap" — collapsing
/// the HUD must never take any of those below one tap away).
struct PracticeHUDView: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("ios.hudCollapsed") private var collapsed = true
    var active: ActiveSet
    var passageTitle: String
    var arm: PracticeArmController
    var speech: SpeechCommandService
    var voiceOwnerID: UUID
    var flashedCommand: VoiceCommand?
    /// A fresh id per confirmation, even for the same repeated word, so the flash below re-triggers
    /// its transition every time rather than only on the first of a run of identical commands.
    var flashedCommandID: UUID?
    var onVerdict: (Verdict) -> Void
    var onUndo: () -> Void
    var onTogglePause: () -> Void
    var onStop: () -> Void
    var onFinishSession: () -> Void
    var onAnotherSet: () -> Void
    var onToggleMetronome: () -> Void
    var metronomeOn: Bool
    /// §10a "tempo in one gesture... never a modal": the running/paused set's own tempo, a direct
    /// drag/nudge target on the dial below — not display-only while a set is active (see
    /// "(C) Audit.md").
    var onAdjustTempo: (Double) -> Void = { _ in }
    var onMuteVoice: () -> Void
    var onVoiceOff: () -> Void
    var onApplySuggestion: (Decision) -> Void
    var onDismissSuggestion: (Decision) -> Void
    /// §8: draw one box without stopping the set — a new sub-passage, not a mode change, so the
    /// dock/HUD/music never move. `quickSubPassageArmed` mirrors `ScoreMarkupState.quickBoxArmed`
    /// so the button can show/disable itself without the HUD needing that type.
    var quickSubPassageArmed = false
    var onQuickSubPassage: () -> Void = {}
    var offersBreakPoint = false
    var onMarkBreakPoint: () -> Void = {}
    var onSkipBreakPoint: () -> Void = {}
    /// R14 (§11): non-nil while the metronome is mid-pulse-check for this set. The verdict buttons
    /// stay exactly as they are during one — the player's own judgement is still what counts.
    var activePulseCheck: Decision?
    var onDismissPulseCheck: () -> Void = {}

    private var ladderRung: (rung: Int, total: Int)? {
        PracticeUXHelpers.ladderRung(startBPM: active.configuration.startBPM, targetBPM: active.effectiveTargetBPM,
                                      currentBPM: active.currentBPM, step: active.configuration.tempoStep)
    }

    var body: some View {
        VStack(spacing: 10) {
            if active.isComplete {
                completedSection
            } else {
                if collapsed { collapsedStrip } else { expandedReadout }
                if let activePulseCheck { pulseCheckBanner(activePulseCheck) }
                if let coldGradeDecision = arm.lastColdGradeDecision { reasonBanner(coldGradeDecision, identifier: "coldGradeReason") }
                controlsRow
            }
            micRow
        }
        .overlay(alignment: .topTrailing) {
            if let failure = flashLabel {
                // Confirms a spoken command that just fired while the player is very likely looking
                // at the score, not the HUD — the same legibility-at-a-distance need as the title line
                // above (see "(C) Audit.md").
                Text(failure).font(.title3.weight(.semibold)).foregroundStyle(PraeludeColor.live)
                    .padding(8).praeludeScoreChrome()
                    .transition(.opacity).id(flashedCommandID).accessibilityIdentifier("voiceFlash")
            }
        }
        .animation(reduceMotion ? nil : PraeludeMotion.tap, value: collapsed)
    }

    private var flashLabel: String? { flashedCommand.map(VoiceConfirmationSound.label(for:)) }

    // MARK: - Running / paused

    private var expandedReadout: some View {
        VStack(spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    // §3d/§10c: readable from playing position, not just up close — see "(C) Audit.md"
                    // (this line measured well under the 20/20 acuity floor at arm's length at its old
                    // `.subheadline`/`.caption` sizes).
                    Text(passageTitle).font(.title3.weight(.semibold)).lineLimit(1)
                    HStack(spacing: 8) {
                        if let stageName = active.currentStage?.name {
                            Text(stageName).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
                        }
                        if let ladderRung { Text("Rung \(ladderRung.rung) of \(ladderRung.total)").font(.subheadline).foregroundStyle(PraeludeColor.inkTertiary) }
                    }
                }
                Spacer(minLength: 8)
                Button { collapsed = true } label: { Image(systemName: "chevron.down").frame(width: 44, height: 44).contentShape(Rectangle()) }
                    .accessibilityLabel("Collapse HUD").accessibilityIdentifier("hudCollapse")
            }
            let readoutLayout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(alignment: .center, spacing: 20))
            readoutLayout {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("\(active.progressCount)").praeludeNumeral(48, weight: .bold)
                    Text(" / \(active.requiredCount)").praeludeNumeral(24, weight: .medium)
                }
                    .foregroundStyle(PraeludeColor.ink).monospacedDigit()
                    .contentTransition(.numericText())
                    .accessibilityIdentifier("repProgress")
                    .accessibilityRepresentation {
                        Text("\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean" : "plays")")
                            .accessibilityIdentifier("repProgress")
                    }
                Spacer(minLength: 0)
                // §10a "tempo in one gesture... never a modal" applies even mid-set: drag/±1/±5 must
                // stay live, not merely a locked, dimmed readout — see "(C) Audit.md".
                VStack(spacing: 2) {
                    TempoDial(bpm: Binding(get: { active.currentBPM }, set: onAdjustTempo), numeralSize: 44)
                    if metronome.groupedCompoundPulse { Text("Dotted-quarter pulse").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private var collapsedStrip: some View {
        Button { collapsed = false } label: {
            HStack(spacing: 12) {
                Text(passageTitle).font(.subheadline.weight(.medium)).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(active.progressCount)/\(active.requiredCount)").praeludeNumeral(20).foregroundStyle(PraeludeColor.ink)
                Text("\(Int(active.currentBPM))").font(.subheadline.monospacedDigit()).foregroundStyle(PraeludeColor.inkSecondary)
                Image(systemName: "chevron.up").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
            }.frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("Expand HUD").accessibilityIdentifier("hudExpand")
    }

    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                transportControls
                verdictControls
            }.fixedSize(horizontal: true, vertical: false)
            VStack(spacing: 10) {
                transportControls
                verdictControls
            }
        }
    }

    private var transportControls: some View {
        HStack(spacing: 4) {
            Button(action: onUndo) { Image(systemName: "arrow.uturn.backward") }
                .buttonStyle(.praeludeEdgeControl).accessibilityLabel("Undo last repetition").accessibilityIdentifier("undoRep")
                .keyboardShortcut("z", modifiers: .command)
                .disabled(!active.attempts.contains { $0.undoneAt == nil })
            Button(action: onTogglePause) { Image(systemName: active.status == .paused ? "play.fill" : "pause.fill") }
                .buttonStyle(.praeludeEdgeControl).accessibilityLabel(active.status == .paused ? "Resume practice" : "Pause practice")
                .accessibilityIdentifier("pausePractice")
            Button(action: onToggleMetronome) { PraeludeIcon(glyph: .metronome, size: 20) }
                .buttonStyle(.praeludeEdgeControl)
                .accessibilityLabel(metronomeOn ? "Stop metronome" : "Start metronome").accessibilityIdentifier("toggleMetronomeHUD")
            Button(action: onStop) { Image(systemName: "stop.fill") }
                .buttonStyle(.praeludeEdgeControl).accessibilityLabel("Stop this set").accessibilityIdentifier("stopSet")
            if offersBreakPoint {
                Menu {
                    Button("Mark where it broke", action: onMarkBreakPoint).accessibilityIdentifier("markBreakPoint")
                    Button("Draw a new spot", action: onQuickSubPassage)
                    Button("Skip", action: onSkipBreakPoint).accessibilityIdentifier("skipBreakPointTap")
                } label: { PraeludeIcon(glyph: .passageBox, size: 20) }
                .buttonStyle(.praeludeEdgeControl)
                .overlay { Circle().stroke(PraeludeColor.live, lineWidth: 2).allowsHitTesting(false) }
                .accessibilityLabel("Mark where it broke or draw a new spot").accessibilityIdentifier("quickSubPassage")
                .disabled(active.status != .running || quickSubPassageArmed)
            } else {
                Button(action: onQuickSubPassage) { PraeludeIcon(glyph: .passageBox, size: 20) }
                    .buttonStyle(.praeludeEdgeControl)
                    .accessibilityLabel("Mark a spot without stopping").accessibilityIdentifier("quickSubPassage")
                    .disabled(active.status != .running || quickSubPassageArmed)
            }
        }
    }

    private var verdictControls: some View {
        let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            verdictButton(.again, title: "Again", glyph: .verdictAgain, key: "3", primary: false)
            verdictButton(.sloppy, title: "Sloppy", glyph: .verdictSloppy, key: "2", primary: false)
            verdictButton(.clean, title: "Clean", glyph: .verdictClean, key: "1", primary: true)
        }.disabled(active.status != .running).opacity(active.status == .running ? 1 : 0.45)
    }

    private func pulseCheckBanner(_ decision: Decision) -> some View {
        HStack(spacing: 8) {
            Circle().fill(PraeludeColor.live).frame(width: 6, height: 6)
            Text(decision.reason).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            // §11: every rule's one-tap override, logged — this one previously had no way to end
            // early besides waiting out its own timer. See "(C) Audit.md".
            Button("Resume click", action: onDismissPulseCheck)
                .font(.caption.weight(.semibold)).frame(minHeight: 32).accessibilityIdentifier("dismissPulseCheck")
        }
        .accessibilityElement(children: .combine).accessibilityIdentifier("pulseCheckBanner")
    }

    /// A rule's already-decided one-line reason, purely informational (nothing left to accept or
    /// decline — see `PracticeArmController.lastColdGradeDecision`'s own doc comment).
    private func reasonBanner(_ decision: Decision, identifier: String) -> some View {
        HStack(spacing: 8) {
            Circle().fill(PraeludeColor.inkTertiary).frame(width: 6, height: 6)
            Text(decision.reason).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine).accessibilityIdentifier(identifier)
    }

    private func verdictButton(_ verdict: Verdict, title: String, glyph: PraeludeGlyph, key: KeyEquivalent, primary: Bool) -> some View {
        Button { onVerdict(verdict) } label: {
            VStack(spacing: 5) {
                if !dynamicTypeSize.isAccessibilitySize { PraeludeIcon(glyph: glyph, size: 18) }
                Text(title).font(.subheadline.weight(.semibold))
            }.frame(minWidth: 64)
        }
        .buttonStyle(.praeludeVerdict(emphasis: primary))
        .keyboardShortcut(key, modifiers: [])
        .accessibilityIdentifier("verdict_\(verdict.rawValue)")
    }

    // MARK: - Completed

    private var completedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                PraeludeIcon(glyph: .verdictClean, size: 24).foregroundStyle(PraeludeColor.ink)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Set complete").font(.headline)
                    Text("\(active.totalPlays) repetitions saved").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                }
                Spacer()
                Button(action: onUndo) { Image(systemName: "arrow.uturn.backward") }
                    .buttonStyle(.praeludeEdgeControl).accessibilityLabel("Undo last repetition").keyboardShortcut("z", modifiers: .command)
            }
            NextStepAndSuggestionsView(arm: arm, onApply: onApplySuggestion, onDismiss: onDismissSuggestion)
            HStack(spacing: 12) {
                Button("Finish", action: onFinishSession).buttonStyle(.praeludeQuiet)
                Button("Another set", action: onAnotherSet).buttonStyle(.praeludePrimary)
            }
        }
    }

    // MARK: - Mic

    @ViewBuilder private var micRow: some View {
        if speech.isListening && speech.ownerID == voiceOwnerID {
            HStack(spacing: 8) {
                Circle().fill(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live).frame(width: 6, height: 6)
                PraeludeIcon(glyph: .mic, size: 14).foregroundStyle(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live)
                Text(speech.status).font(.subheadline)
                Spacer()
                Button(speech.isMuted ? "Unmute" : "Mute", action: onMuteVoice).font(.caption.weight(.semibold))
                    .frame(minHeight: 44).contentShape(Rectangle()).accessibilityIdentifier("muteVoice")
                Button("Off", action: onVoiceOff).font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityElement(children: .combine)
        }
    }
}
