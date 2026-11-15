import SwiftUI

/// Paper-score practice shares the exact same durable set and verdict pipeline as the PDF HUD.
/// Only the presentation and temporary rest countdown belong to this view.
struct CounterPracticeView: View {
    let active: ActiveSet
    @Binding var selectedHands: String
    @Binding var keepAwake: Bool
    let isSaving: Bool
    let onVerdict: (Verdict) -> Void
    let onUndo: () -> Void
    let onTogglePause: () -> Void
    let onStop: () -> Void
    let onFinishSession: () -> Void
    let onAnotherSet: () -> Void
    let onAdjustTempo: (Double) -> Void
    let onToggleMetronome: () -> Void
    let onOpenMetronome: () -> Void
    let onBeginRest: () -> Bool
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showTempoEntry = false
    @State private var showTools = false
    @State private var restUntil: Date?

    private var tempoReference: Double {
        active.configuration.passageSnapshot?.performanceTempo
            ?? store.pieces.first { $0.id == active.configuration.pieceID }?.fullTempoBPM
            ?? active.configuration.fullTempoBPM ?? active.effectiveTargetBPM
    }
    private var lastCleanBPM: Double? { active.effectiveAttempts.last(where: { $0.verdict == .clean })?.bpm }

    var body: some View {
        VStack(spacing: 10) {
            progress
            if active.isComplete { completion }
            else {
                verdicts
                metronomeControls
                transport
                if restUntil != nil { restCountdown }
                Button {
                    withAnimation(PraeludeMotion.tap(reduceMotion: reduceMotion)) { showTools.toggle() }
                } label: {
                    HStack {
                        Text("Practice tools")
                        Spacer()
                        Image(systemName: showTools ? "chevron.up" : "chevron.down")
                    }.font(.subheadline.weight(.medium)).frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("counterPracticeTools")
                    .accessibilityValue(showTools ? "Expanded" : "Collapsed")
                if showTools { tools }
            }
        }
        .onChange(of: active.id) { _, _ in restUntil = nil }
        .onChange(of: active.status) { _, value in if value != .paused { restUntil = nil } }
    }

    private var progress: some View {
        VStack(spacing: 5) {
            Text(active.isComplete ? "Set complete" : active.status == .paused ? "Practice paused" : active.configuration.basis == .cleanStreak ? "Clean in a row" : "Repetitions")
                .font(.subheadline.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(active.progressCount)").praeludeNumeral(dynamicTypeSize.isAccessibilitySize ? 56 : 64, weight: .bold)
                Text("/ \(active.requiredCount)").praeludeNumeral(30, weight: .medium).foregroundStyle(PraeludeColor.inkTertiary)
            }
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : PraeludeMotion.tap, value: active.progressCount)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean in a row" : "repetitions")")
            .accessibilityIdentifier("repProgress")
            .accessibilityRepresentation {
                Text("\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean in a row" : "repetitions")")
                    .accessibilityIdentifier("repProgress")
            }
            ProgressView(value: active.progressFraction).tint(PraeludeColor.ink).accessibilityHidden(true)
            if let stage = active.currentStage {
                Text("Stage \(active.stageIndex + 1) of \(active.configuration.stages.count) · \(stage.name)")
                    .font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
            }
            Text(active.configuration.basis == .cleanStreak
                 ? "Again keeps your place. Sloppy resets the clean streak."
                 : "Every verdict adds one play. You decide how it went.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text("\(active.totalPlays) \(active.totalPlays == 1 ? "play" : "plays") saved · \(CounterPracticeTools.duration(CounterPracticeTools.elapsed(active, at: context.date))) active")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    .accessibilityIdentifier("counterElapsedTime")
            }
        }
        .padding(.vertical, 6)
    }

    private var verdicts: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            verdict(.again, title: "Again", icon: "arrow.counterclockwise", emphasis: false)
            verdict(.sloppy, title: "Sloppy", icon: "waveform.path", emphasis: false)
            verdict(.clean, title: "Clean", icon: "checkmark", emphasis: true)
        }
        .disabled(active.status != .running || isSaving)
    }

    private func verdict(_ value: Verdict, title: String, icon: String, emphasis: Bool) -> some View {
        Button { onVerdict(value) } label: {
            Label(title, systemImage: icon).font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(CounterPracticeButtonStyle(emphasis: emphasis))
        .accessibilityIdentifier("verdict_\(value.rawValue)")
        .accessibilityHint(value == .clean ? "Save a clean repetition" : "Save this play and restart a clean streak")
    }

    private var metronomeControls: some View {
        VStack(spacing: 4) {
            PracticeBeatDisplay()
            if let override = active.configuration.passageSnapshot?.performanceTempo,
               override != store.pieces.first(where: { $0.id == active.configuration.pieceID })?.fullTempoBPM {
                Text("Passage target \(PracticeReferenceFormatting.bpm(override)) BPM")
                    .font(.caption.weight(.medium)).frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 8) {
                Button(action: onToggleMetronome) {
                    Label(metronome.isPlaying ? "Click on" : "Click off", systemImage: "metronome")
                        .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(CounterPracticeButtonStyle(emphasis: metronome.isPlaying))
                    .accessibilityLabel(metronome.isPlaying ? "Stop metronome" : "Start metronome")
                    .accessibilityIdentifier("toggleMetronomeHUD")
                Button { showTempoEntry = true } label: {
                    VStack(spacing: 0) {
                        Text(PracticeReferenceFormatting.bpm(active.currentBPM)).praeludeNumeral(30, weight: .semibold)
                        Text(metronome.groupedCompoundPulse ? "BPM · dotted quarter" : "BPM").font(.caption2)
                    }.frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(CounterPracticeButtonStyle())
                    .accessibilityLabel("Tempo").accessibilityValue("\(PracticeReferenceFormatting.bpm(active.currentBPM)) beats per minute")
                    .accessibilityIdentifier("tempoDialValue")
                    .popover(isPresented: $showTempoEntry) {
                        TempoEntryView(bpm: Binding(get: { active.currentBPM }, set: onAdjustTempo))
                            .presentationCompactAdaptation(.popover)
                    }
            }
            targetControls
            HStack(spacing: 8) {
                tempoNudge(-5); tempoNudge(-1); tempoNudge(1); tempoNudge(5)
            }
        }.disabled(isSaving)
    }

    private var targetControls: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
                PieceTargetTempoControl(pieceID: active.configuration.pieceID)
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                Button { onAdjustTempo(CounterPracticeTools.percentageTempo(75, reference: tempoReference)) } label: {
                    Text("75%").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("counterQuick75Percent")
                Button { onAdjustTempo(tempoReference) } label: {
                    Text("Play at target").font(.caption.weight(.medium)).frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("counterPlayAtTarget")
                Menu {
                    ForEach(MetronomeVisualStyle.allCases, id: \.self) { style in
                        Button {
                            metronome.visualStyle = style
                        } label: {
                            Label(style.title, systemImage: metronome.visualStyle == style ? "checkmark" : "circle")
                        }.accessibilityIdentifier("counterVisualStyle_\(style.rawValue)")
                    }
                } label: {
                    Image(systemName: "eye").frame(width: 44, height: 44).contentShape(Rectangle())
                }.accessibilityLabel("Visual metronome style").accessibilityIdentifier("counterVisualStyle")
            }
    }

    private func tempoNudge(_ delta: Double) -> some View {
        Button {
            onAdjustTempo(CounterPracticeTools.boundedTempo(active.currentBPM + delta))
        } label: {
            Text(delta > 0 ? "+\(Int(delta))" : "−\(Int(-delta))")
                .font(.body.monospacedDigit().weight(.medium))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
            .buttonStyle(CounterPracticeButtonStyle())
            .accessibilityLabel(delta > 0 ? "Increase tempo by \(Int(delta))" : "Decrease tempo by \(Int(-delta))")
            .accessibilityIdentifier("counterTempoNudge_\(Int(delta))")
    }

    private var transport: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            Button(action: onUndo) { Label("Undo", systemImage: "arrow.uturn.backward").frame(maxWidth: .infinity, minHeight: 44) }
                .buttonStyle(CounterPracticeButtonStyle()).disabled(active.effectiveAttempts.isEmpty || isSaving)
                .accessibilityLabel("Undo last repetition").accessibilityIdentifier("undoRep")
            Button {
                restUntil = nil
                onTogglePause()
            } label: {
                Label(active.status == .paused ? "Resume" : "Pause", systemImage: active.status == .paused ? "play.fill" : "pause.fill")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }.buttonStyle(CounterPracticeButtonStyle()).disabled(isSaving)
                .accessibilityLabel(active.status == .paused ? "Resume practice" : "Pause practice")
                .accessibilityIdentifier("pausePractice")
            Button(action: onStop) { Label("Stop set", systemImage: "stop.fill").frame(maxWidth: .infinity, minHeight: 44) }
                .buttonStyle(CounterPracticeButtonStyle()).disabled(isSaving).accessibilityIdentifier("stopSet")
        }.font(.subheadline.weight(.medium))
    }

    private var completion: some View {
        VStack(spacing: 10) {
            Button(action: onAnotherSet) { Text("Another set").frame(maxWidth: .infinity, minHeight: 54) }
                .buttonStyle(CounterPracticeButtonStyle(emphasis: true)).accessibilityIdentifier("counterAnotherSet")
            Button(action: onFinishSession) { Text("Finish practice").frame(maxWidth: .infinity, minHeight: 44) }
                .buttonStyle(CounterPracticeButtonStyle()).accessibilityIdentifier("counterFinishPractice")
            Button(action: onUndo) { Text("Undo last repetition").frame(maxWidth: .infinity, minHeight: 44) }
                .disabled(active.effectiveAttempts.isEmpty || isSaving)
                .accessibilityIdentifier("undoRep")
        }
    }

    private var tools: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Hands for the next repetition").font(.caption).foregroundStyle(.secondary)
                handsControl
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("\(PracticeReferenceFormatting.bpm(tempoReference)) BPM reference").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    ForEach([50, 75, 100], id: \.self) { percentage in
                        Button { onAdjustTempo(CounterPracticeTools.percentageTempo(percentage, reference: tempoReference)) } label: {
                            Text("\(percentage)%").frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(CounterPracticeButtonStyle())
                            .accessibilityLabel("\(percentage) percent of \(PracticeReferenceFormatting.bpm(tempoReference)) BPM")
                            .accessibilityIdentifier("counterTempoPercent_\(percentage)")
                    }
                }
                Text("Changes this set's tempo; earlier repetitions keep their recorded tempo.")
                    .font(.caption).foregroundStyle(.secondary)
                if let lastCleanBPM, abs(lastCleanBPM - active.currentBPM) > 0.01 {
                    Button { onAdjustTempo(lastCleanBPM) } label: {
                        Text("Return to last clean · \(PracticeReferenceFormatting.bpm(lastCleanBPM)) BPM")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }.accessibilityIdentifier("counterLastCleanTempo")
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Rest your hands").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    ForEach([30, 60, 120], id: \.self) { seconds in
                        Button {
                            if onBeginRest() { restUntil = Date().addingTimeInterval(Double(seconds)) }
                        } label: {
                            Text(seconds < 60 ? "30 sec" : "\(seconds / 60) min")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(CounterPracticeButtonStyle())
                            .accessibilityIdentifier("counterRest_\(seconds)")
                    }
                }
                Text("Pauses practice and the click. Resume when you're ready.").font(.caption).foregroundStyle(.secondary)
            }
            Toggle("Keep counter awake while practicing", isOn: $keepAwake)
                .accessibilityIdentifier("counterKeepAwake")
            Button(action: onOpenMetronome) {
                Text("Meter, count-in & sound").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }.accessibilityIdentifier("counterMetronomeOptions")
        }.disabled(isSaving)
    }

    private var handsControl: some View {
        HStack(spacing: 6) {
            ForEach(["Left hand", "Both hands", "Right hand"], id: \.self) { hand in
                Button {
                    selectedHands = hand
                    if FeedbackService.shared.isEnabled && FeedbackService.shared.hapticsEnabled { PraeludeHaptic.toggle() }
                } label: {
                    Text(hand == "Both hands" ? "Both" : hand == "Left hand" ? "Left" : "Right")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(CounterPracticeButtonStyle(emphasis: selectedHands == hand))
                    .accessibilityLabel(hand).accessibilityAddTraits(selectedHands == hand ? .isSelected : [])
                    .accessibilityIdentifier("counterHands_\(hand)")
            }
        }
    }

    private var restCountdown: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = CounterPracticeTools.remainingRest(until: restUntil, at: context.date)
            HStack(spacing: 12) {
                Image(systemName: "hand.raised").font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(remaining > 0 ? "Rest · \(CounterPracticeTools.duration(Double(remaining)))" : "Ready when you are")
                        .font(.headline.monospacedDigit())
                    Text("Practice stays paused until you tap Resume.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button { restUntil = nil } label: { Text("Dismiss").frame(minWidth: 44, minHeight: 44) }
            }.padding(12).background(PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

/// Pure display calculations are shared by the native tests; no timer writes to the practice log.
enum CounterPracticeTools {
    static func boundedTempo(_ bpm: Double) -> Double { bpm.isFinite ? min(300, max(20, bpm)) : 60 }
    static func percentageTempo(_ percentage: Int, reference: Double) -> Double {
        boundedTempo((reference * Double(percentage) / 100).rounded())
    }
    static func elapsed(_ set: ActiveSet, at now: Date) -> TimeInterval {
        let pending = set.status == .running ? max(0, now.timeIntervalSince(set.lastCheckpoint ?? now)) : 0
        return max(0, set.activeSeconds + pending)
    }
    static func remainingRest(until deadline: Date?, at now: Date) -> Int {
        guard let deadline else { return 0 }
        let seconds = deadline.timeIntervalSince(now)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return Int(ceil(min(seconds, Double(Int.max / 2))))
    }
    static func duration(_ seconds: TimeInterval) -> String {
        let value = seconds.isFinite ? Int(min(Double(Int.max / 2), max(0, seconds))) : 0
        let remainder = value % 60
        return "\(value / 60):\(remainder < 10 ? "0" : "")\(remainder)"
    }
}

private struct CounterPracticeButtonStyle: ButtonStyle {
    var emphasis = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 9)
            .frame(maxWidth: .infinity)
            .foregroundStyle(emphasis ? PraeludeColor.paper : PraeludeColor.ink)
            .background(emphasis ? PraeludeColor.ink : PraeludeColor.inkFillQuiet,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}
