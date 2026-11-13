import SwiftUI

/// §13 tuner: on-device pitch detection for non-fixed-pitch instruments. Reads a pitch back to the
/// player; it never grades or stores anything played.
struct TunerView: View {
    @Environment(TunerService.self) private var tuner
    @Environment(PracticeStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedInstrumentID: UUID?

    private var instruments: [Instrument] { store.state.instruments.filter { $0.deletedAt == nil } }
    private var selectedInstrument: Instrument? { instruments.first { $0.id == selectedInstrumentID } }
    /// The reading to display: written pitch for a transposing instrument, concert pitch otherwise.
    private var displayedPitch: Tuning.NamedPitch? {
        guard let concert = tuner.concertReading else { return nil }
        guard let transposition = selectedInstrument?.transposition else { return concert }
        return Tuning.writtenPitch(fromConcert: concert, transposition: transposition)
    }

    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 2) {
                Text(displayedPitch?.label ?? "—")
                    .praeludeNumeral(76, weight: .bold)
                    .foregroundStyle(PraeludeColor.ink)
                    .contentTransition(.numericText())
                    .accessibilityLabel(displayedPitch.map { "\($0.label), \(centsLabel($0.cents))" } ?? "No pitch detected")
                Text(tuner.isListening ? (tuner.frequencyHz.map { String(format: "%.1f Hz", $0) } ?? "Listening…") : "Not listening")
                    .font(.caption.weight(.medium)).tracking(1.2).foregroundStyle(PraeludeColor.inkSecondary)
            }
            centsGauge
                .frame(height: 28)
            if !instruments.isEmpty {
                Picker("Display as", selection: $selectedInstrumentID) {
                    Text("Concert pitch").tag(UUID?.none)
                    ForEach(instruments) { instrument in Text(instrument.name).tag(Optional(instrument.id)) }
                }
                .pickerStyle(.segmented)
            }
            Button {
                tuner.toggle()
            } label: {
                HStack(spacing: 8) {
                    Circle().fill(tuner.isListening ? PraeludeColor.live : PraeludeColor.paper)
                        .frame(width: 8, height: 8)
                        .overlay(Circle().stroke(PraeludeColor.ink.opacity(tuner.isListening ? 0 : 0.3), lineWidth: 1))
                    Text(tuner.isListening ? "Stop listening" : "Start listening")
                }
                .frame(maxWidth: .infinity, minHeight: 28)
            }.buttonStyle(.praeludePrimary).accessibilityIdentifier("toggleTuner")
            if let error = tuner.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            } else {
                Text("Never grades your playing — it only reads back the pitch it hears.")
                    .font(.footnote).foregroundStyle(PraeludeColor.inkSecondary).multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 8)
        .onDisappear { tuner.stop() }
    }

    private func centsLabel(_ cents: Double) -> String {
        if abs(cents) < 3 { return "in tune" }
        return cents > 0 ? "\(Int(cents.rounded())) cents sharp" : "\(Int((-cents).rounded())) cents flat"
    }

    private var centsGauge: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let cents = displayedPitch?.cents ?? 0
            let fraction = max(-1, min(1, cents / 50))
            let inTune = abs(cents) < 3 && displayedPitch != nil
            ZStack(alignment: .leading) {
                Capsule().fill(PraeludeColor.inkFillQuiet)
                Rectangle().fill(PraeludeColor.ink.opacity(0.5)).frame(width: 1.5).offset(x: width / 2 - 0.75)
                if displayedPitch != nil {
                    Circle()
                        .fill(inTune ? PraeludeColor.live : PraeludeColor.ink)
                        .frame(width: 14, height: 14)
                        .offset(x: width / 2 + CGFloat(fraction) * (width / 2 - 8) - 7)
                        .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.7), value: fraction)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
