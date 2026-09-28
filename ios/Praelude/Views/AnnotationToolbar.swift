import SwiftUI

/// The writing-mode toolbar (§7 annotation bullets): tool/color/width, layer show/hide, stamp
/// picker, and the existing finger-drawing/undo/redo controls (kept, same accessibility
/// identifiers `MobileMarkupUITests` already exercises). Replaces the system `PKToolPicker` as the
/// primary way to choose a tool (§3b: no stock component look) — a small, curated set of custom
/// pill buttons instead of the system's open-ended color wheel and tool tray.
struct AnnotationToolbar: View {
    @Bindable var markup: ScoreMarkupState
    var simplifiedLabels = false
    var onRemoveSelectedStamp: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(AnnotationToolKind.allCases) { kind in
                            toolButton(kind)
                        }
                    }
                }
                Spacer(minLength: 4)
                Toggle(isOn: $markup.fingerDrawing) {
                    if simplifiedLabels {
                        Image(systemName: "hand.draw").font(.system(size: 20)).frame(width: 32, height: 32)
                    } else {
                        Text("Draw with finger").font(.subheadline)
                    }
                }
                .accessibilityLabel("Draw with finger").accessibilityIdentifier("fingerDrawing")
                .praeludeToggleHaptic(markup.fingerDrawing)
                Button(action: markup.undoInk) {
                    Image(systemName: "arrow.uturn.backward").font(.system(size: 20)).frame(width: 40, height: 40).contentShape(Rectangle())
                }.disabled(!markup.canUndoInk).accessibilityLabel("Undo ink")
                Button(action: markup.redoInk) {
                    Image(systemName: "arrow.uturn.forward").font(.system(size: 20)).frame(width: 40, height: 40).contentShape(Rectangle())
                }.disabled(!markup.canRedoInk).accessibilityLabel("Redo ink")
            }
            detailRow
        }
    }

    @ViewBuilder private var detailRow: some View {
        switch markup.tool.kind {
        case .pen, .highlighter: inkAttributesRow
        case .stamp: stampPickerRow
        case .eraser, .lasso, .text: layerRow
        }
    }

    private func toolButton(_ kind: AnnotationToolKind) -> some View {
        let selected = markup.tool.kind == kind
        return Button {
            markup.tool.kind = kind
            if kind != .stamp { markup.armedStamp = nil }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: symbolName(kind)).font(.system(size: 18))
                if !simplifiedLabels { Text(kind.label).font(.caption2) }
            }
            .frame(minWidth: 44, minHeight: 40).padding(.horizontal, 4)
            .background(selected ? PraeludeColor.inkFillPressed : PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: PraeludeRadius.control))
        }
        .buttonStyle(.plain).foregroundStyle(PraeludeColor.ink)
        .accessibilityLabel(kind.label).accessibilityIdentifier("annotationTool_\(kind.rawValue)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
    private func symbolName(_ kind: AnnotationToolKind) -> String {
        switch kind {
        case .pen: return "pencil.tip"
        case .highlighter: return "highlighter"
        case .eraser: return "eraser"
        case .lasso: return "lasso"
        case .stamp: return "music.note"
        case .text: return "text.bubble"
        }
    }

    private var inkAttributesRow: some View {
        HStack(spacing: 14) {
            HStack(spacing: 8) {
                ForEach(AnnotationColor.allCases) { color in
                    Button { markup.tool.color = color } label: {
                        Circle().fill(color.color).frame(width: 26, height: 26)
                            .overlay(Circle().strokeBorder(PraeludeColor.ink, lineWidth: markup.tool.color == color ? 2 : 0))
                    }.buttonStyle(.plain).accessibilityLabel(color.label).accessibilityIdentifier("annotationColor_\(color.rawValue)")
                }
            }
            Divider().frame(height: 22)
            Picker("Width", selection: $markup.tool.width) {
                ForEach(AnnotationWidth.allCases) { width in Text(width.label).tag(width) }
            }.pickerStyle(.segmented).frame(maxWidth: 220).accessibilityIdentifier("annotationWidth")
            Spacer(minLength: 0)
            layerControls
        }
    }

    private var stampPickerRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(StampKind.allCases, id: \.self) { kind in
                        if let labels = kind.labels {
                            ForEach(labels, id: \.self) { label in stampButton(kind, label) }
                        } else {
                            stampButton(kind, nil)
                        }
                    }
                }.padding(.vertical, 2)
            }
            HStack {
                if markup.selectedStampID != nil {
                    Button("Remove stamp", role: .destructive, action: onRemoveSelectedStamp)
                        .font(.caption).accessibilityIdentifier("removeStamp")
                } else {
                    Text(markup.armedStamp == nil ? "Choose a stamp, then tap the score." : "Tap the score to place it.")
                        .font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                }
                Spacer(minLength: 0)
                layerControls
            }
        }
    }
    private func stampButton(_ kind: StampKind, _ label: String?) -> some View {
        let selected = markup.armedStamp.map { $0.kind == kind && $0.label == label } ?? false
        return Button { markup.armedStamp = (kind, label); markup.selectedStampID = nil } label: {
            PraeludeStamp(kind: kind, label: label, size: 26).padding(6)
                .background(selected ? PraeludeColor.inkFillPressed : PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: PraeludeRadius.tight))
        }.buttonStyle(.plain).accessibilityIdentifier("stamp_\(kind.rawValue)_\(label ?? "plain")")
    }

    private var layerRow: some View { HStack { Spacer(); layerControls } }

    /// §7: which layer the next mark is attributed to, and which layers currently show. A layer
    /// other than `activeLayer` is always shown read-only when visible — see `ScorePageOverlay`.
    private var layerControls: some View {
        HStack(spacing: 10) {
            Picker("Layer", selection: $markup.activeLayer) {
                Text("Mine").tag(InkLayer.mine)
                Text("Teacher").tag(InkLayer.teacher)
                Text("Performance").tag(InkLayer.performance)
            }.pickerStyle(.segmented).frame(maxWidth: 260).accessibilityIdentifier("activeLayer")
            ForEach(InkLayer.allCases, id: \.self) { layer in
                Button {
                    if markup.visibleLayers.contains(layer) { markup.visibleLayers.remove(layer) } else { markup.visibleLayers.insert(layer) }
                } label: {
                    Image(systemName: markup.visibleLayers.contains(layer) ? "eye" : "eye.slash")
                        .frame(width: 30, height: 30)
                }.buttonStyle(.plain).foregroundStyle(layer == markup.activeLayer ? PraeludeColor.ink : PraeludeColor.inkSecondary)
                    .accessibilityLabel("\(layerLabel(layer)) layer \(markup.visibleLayers.contains(layer) ? "visible" : "hidden")")
                    .accessibilityIdentifier("layerVisibility_\(layer.rawValue)")
            }
        }
    }
    private func layerLabel(_ layer: InkLayer) -> String {
        switch layer { case .mine: return "Mine"; case .teacher: return "Teacher"; case .performance: return "Performance" }
    }
}
