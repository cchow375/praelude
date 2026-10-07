import SwiftUI

/// The writing-mode toolbar (§7 annotation bullets): tool/color/width, layer show/hide, stamp
/// picker, and the existing finger-drawing/undo/redo controls (kept, same accessibility
/// identifiers `MobileMarkupUITests` already exercises). Replaces the system `PKToolPicker` as the
/// primary way to choose a tool (§3b: no stock component look) — a small, curated set of custom
/// pill buttons instead of the system's open-ended color wheel and tool tray.
struct AnnotationToolbar: View {
    @Bindable var markup: ScoreMarkupState
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var simplifiedLabels = false
    var onRemoveSelectedStamp: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            toolRow(compact: true)
            detailRow
        }
        .onChange(of: markup.stampSize) { _, _ in markup.resizeStampPreview() }
    }

    private func toolRow(compact: Bool) -> some View {
        HStack(spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(AnnotationToolKind.allCases) { kind in
                            toolButton(kind, compact: compact)
                        }
                    }
                }
                .accessibilityIdentifier("annotationTools")
                Spacer(minLength: 4)
                Toggle(isOn: $markup.fingerDrawing) {
                    Image(systemName: "hand.draw").font(.system(size: 20)).frame(width: 24, height: 32)
                }.fixedSize().frame(minHeight: 44)
                .accessibilityLabel("Draw with finger").accessibilityIdentifier("fingerDrawing")
                .praeludeToggleHaptic(markup.fingerDrawing)
                Button(action: markup.undoInk) {
                    Image(systemName: "arrow.uturn.backward").font(.system(size: 20)).frame(width: 44, height: 44).contentShape(Rectangle())
                }.disabled(!markup.canUndoInk).accessibilityLabel("Undo ink")
                Button(action: markup.redoInk) {
                    Image(systemName: "arrow.uturn.forward").font(.system(size: 20)).frame(width: 44, height: 44).contentShape(Rectangle())
                }.disabled(!markup.canRedoInk).accessibilityLabel("Redo ink")
            }
    }

    @ViewBuilder private var detailRow: some View {
        switch markup.tool.kind {
        case .pen, .highlighter: inkAttributesRow
        case .stamp: stampPickerRow
        case .eraser, .lasso, .text: layerRow
        }
    }

    private func toolButton(_ kind: AnnotationToolKind, compact: Bool) -> some View {
        let selected = markup.tool.kind == kind
        return Button {
            markup.tool.kind = kind
            if kind != .stamp { markup.armedStamp = nil; markup.stampDraft = nil }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: symbolName(kind)).font(.system(size: 18))
                if !compact { Text(kind.label).font(.caption2).fixedSize() }
            }
            .frame(minWidth: 44, minHeight: 44).padding(.horizontal, 4)
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
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                inkColors.fixedSize(horizontal: true, vertical: false)
                inkWidth.frame(width: 210)
                layerControls
            }
            VStack(alignment: .leading, spacing: 2) {
                ScrollView(.horizontal, showsIndicators: false) { inkColors }
                HStack(spacing: 8) { inkWidth; layerControls }
            }
        }
    }
    private var inkColors: some View {
        HStack(spacing: 6) {
            ForEach(AnnotationColor.allCases) { color in
                Button { markup.tool.color = color } label: {
                    Circle().fill(color.color).frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(PraeludeColor.ink, lineWidth: markup.tool.color == color ? 2 : 0))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(color.label).accessibilityIdentifier("annotationColor_\(color.rawValue)")
            }
        }
    }
    private var inkWidth: some View {
        Picker("Width", selection: $markup.tool.width) {
            ForEach(AnnotationWidth.allCases) { width in Text(width.label).tag(width) }
        }.pickerStyle(.segmented).frame(maxWidth: 220).accessibilityIdentifier("annotationWidth")
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
                    Text(markup.armedStamp == nil ? "Choose a stamp." : "Tap or drag to preview. Place when ready.")
                        .font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                }
                Spacer(minLength: 0)
                layerControls
            }
            // Keep sizing and confirmation anchored so slider drags do not compete with a
            // horizontal toolbar scroll recognizer.
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    HStack { Text("Size").font(.caption); stampSizeSlider }
                    stampPlacementActions
                }
            } else {
                HStack(spacing: 8) {
                    Text("Size").font(.caption).fixedSize()
                    stampSizeSlider
                    stampPlacementActions
                }
            }
        }
    }
    private var stampSizeSlider: some View {
        Slider(value: $markup.stampSize, in: 0.02...0.12)
            .frame(minWidth: 80, maxWidth: 220, minHeight: 44)
            .accessibilityLabel("Stamp size").accessibilityIdentifier("stampSize")
    }
    private var stampPlacementActions: some View {
        HStack(spacing: 8) {
            if markup.stampDraft != nil {
                Button("Cancel") { markup.stampDraft = nil }.frame(minWidth: 44, minHeight: 44)
                Button("Place", action: markup.confirmStamp).buttonStyle(.borderedProminent)
                    .frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("confirmStamp")
            }
        }.fixedSize(horizontal: true, vertical: false)
    }
    private func stampButton(_ kind: StampKind, _ label: String?) -> some View {
        let selected = markup.armedStamp.map { $0.kind == kind && $0.label == label } ?? false
        return Button { markup.armedStamp = (kind, label); markup.selectedStampID = nil } label: {
            PraeludeStamp(kind: kind, label: label, size: 26)
                .accessibilityHidden(true)
                .padding(3).background(Color.white, in: RoundedRectangle(cornerRadius: 5))
                .frame(width: 44, height: 44)
                .background(selected ? PraeludeColor.inkFillPressed : PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: PraeludeRadius.tight))
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityLabel(PraeludeStamp(kind: kind, label: label).accessibilityDescription)
            .accessibilityIdentifier("stamp_\(kind.rawValue)_\(label ?? "plain")")
    }

    private var layerRow: some View { HStack { Spacer(); layerControls } }

    /// §7: which layer the next mark is attributed to, and which layers currently show. A layer
    /// other than `activeLayer` is always shown read-only when visible — see `ScorePageOverlay`.
    private var layerControls: some View {
        Menu {
            Picker("Write on layer", selection: Binding(get: { markup.activeLayer }, set: { layer in
                // Save against the old layer's baseline before changing the save callback's owner.
                guard layer != markup.activeLayer, markup.flushInk() else { return }
                markup.activeLayer = layer
                markup.visibleLayers.insert(layer)
            })) {
                ForEach(InkLayer.allCases, id: \.self) { layer in Text(layerLabel(layer)).tag(layer) }
            }.accessibilityIdentifier("activeLayer")
            Section("Visible layers") {
                ForEach(InkLayer.allCases, id: \.self) { layer in
                    Toggle(layerLabel(layer), isOn: Binding(get: { markup.visibleLayers.contains(layer) }, set: { visible in
                        if visible { markup.visibleLayers.insert(layer) } else { markup.visibleLayers.remove(layer) }
                    })).accessibilityIdentifier("layerVisibility_\(layer.rawValue)")
                }
            }
        } label: {
            Label(layerLabel(markup.activeLayer), systemImage: "square.3.layers.3d")
                .font(.caption).frame(minWidth: 44, minHeight: 44)
        }.accessibilityLabel("Annotation layers, writing on \(layerLabel(markup.activeLayer))")
            .accessibilityIdentifier("annotationLayers")
    }

    private func layerLabel(_ layer: InkLayer) -> String {
        switch layer { case .mine: return "Mine"; case .teacher: return "Teacher"; case .performance: return "Performance" }
    }
}
