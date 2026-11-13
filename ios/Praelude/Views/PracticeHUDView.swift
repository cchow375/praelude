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
    @Binding var selectedHands: String
    var onRenamePassage: () -> Void = {}
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
        VStack(spacing: 6) {
            if active.isComplete {
                completedSection
            } else {
                if collapsed {
                    if dynamicTypeSize.isAccessibilitySize {
                        VStack(spacing: 6) { collapsedStrip; controlsRow }
                    } else {
                        PracticeHUDRunningLayout {
                            collapsedStrip
                            transportControls
                            verdictControls
                        }
                    }
                } else {
                    expandedReadout
                    controlsRow
                }
                if let activePulseCheck { pulseCheckBanner(activePulseCheck) }
                if let coldGradeDecision = arm.lastColdGradeDecision { reasonBanner(coldGradeDecision, identifier: "coldGradeReason") }
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
                    .allowsHitTesting(false)
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
                    Text(passageTitle).onTapGesture(count: 2, perform: onRenamePassage).accessibilityAction(named: "Rename passage", onRenamePassage).font(.title3.weight(.semibold)).lineLimit(1)
                    HStack(spacing: 8) {
                        if let stageName = active.currentStage?.name {
                            Text(stageName).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
                        }
                        if let ladderRung { Text("Rung \(ladderRung.rung) of \(ladderRung.total)").font(.subheadline).foregroundStyle(PraeludeColor.inkTertiary) }
                    }
                    Text(practiceContext).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("expandedPracticeContext")
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
                    TempoDial(bpm: Binding(get: { active.currentBPM }, set: { onAdjustTempo($0) }), numeralSize: 44)
                    if metronome.groupedCompoundPulse { Text("Dotted-quarter pulse").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private var collapsedStrip: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 6))
        return layout {
            VStack(alignment: .leading, spacing: 2) {
                Text(passageTitle).onTapGesture(count: 2, perform: onRenamePassage).accessibilityAction(named: "Rename passage", onRenamePassage).font(.subheadline.weight(.medium))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                Text(dynamicTypeSize.isAccessibilitySize ? practiceContext : compactPracticeContext)
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(practiceContext)
                    .accessibilityIdentifier("activePracticeContext")
            }.frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 6) {
                Text("\(active.progressCount)/\(active.requiredCount)").praeludeNumeral(20)
                    .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                    .foregroundStyle(PraeludeColor.ink).monospacedDigit()
                    .accessibilityLabel("\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean" : "plays")")
                    .accessibilityIdentifier("repProgress")
                TempoDial(bpm: Binding(get: { active.currentBPM }, set: { onAdjustTempo($0) }), numeralSize: 20, compact: true)
                Button { collapsed = false } label: {
                    Image(systemName: "chevron.up").font(.caption)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(PraeludeColor.inkTertiary)
                .accessibilityLabel("Expand HUD").accessibilityIdentifier("hudExpand")
            }.fixedSize(horizontal: true, vertical: false).layoutPriority(1)
        }.frame(minHeight: 44)
    }

    private var practiceContext: String {
        var parts = [selectedHands]
        if let stage = active.currentStage {
            parts.append("\(active.stageIndex + 1)/\(active.configuration.stages.count) · \(stage.name)")
        }
        if active.effectiveTargetBPM > active.currentBPM { parts.append("Goal \(Int(active.effectiveTargetBPM)) BPM") }
        return parts.joined(separator: " · ")
    }

    private var compactPracticeContext: String {
        let hands: String
        switch selectedHands {
        case "Left hand": hands = "L"
        case "Right hand": hands = "R"
        case "Both hands": hands = "Both"
        case "Hands separately": hands = "L/R"
        default: hands = selectedHands
        }
        var parts = [hands]
        if active.effectiveTargetBPM > active.currentBPM { parts.append("Goal \(Int(active.effectiveTargetBPM))") }
        if active.currentStage != nil { parts.append("Step \(active.stageIndex + 1)/\(active.configuration.stages.count)") }
        return parts.joined(separator: " · ")
    }

    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                transportControls
                verdictControls
            }.fixedSize(horizontal: true, vertical: false)
            VStack(spacing: 6) {
                transportControls
                verdictControls
            }
        }
    }

    private var transportControls: some View {
        HStack(spacing: 4) {
            Button(action: onUndo) { Image(systemName: "arrow.uturn.backward") }
                .buttonStyle(PracticeHUDEdgeStyle()).accessibilityLabel("Undo last repetition").accessibilityIdentifier("undoRep")
                .keyboardShortcut("z", modifiers: .command)
                .disabled(!active.attempts.contains { $0.undoneAt == nil })
            Button(action: onTogglePause) { Image(systemName: active.status == .paused ? "play.fill" : "pause.fill") }
                .buttonStyle(PracticeHUDEdgeStyle()).accessibilityLabel(active.status == .paused ? "Resume practice" : "Pause practice")
                .accessibilityIdentifier("pausePractice")
            Button(action: onToggleMetronome) { PraeludeIcon(glyph: .metronome, size: 20) }
                .buttonStyle(PracticeHUDEdgeStyle())
                .accessibilityLabel(metronomeOn ? "Stop metronome" : "Start metronome").accessibilityIdentifier("toggleMetronomeHUD")
            Button(action: onStop) { Image(systemName: "stop.fill") }
                .buttonStyle(PracticeHUDEdgeStyle()).accessibilityLabel("Stop this set").accessibilityIdentifier("stopSet")
            if offersBreakPoint {
                Menu {
                    Button("Mark where it broke", action: onMarkBreakPoint).accessibilityIdentifier("markBreakPoint")
                    Button("Draw a new spot", action: onQuickSubPassage)
                    Button("Skip", action: onSkipBreakPoint).accessibilityIdentifier("skipBreakPointTap")
                } label: { PraeludeIcon(glyph: .passageBox, size: 20) }
                .buttonStyle(PracticeHUDEdgeStyle())
                .overlay { Circle().stroke(PraeludeColor.live, lineWidth: 2).allowsHitTesting(false) }
                .accessibilityLabel("Mark where it broke or draw a new spot").accessibilityIdentifier("quickSubPassage")
                .disabled(active.status != .running || quickSubPassageArmed)
            } else {
                Button(action: onQuickSubPassage) { PraeludeIcon(glyph: .passageBox, size: 20) }
                    .buttonStyle(PracticeHUDEdgeStyle())
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
            VStack(spacing: 0) {
                // The chosen hand is captured on the next verdict; old attempts keep their hands.
                PracticeHandsControl(hands: $selectedHands)
                    .accessibilityIdentifier("cleanHands")
                verdictButton(.clean, title: "Clean", glyph: .verdictClean, key: "1", primary: true)
            }
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
                .font(.caption.weight(.semibold)).frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("dismissPulseCheck")
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
            HStack(spacing: 6) {
                if !dynamicTypeSize.isAccessibilitySize { PraeludeIcon(glyph: glyph, size: 18) }
                Text(title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: true, vertical: false)
            }
        }
        .buttonStyle(PracticeHUDActionStyle(emphasis: primary, minimumHeight: 52))
        .keyboardShortcut(key, modifiers: [])
        .accessibilityIdentifier("verdict_\(verdict.rawValue)")
    }

    // MARK: - Completed

    private var completedSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) { completionReadout; completionActions }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { completionReadout; completionActions }
                        .fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: .leading, spacing: 6) { completionReadout; completionActions }
                }
            }
            NextStepAndSuggestionsView(arm: arm, onApply: onApplySuggestion, onDismiss: onDismissSuggestion)
        }
    }

    private var completionReadout: some View {
        HStack(spacing: 8) {
            PraeludeIcon(glyph: .verdictClean, size: 20).foregroundStyle(PraeludeColor.ink)
            VStack(alignment: .leading, spacing: 2) {
                Text("Set complete").font(.headline)
                Text("\(active.totalPlays) repetitions saved").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
            }.fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button(action: onUndo) { Image(systemName: "arrow.uturn.backward") }
                .buttonStyle(PracticeHUDEdgeStyle()).accessibilityLabel("Undo last repetition").keyboardShortcut("z", modifiers: .command)
        }
    }

    private var completionActions: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            Button("Finish", action: onFinishSession).buttonStyle(PracticeHUDActionStyle(emphasis: false, minimumHeight: 44))
            Button("Another set", action: onAnotherSet).buttonStyle(PracticeHUDActionStyle(emphasis: true, minimumHeight: 44))
        }.fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: false)
    }

    // MARK: - Mic

    @ViewBuilder private var micRow: some View {
        if speech.isListening && speech.ownerID == voiceOwnerID {
            HStack(spacing: 8) {
                Circle().fill(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live).frame(width: 6, height: 6)
                PraeludeIcon(glyph: .mic, size: 14).foregroundStyle(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live)
                Text(speech.status).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button(speech.isMuted ? "Unmute" : "Mute", action: onMuteVoice).font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()).accessibilityIdentifier("muteVoice")
                Button("Off", action: onVoiceOff).font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityElement(children: .combine)
        }
    }
}

// These dimensions belong to the score HUD. Other screens retain their generous primary styles.
private struct PracticeHUDEdgeStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 44, height: 44)
            .foregroundStyle(PraeludeColor.ink.opacity(isEnabled ? 1 : 0.35))
            .background(configuration.isPressed ? PraeludeColor.inkFillPressed : PraeludeColor.inkFillQuiet, in: Circle())
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

private struct PracticeHUDActionStyle: ButtonStyle {
    var emphasis: Bool
    var minimumHeight: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 10)
            .frame(minWidth: 72, maxWidth: .infinity, minHeight: minimumHeight)
            .foregroundStyle(emphasis ? PraeludeColor.paper : PraeludeColor.ink)
            .background(
                emphasis ? PraeludeColor.ink : (configuration.isPressed ? PraeludeColor.inkFillPressed : PraeludeColor.inkFillQuiet),
                in: RoundedRectangle(cornerRadius: PraeludeRadius.control, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// Measure the actual controls before choosing one, two or three rows. Once one row fits,
/// extra width goes to passage identity and the verdicts rather than leaving a narrow dock.
private struct PracticeHUDRunningLayout: Layout {
    private let spacing: CGFloat = 8
    private let minimumStatusWidth: CGFloat = 220

    private func frames(width: CGFloat, subviews: Subviews) -> [CGRect] {
        let transport = subviews[1].sizeThatFits(.unspecified)
        let verdict = subviews[2].sizeThatFits(.unspecified)
        if width >= minimumStatusWidth + transport.width + verdict.width + spacing * 2 {
            let statusWidth = min(max(minimumStatusWidth, width * 0.3), width - transport.width - verdict.width - spacing * 2)
            let verdictWidth = width - statusWidth - transport.width - spacing * 2
            let status = subviews[0].sizeThatFits(ProposedViewSize(width: statusWidth, height: nil))
            let sizedVerdict = subviews[2].sizeThatFits(ProposedViewSize(width: verdictWidth, height: nil))
            let height = max(status.height, max(transport.height, sizedVerdict.height))
            return [
                CGRect(x: 0, y: (height - status.height) / 2, width: statusWidth, height: status.height),
                CGRect(x: statusWidth + spacing, y: (height - transport.height) / 2, width: transport.width, height: transport.height),
                CGRect(x: statusWidth + transport.width + spacing * 2, y: (height - sizedVerdict.height) / 2, width: verdictWidth, height: sizedVerdict.height)
            ]
        }
        let status = subviews[0].sizeThatFits(ProposedViewSize(width: width, height: nil))
        if width >= transport.width + verdict.width + spacing {
            let verdictWidth = width - transport.width - spacing
            let sizedVerdict = subviews[2].sizeThatFits(ProposedViewSize(width: verdictWidth, height: nil))
            let height = max(transport.height, sizedVerdict.height)
            return [
                CGRect(x: 0, y: 0, width: width, height: status.height),
                CGRect(x: 0, y: status.height + spacing + (height - transport.height) / 2, width: transport.width, height: transport.height),
                CGRect(x: transport.width + spacing, y: status.height + spacing + (height - sizedVerdict.height) / 2, width: verdictWidth, height: sizedVerdict.height)
            ]
        }
        let sizedVerdict = subviews[2].sizeThatFits(ProposedViewSize(width: width, height: nil))
        return [
            CGRect(x: 0, y: 0, width: width, height: status.height),
            CGRect(x: (width - transport.width) / 2, y: status.height + spacing, width: transport.width, height: transport.height),
            CGRect(x: 0, y: status.height + transport.height + spacing * 2, width: width, height: sizedVerdict.height)
        ]
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let idealWidth = minimumStatusWidth + subviews[1].sizeThatFits(.unspecified).width + subviews[2].sizeThatFits(.unspecified).width + spacing * 2
        let width = proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil } ?? idealWidth
        let measuredFrames = frames(width: width, subviews: subviews)
        return CGSize(width: width, height: measuredFrames.map(\.maxY).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, frames(width: bounds.width, subviews: subviews)) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(width: frame.width, height: frame.height))
        }
    }
}
