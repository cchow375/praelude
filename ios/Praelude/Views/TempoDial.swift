import SwiftUI
import UIKit

/// A tap opens exact tempo entry; dragging previews locally and commits once on release.
/// Active bindings can write a complete practice ledger, so finger-move samples must never call
/// them. Cancelled gestures discard the preview, and earlier attempts keep their recorded BPM.
struct TempoDial: View {
    @Binding var bpm: Double
    var locked: Bool = false
    var numeralSize: CGFloat = 60
    var compact = false
    /// The caller decides what "tap tempo" means (`MetronomeService.tap()` when a metronome is in
    /// play, or a purely local interval average before one exists); `nil` hides the control.
    var onTapTempo: (() -> Void)? = nil
    var accessibilityTitle = "Tempo"
    var accessibilityID = "tempoDialValue"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var dragOrigin: Double?
    @GestureState private var dragTranslation: CGFloat? = nil
    @State private var showEditor = false

    private var displayedBPM: Double {
        guard let dragOrigin, let dragTranslation else { return bpm }
        return PracticeUXHelpers.tempo(fromDragTranslation: dragTranslation, startBPM: dragOrigin)
    }

    var body: some View {
        VStack(spacing: 10) {
            Text("\(Int(displayedBPM.rounded()))")
                .praeludeNumeral(numeralSize, weight: .bold)
                .lineLimit(1).minimumScaleFactor(0.45)
                .foregroundStyle(PraeludeColor.ink)
                .contentTransition(.numericText())
                .animation(reduceMotion || dragTranslation != nil ? nil : .easeOut(duration: 0.08), value: bpm)
                .padding(.bottom, compact && !dynamicTypeSize.isAccessibilitySize ? 8 : 0)
                .frame(minWidth: max(44, numeralSize * 1.6), minHeight: 44)
                .overlay(alignment: .bottom) {
                    if compact && !dynamicTypeSize.isAccessibilitySize {
                        Text("BPM").font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
                .allowsHitTesting(!locked)
                .gesture(dragGesture)
                .onTapGesture { if !locked { showEditor = true } }
                .popover(isPresented: $showEditor) {
                    TempoEntryView(bpm: $bpm, title: accessibilityTitle)
                        .presentationCompactAdaptation(.popover)
                }
                .opacity(locked ? 0.55 : 1)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier(accessibilityID)
                .accessibilityLabel(accessibilityTitle)
                .accessibilityHint("Tap to type a tempo, or slide up and down to adjust")
                .accessibilityAction(named: "Enter tempo") { if !locked { showEditor = true } }
                .accessibilityValue("\(Int(bpm.rounded())) beats per minute")
                .accessibilityAdjustableAction { direction in
                    guard !locked else { return }
                    switch direction {
                    case .increment: nudge(1)
                    case .decrement: nudge(-1)
                    default: break
                    }
                }
            if !compact {
                Text(locked ? "TEMPO · FOLLOWS YOUR SET" : "BEATS PER MINUTE")
                    .font(.caption2.weight(.semibold)).tracking(1.1)
                    .foregroundStyle(PraeludeColor.inkTertiary)
            }
            if !locked && !compact {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: 8) {
                        HStack(spacing: 8) { nudges }
                        tapButton
                    }
                } else {
                    HStack(spacing: 8) { nudges; tapButton }
                }
            }
        }
        .onChange(of: dragTranslation) { _, value in if value == nil { dragOrigin = nil } }
    }

    @ViewBuilder private var nudges: some View {
        nudgeButton(-5, label: "−5")
        nudgeButton(-1, label: "−1")
        nudgeButton(1, label: "+1")
        nudgeButton(5, label: "+5")
    }

    @ViewBuilder private var tapButton: some View {
        if let onTapTempo {
            Button(action: onTapTempo) {
                Text("TAP").font(.caption.weight(.semibold)).lineLimit(1)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.praeludeQuiet)
            .accessibilityLabel("Tap tempo")
            .accessibilityHint("Tap repeatedly at the tempo you want")
        }
    }

    private func nudgeButton(_ delta: Double, label: String) -> some View {
        Button { nudge(delta) } label: {
            Text(label).font(.callout.monospacedDigit().weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.praeludeQuiet)
        .accessibilityLabel(delta > 0 ? "Increase tempo by \(Int(delta))" : "Decrease tempo by \(Int(-delta))")
    }

    private func nudge(_ delta: Double) {
        bpm = min(max(bpm + delta, 20), 300)
        PraeludeHaptic.toggle()
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .updating($dragTranslation) { value, state, _ in state = value.translation.height }
            .onChanged { _ in if dragOrigin == nil { dragOrigin = bpm } }
            .onEnded { value in
                let target = PracticeUXHelpers.tempo(fromDragTranslation: value.translation.height, startBPM: dragOrigin ?? bpm)
                dragOrigin = nil
                if target != bpm { bpm = target; PraeludeHaptic.toggle() }
            }
    }
}

/// Local draft: invalid text and dismissing the popover never change the current click or set.
struct TempoEntryView: View {
    @Binding var bpm: Double
    var title = "Tempo"
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var tapEstimator = TapTempoEstimator()
    private var value: Double? {
        guard let value = Double(text), value.isFinite, (20...300).contains(value) else { return nil }
        return value
    }
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Button("Cancel") { dismiss() }.font(.subheadline).frame(minHeight: 44)
            }
            HStack(alignment: .firstTextBaseline) {
                SelectAllNumberField(text: $text, placeholder: "20–300",
                                     accessibilityLabel: "Tempo in beats per minute", accessibilityIdentifier: "tempoExactEntry",
                                     fontSize: 34, textStyle: .largeTitle, onSubmit: { apply() })
                    .frame(minHeight: 44)
                Text("BPM").foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                adjustment(-5); adjustment(-1)
                Button("Tap") {
                    if let estimate = tapEstimator.tap(at: ProcessInfo.processInfo.systemUptime) { text = String(Int(estimate.rounded())) }
                }.frame(minWidth: 48, minHeight: 44).buttonStyle(.bordered)
                    .accessibilityLabel("Tap tempo").accessibilityIdentifier("tempoTapEntry")
                adjustment(1); adjustment(5)
            }
            Text("Tap the beat, type a number, or use − / +.")
                .font(.caption).foregroundStyle(.secondary)
            if !text.isEmpty, value == nil {
                Text("Choose 20–300 BPM.").font(.caption).foregroundStyle(.red)
            }
            Button("Use tempo", action: apply).buttonStyle(.borderedProminent)
                .frame(minHeight: 44).disabled(value == nil).accessibilityIdentifier("tempoApply")
        }.padding(16).frame(idealWidth: 320)
            .onAppear { text = String(Int(bpm.rounded())) }
    }
    private func adjustment(_ amount: Double) -> some View {
        Button(amount > 0 ? "+\(Int(amount))" : "−\(Int(-amount))") {
            text = String(Int(min(300, max(20, (value ?? bpm) + amount)).rounded()))
        }.font(.body.monospacedDigit()).frame(minWidth: 44, minHeight: 44).buttonStyle(.bordered)
    }
    private func apply() {
        guard let value else { return }
        bpm = value
        dismiss()
    }
}

/// Exact numeric editing replaces the old number on first focus, like a calculator. A centered
/// SwiftUI text field otherwise places the caret before the digits when tapped from the left,
/// which makes typing append to the old value. Keep text as a draft so invalid or empty input
/// remains visible; the owning editor controls validation and persistence.
struct SelectAllNumberField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var accessibilityLabel: String
    var accessibilityIdentifier: String
    var fontSize: CGFloat = 17
    var textStyle: UIFont.TextStyle = .body
    var onSubmit: (() -> Void)? = nil

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.keyboardType = .numberPad
        field.returnKeyType = .done
        field.textAlignment = .center
        field.font = UIFontMetrics(forTextStyle: textStyle).scaledFont(for: .monospacedDigitSystemFont(ofSize: fontSize, weight: .semibold))
        field.adjustsFontForContentSizeCategory = true
        field.adjustsFontSizeToFitWidth = true
        field.minimumFontSize = min(20, fontSize)
        field.placeholder = placeholder
        field.accessibilityIdentifier = accessibilityIdentifier
        field.accessibilityLabel = accessibilityLabel
        field.accessibilityHint = "Typing replaces the selected number"
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self
        if field.text != text { field.text = text }
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: SelectAllNumberField
        init(parent: SelectAllNumberField) { self.parent = parent }
        @objc func changed(_ field: UITextField) { parent.text = field.text ?? "" }
        func textFieldDidBeginEditing(_ textField: UITextField) {
            DispatchQueue.main.async { [weak textField] in
                guard let textField, textField.isFirstResponder else { return }
                textField.selectAll(nil)
            }
        }
        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit?()
            return true
        }
    }
}
