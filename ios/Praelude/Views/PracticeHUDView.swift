import SwiftUI

/// §10c: "HUD: streak/goal huge, tempo, ladder rung, variant, passage name, mic indicator; at
/// screen edge never over passage; collapsible to a thin strip." Lives in `ScoreWorkspace`'s bottom
/// `safeAreaInset`, the same structural placement the practice dock already used — a `safeAreaInset`
/// reserves its own screen region rather than floating over content, which is what already keeps
/// nothing covering the score; collapsing only shrinks the big readout, never the controls
/// (§3d: "start/stop, metronome toggle, tempo, verdict fallback, undo always one tap" — collapsing
/// the HUD must never take any of those below one tap away).
struct PracticeHUDView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("ios.hudCollapsed") private var collapsed = false
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
    var onMuteVoice: () -> Void
    var onVoiceOff: () -> Void
    var onApplySuggestion: (Decision) -> Void
    var onDismissSuggestion: (Decision) -> Void
    /// §8: draw one box without stopping the set — a new sub-passage, not a mode change, so the
    /// dock/HUD/music never move. `quickSubPassageArmed` mirrors `ScoreMarkupState.quickBoxArmed`
    /// so the button can show/disable itself without the HUD needing that type.
    var quickSubPassageArmed = false
    var onQuickSubPassage: () -> Void = {}

    private var ladderRung: (rung: Int, total: Int)? {
        PracticeUXHelpers.ladderRung(startBPM: active.configuration.startBPM, targetBPM: active.configuration.targetBPM,
                                      currentBPM: active.currentBPM, step: active.configuration.tempoStep)
    }

    var body: some View {
        VStack(spacing: 10) {
            if active.isComplete {
                completedSection
            } else {
                if collapsed { collapsedStrip } else { expandedReadout }
                controlsRow
            }
            micRow
            if let failure = flashLabel {
                Text(failure).font(.caption.weight(.semibold)).foregroundStyle(PraeludeColor.live)
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
                    Text(passageTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                    HStack(spacing: 6) {
                        if let stageName = active.currentStage?.name {
                            Text(stageName).font(.caption).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
                        }
                        if let ladderRung { Text("Rung \(ladderRung.rung) of \(ladderRung.total)").font(.caption).foregroundStyle(PraeludeColor.inkTertiary) }
                    }
                }
                Spacer(minLength: 8)
                Button { collapsed = true } label: { Image(systemName: "chevron.down").frame(width: 32, height: 32) }
                    .accessibilityLabel("Collapse HUD").accessibilityIdentifier("hudCollapse")
            }
            HStack(alignment: .center, spacing: 20) {
                (Text("\(active.progressCount)").font(PraeludeFont.numeral(48)).fontWeight(.bold)
                 + Text(" / \(active.requiredCount)").font(PraeludeFont.numeral(24)).fontWeight(.medium))
                    .foregroundStyle(PraeludeColor.ink).monospacedDigit()
                    .contentTransition(.numericText())
                    .accessibilityIdentifier("repProgress")
                    .accessibilityLabel("\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean" : "plays")")
                Spacer(minLength: 0)
                TempoDial(bpm: .constant(active.currentBPM), locked: true, numeralSize: 34)
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
            }.frame(minHeight: 36).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("Expand HUD").accessibilityIdentifier("hudExpand")
    }

    private var controlsRow: some View {
        HStack(spacing: 10) {
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
            Button(action: onQuickSubPassage) { PraeludeIcon(glyph: .passageBox, size: 20) }
                .buttonStyle(.praeludeEdgeControl)
                .accessibilityLabel("Mark a spot without stopping").accessibilityIdentifier("quickSubPassage")
                .disabled(active.status != .running || quickSubPassageArmed)
            Spacer(minLength: 4)
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 8))
            layout {
                verdictButton(.again, title: "Again", glyph: .verdictAgain, key: "3", primary: false)
                verdictButton(.sloppy, title: "Sloppy", glyph: .verdictSloppy, key: "2", primary: false)
                verdictButton(.clean, title: "Clean", glyph: .verdictClean, key: "1", primary: true)
            }.disabled(active.status != .running).opacity(active.status == .running ? 1 : 0.45)
        }
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
                Text(speech.status).font(.caption)
                Spacer()
                Button(speech.isMuted ? "Unmute" : "Mute", action: onMuteVoice).font(.caption.weight(.semibold))
                    .frame(minHeight: 44).contentShape(Rectangle()).accessibilityIdentifier("muteVoice")
                Button("Off", action: onVoiceOff).font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityElement(children: .combine)
        }
    }
}
