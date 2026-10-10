import SwiftUI

// MARK: - Music stamps (§7 annotate track)
//
// Fingerings, dynamics, breath marks, bowings and accidentals render as Bravura/SMuFL glyphs
// (`PraeludeMusicGlyph`, §"Design System" — the same bundled font the app already uses for the
// Settings footer quarter note); circles and "watch this" are drawn shapes, since SMuFL has no
// glyph for either. Every stamp label this app writes is one of the tokens below — the picker in
// `AnnotationToolbar` only ever offers these — so `PraeludeStamp` treats an unrecognized label as
// the kind's first option rather than failing to render (forward-compatible with a label a future
// version might add, and defensive against a label a sync peer wrote that this build predates).

extension StampKind {
    static let fingeringLabels = ["1", "2", "3", "4", "5"]
    static let dynamicLabels = ["pp", "p", "mp", "mf", "f", "ff"]
    static let bowingLabels = ["down", "up"]
    static let accidentalLabels = ["flat", "natural", "sharp"]
    /// Whether this kind needs a specific label chosen (vs. `.breath`/`.circle`/`.watch`, which are
    /// one fixed mark each).
    var labels: [String]? {
        switch self {
        case .fingering: return Self.fingeringLabels
        case .dynamic: return Self.dynamicLabels
        case .bowing: return Self.bowingLabels
        case .accidental: return Self.accidentalLabels
        case .breath, .circle, .watch: return nil
        }
    }
}

/// Renders one music stamp at a given size, in `PraeludeColor.scoreInk` — like every other mark
/// drawn ON the score page (§3a), never a dynamic color that would vanish in dark mode against the
/// pinned paper-white page.
struct PraeludeStamp: View {
    let kind: StampKind
    var label: String?
    var size: CGFloat = 28

    var body: some View {
        content
            .frame(width: size, height: size)
            .environment(\.colorScheme, .light)
            // These are score symbols with an explicit geometric size, not prose. Scaling the
            // font again at accessibility sizes spills glyphs outside their picker hit targets.
            .dynamicTypeSize(.large)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityDescription)
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case .fingering: glyph(fingeringSymbol)
        case .dynamic: dynamicGlyphs
        case .breath: glyph(.breathMarkComma)
        case .bowing: glyph(label == "up" ? .stringsUpBow : .stringsDownBow)
        case .accidental: glyph(accidentalSymbol)
        case .circle: Circle().stroke(PraeludeColor.scoreInk, lineWidth: max(1, size * 0.07)).padding(size * 0.05)
        case .watch:
            WatchMarkShape().stroke(PraeludeColor.scoreInk, style: StrokeStyle(lineWidth: max(1, size * 0.09), lineCap: .round, lineJoin: .round))
        }
    }
    private func glyph(_ symbol: PraeludeMusicGlyph.Symbol) -> some View {
        PraeludeMusicGlyph(symbol: symbol, size: size).foregroundStyle(PraeludeColor.scoreInk)
    }
    private var dynamicGlyphs: some View {
        HStack(spacing: -size * 0.06) {
            ForEach(Array(dynamicSymbols.enumerated()), id: \.offset) { _, symbol in glyph(symbol) }
        }
    }
    private var dynamicSymbols: [PraeludeMusicGlyph.Symbol] {
        switch label {
        case "pp": return [.dynamicPiano, .dynamicPiano]
        case "p": return [.dynamicPiano]
        case "mp": return [.dynamicMezzo, .dynamicPiano]
        case "f": return [.dynamicForte]
        case "ff": return [.dynamicForte, .dynamicForte]
        default: return [.dynamicMezzo, .dynamicForte] // "mf", and the fallback for any other value
        }
    }
    private var fingeringSymbol: PraeludeMusicGlyph.Symbol {
        switch label {
        case "2": return .fingering2
        case "3": return .fingering3
        case "4": return .fingering4
        case "5": return .fingering5
        default: return .fingering1
        }
    }
    private var accidentalSymbol: PraeludeMusicGlyph.Symbol {
        switch label {
        case "flat": return .accidentalFlat
        case "sharp": return .accidentalSharp
        default: return .accidentalNatural
        }
    }
    var accessibilityDescription: String {
        switch kind {
        case .fingering: return "Fingering \(label ?? "1")"
        case .dynamic: return "Dynamic \(label ?? "mf")"
        case .breath: return "Breath mark"
        case .bowing: return label == "up" ? "Up bow" : "Down bow"
        case .accidental: return (label ?? "natural").capitalized
        case .circle: return "Circled"
        case .watch: return "Watch this spot"
        }
    }
}

/// A simple two-lens "glasses" mark for `.watch` — SMuFL has no "pay attention here" glyph, and this
/// is a stamp for the player's own eye, not a notation symbol. Built from circle and line primitives
/// on a shared grid, matching `PraeludeIcon`'s existing consistent-stroke house style (§3a: no emoji).
private struct WatchMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width, h = rect.height
        let lensRadius = w * 0.21
        let left = CGPoint(x: rect.minX + w * 0.29, y: rect.minY + h * 0.52)
        let right = CGPoint(x: rect.minX + w * 0.71, y: rect.minY + h * 0.52)
        path.addEllipse(in: CGRect(x: left.x - lensRadius, y: left.y - lensRadius, width: lensRadius * 2, height: lensRadius * 2))
        path.addEllipse(in: CGRect(x: right.x - lensRadius, y: right.y - lensRadius, width: lensRadius * 2, height: lensRadius * 2))
        path.move(to: CGPoint(x: left.x + lensRadius, y: left.y))
        path.addLine(to: CGPoint(x: right.x - lensRadius, y: right.y))
        path.move(to: CGPoint(x: left.x - lensRadius, y: left.y))
        path.addLine(to: CGPoint(x: rect.minX + w * 0.04, y: rect.minY + h * 0.28))
        path.move(to: CGPoint(x: right.x + lensRadius, y: right.y))
        path.addLine(to: CGPoint(x: rect.maxX - w * 0.04, y: rect.minY + h * 0.28))
        return path
    }
}

/// A sheet for creating/editing one free-text annotation (§7 "text boxes"), matching
/// `PassageEditorView`'s existing sheet-editor pattern rather than an in-place WYSIWYG editor.
struct TextBoxEditorView: View {
    @Environment(SpeechCommandService.self) private var speech
    @State private var ownerID = UUID()
    @State private var dictationPrefix = ""
    @State private var text: String
    @State private var style: TextAnnotationStyle
    @State private var showingFormatting = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss
    let startDictation: Bool
    let onSave: (String, TextAnnotationStyle) throws -> Void
    let onDelete: (() throws -> Void)?

    init(text: String, style: TextAnnotationStyle = .init(), startDictation: Bool = false,
         onSave: @escaping (String, TextAnnotationStyle) throws -> Void, onDelete: (() throws -> Void)? = nil) {
        _text = State(initialValue: text); self.startDictation = startDictation
        _style = State(initialValue: style)
        self.onSave = onSave; self.onDelete = onDelete
    }
    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Note") {
                    TextEditor(text: $text).font(.title3).frame(minHeight: 160).focused($focused)
                        .accessibilityIdentifier("textAnnotationEditor")
                }
                Section {
                    Button(action: toggleDictation) {
                        Label(isCapturing ? "Finish dictating" : "Dictate note", systemImage: isCapturing ? "stop.circle" : "mic")
                            .frame(minHeight: 44)
                    }.accessibilityIdentifier("dictateTextAnnotation")
                    if speech.ownerID == ownerID {
                        Text(speech.lastTranscript.isEmpty ? speech.status : speech.lastTranscript)
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let failure = speech.errorMessage { ErrorMessage(message: failure) }
                } footer: { Text("Speak, review your words, then Save. You can also use the keyboard microphone.") }
                formattingSection
                if let onDelete {
                    Section {
                        Button("Delete note", role: .destructive) {
                            do { try onDelete(); dismiss() }
                            catch { errorMessage = error.localizedDescription }
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .top, spacing: 0) {
                if let errorMessage {
                    ErrorMessage(message: errorMessage)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20).padding(.vertical, 12)
                        .background(.regularMaterial)
                        .accessibilityIdentifier("textAnnotationError")
                }
            }
            .navigationTitle("Note").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do { try onSave(trimmed, style); dismiss() }
                        catch { errorMessage = error.localizedDescription + " Your text and formatting are still here." }
                    }.disabled(trimmed.isEmpty || isCapturing)
                        .accessibilityIdentifier("saveTextAnnotation")
                }
            }
            .task {
                if startDictation { beginDictation() } else { focused = true }
            }
            .onDisappear { speech.stop(ifOwnedBy: ownerID) }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isCapturing)
    }

    private var formattingSection: some View {
        Section {
            Button {
                focused = false
                withAnimation { showingFormatting.toggle() }
            } label: {
                HStack {
                    Label("Text style", systemImage: "textformat")
                    Spacer(minLength: 8)
                    Text("\(Int(style.fontSize)) pt").foregroundStyle(.secondary).monospacedDigit()
                    Image(systemName: showingFormatting ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }.frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("noteFormatting")
            .accessibilityValue(showingFormatting ? "Expanded" : "Collapsed")
            .accessibilityHint("Text size, font, emphasis, color and alignment")

            if showingFormatting {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Text size").font(.subheadline)
                    HStack(spacing: 12) {
                        Button { adjustTextSize(by: -2) } label: {
                            Image(systemName: "minus").frame(width: 44, height: 44)
                        }
                        .buttonStyle(.bordered)
                        .disabled(style.fontSize <= TextAnnotationStyle.fontSizeRange.lowerBound)
                        .accessibilityLabel("Decrease note text size")
                        .accessibilityIdentifier("decreaseNoteTextSize")
                        Text("\(Int(style.fontSize)) pt").monospacedDigit()
                            .frame(maxWidth: .infinity)
                            .accessibilityLabel("Note text size")
                            .accessibilityValue("\(Int(style.fontSize)) points")
                            .accessibilityIdentifier("textNoteFontSize")
                        Button { adjustTextSize(by: 2) } label: {
                            Image(systemName: "plus").frame(width: 44, height: 44)
                        }
                        .buttonStyle(.bordered)
                        .disabled(style.fontSize >= TextAnnotationStyle.fontSizeRange.upperBound)
                        .accessibilityLabel("Increase note text size")
                        .accessibilityIdentifier("increaseNoteTextSize")
                    }
                }

                Picker("Font", selection: $style.fontFamily) {
                    ForEach(TextAnnotationStyle.FontFamily.allCases, id: \.self) { family in
                        Text(family.rawValue.capitalized).tag(family)
                    }
                }
                .pickerStyle(.menu)
                .frame(minHeight: 44)
                .accessibilityIdentifier("textNoteFontFamily")

                HStack(spacing: 12) {
                    emphasisButton("Bold", systemImage: "bold", isOn: style.isBold,
                                   identifier: "textNoteBold") { style.isBold.toggle() }
                    emphasisButton("Italic", systemImage: "italic", isOn: style.isItalic,
                                   identifier: "textNoteItalic") { style.isItalic.toggle() }
                }

                Picker("Text color", selection: $style.textColor) {
                    ForEach(TextAnnotationStyle.TextColor.allCases, id: \.self) { color in
                        Label {
                            Text(color.rawValue.capitalized)
                        } icon: {
                            Image(systemName: "circle.fill").foregroundStyle(previewColor(color))
                        }.tag(color)
                    }
                }
                .pickerStyle(.menu)
                .frame(minHeight: 44)
                .accessibilityIdentifier("textNoteColor")

                Picker("Alignment", selection: $style.alignment) {
                    Image(systemName: "text.alignleft").tag(TextAnnotationStyle.Alignment.leading)
                        .accessibilityLabel("Align left")
                    Image(systemName: "text.aligncenter").tag(TextAnnotationStyle.Alignment.center)
                        .accessibilityLabel("Align center")
                    Image(systemName: "text.alignright").tag(TextAnnotationStyle.Alignment.trailing)
                        .accessibilityLabel("Align right")
                }
                .pickerStyle(.segmented)
                .frame(minHeight: 44)
                .accessibilityIdentifier("textNoteAlignment")

                VStack(alignment: .leading, spacing: 8) {
                    Text("Preview").font(.caption).foregroundStyle(.secondary)
                    Text(trimmed.isEmpty ? "Shape the phrase. Keep a steady pulse." : trimmed)
                        .font(Font(TextAnnotationRenderer.font(for: style)))
                        .foregroundStyle(Color(uiColor: TextAnnotationRenderer.color(for: style)))
                        .multilineTextAlignment(previewTextAlignment)
                        .lineLimit(6)
                        .frame(maxWidth: .infinity, minHeight: 80, alignment: previewFrameAlignment)
                        .padding(12)
                        .background(Color(uiColor: TextAnnotationRenderer.paperColor), in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityIdentifier("textNoteStylePreview")
                }
                .padding(.vertical, 4)
            }
        } footer: {
            if showingFormatting { Text("On the score, tap a note and drag a corner to resize its box. Text size stays the same.") }
        }
    }

    private func emphasisButton(_ title: String, systemImage: String, isOn: Bool,
                                identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage).frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(isOn ? .accentColor : .secondary)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    private func previewColor(_ color: TextAnnotationStyle.TextColor) -> Color {
        var sample = style
        sample.textColor = color
        return Color(uiColor: TextAnnotationRenderer.color(for: sample))
    }

    private func adjustTextSize(by delta: Double) {
        style.fontSize = min(TextAnnotationStyle.fontSizeRange.upperBound,
                             max(TextAnnotationStyle.fontSizeRange.lowerBound, style.fontSize + delta))
    }

    private var previewTextAlignment: TextAlignment {
        switch style.alignment {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }

    private var previewFrameAlignment: Alignment {
        switch style.alignment {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }

    private var isCapturing: Bool { speech.ownerID == ownerID && (speech.isPreparing || speech.isListening) }
    private func toggleDictation() {
        if isCapturing {
            if speech.isPreparing { speech.stop(ifOwnedBy: ownerID) }
            else { speech.finishDictation(ifOwnedBy: ownerID) }
        } else { beginDictation() }
    }
    private func beginDictation() {
        focused = false
        dictationPrefix = trimmed
        speech.startDictation(ownerID: ownerID) { finalText in
            text = dictationPrefix.isEmpty ? finalText : dictationPrefix + " " + finalText
        }
    }
}
