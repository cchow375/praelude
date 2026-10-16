import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

/// Camera and Photos share exactly the same crop/metadata/save path. Cancellation never writes
/// a score, and a failed metadata write removes the staged file without touching existing scores.
struct PassageCaptureView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let onSaved: (UUID, UUID) -> Void
    @State private var image: UIImage?
    @State private var selection: PhotosPickerItem?
    @State private var crop = CGRect(x: 0.04, y: 0.25, width: 0.92, height: 0.45)
    @State private var workTitle = ""
    @State private var passageTitle = ""
    @State private var composer = ""
    @State private var focus = "Pulse"
    @State private var enhance = false
    @State private var loading = false
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var showingCamera = false
    @State private var cameraDenied = false
    @State private var cameraLease: UUID?
    @State private var processing: Task<Void, Never>?
    @State private var acquiringCamera: Task<Void, Never>?
    @State private var generation = UUID()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let errorMessage { ErrorMessage(message: errorMessage) }
                    if let image {
                        VStack(alignment: .leading, spacing: 12) {
                            PassageCaptureCropView(image: image, crop: $crop)
                            HStack {
                                Button("Rotate", systemImage: "rotate.right") { rotate(image) }
                                Spacer()
                                Button("Reset crop") { crop = CGRect(x: 0, y: 0, width: 1, height: 1) }
                            }.font(.subheadline).frame(minHeight: 44)
                            Toggle("Improve paper contrast", isOn: $enhance).font(.subheadline)
                            Text("Only your cropped passage is saved. The rest of the photo is discarded.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        details
                        sourceButtons(retake: true)
                    } else if loading {
                        ProgressView("Preparing photo…").frame(maxWidth: .infinity, minHeight: 250)
                    } else {
                        VStack(alignment: .leading, spacing: 14) {
                            Image(systemName: "rectangle.stack.badge.plus").font(.system(size: 36, weight: .light))
                            Text("Your paper score, one passage at a time").font(.title2.weight(.semibold))
                            Text("Photograph a few bars from your book, crop the notes, then practice the card. A complete digital score is optional.")
                                .foregroundStyle(.secondary)
                        }.padding(.vertical, 16)
                        sourceButtons(retake: false)
                    }
                    if loading && image != nil { ProgressView("Preparing photo…") }
                    if saving { ProgressView("Saving passage…").frame(maxWidth: .infinity) }
                }.padding(20).frame(maxWidth: 680).frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("passageCaptureScroll")
            .scrollDismissesKeyboard(.interactively)
            .background(PraeludeColor.paper)
            .navigationTitle(image == nil ? "New photo passage" : "Crop your passage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { cancel() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save card", action: save).bold()
                        .disabled(image == nil || loading || saving || workTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("savePhotoPassage")
                }
            }
            .disabled(saving)
            .interactiveDismissDisabled(saving)
            .fullScreenCover(isPresented: $showingCamera, onDismiss: releaseCamera) {
                PassagePhotoCamera(onFinish: { photo in
                    showingCamera = false
                    load(photo)
                }, onCancel: { showingCamera = false })
                    .ignoresSafeArea()
            }
            .alert("Camera access is off", isPresented: $cameraDenied) {
                Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                Button("Use Photos", role: .cancel) {}
            } message: { Text("Allow camera access in Settings to photograph a passage, or choose an existing photo below.") }
            .onChange(of: selection) { _, item in
                guard let item else { return }
                load(item)
            }
            .task {
                #if DEBUG
                let arguments = ProcessInfo.processInfo.arguments
                if arguments.contains("--uitesting"), arguments.contains("--audit-passage-photo"), image == nil {
                    load(Self.auditPhoto())
                }
                #endif
            }
            .onDisappear {
                // Presenting the full-screen system camera also hides this view. Keep its lease
                // until the camera actually dismisses, rather than allowing face tracking back in.
                if !showingCamera { processing?.cancel(); acquiringCamera?.cancel(); releaseCamera() }
            }
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Name it so it is easy to find").font(.headline)
            TextField("Piece or work title", text: $workTitle).textInputAutocapitalization(.words)
                .accessibilityIdentifier("photoPassageWorkTitle")
            TextField("Passage name (optional)", text: $passageTitle).textInputAutocapitalization(.sentences)
                .accessibilityIdentifier("photoPassageName")
            TextField("Composer (optional)", text: $composer).textInputAutocapitalization(.words)
            TextField("What are you focusing on?", text: $focus).textInputAutocapitalization(.sentences)
            Text("Cards are recognized by their music. A name is just a helpful extra.")
                .font(.caption).foregroundStyle(.secondary)
        }.textFieldStyle(.roundedBorder)
    }

    private func sourceButtons(retake: Bool) -> some View {
        VStack(spacing: 12) {
            Button(action: openCamera) {
                Label(retake ? "Retake photo" : "Take a photo", systemImage: "camera")
                    .frame(maxWidth: .infinity, minHeight: 28)
            }.buttonStyle(.praeludePrimary).accessibilityIdentifier("takePassagePhoto")
            PhotosPicker(selection: $selection, matching: .images, photoLibrary: .shared()) {
                Label(retake ? "Choose a different photo" : "Choose from Photos", systemImage: "photo")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }.buttonStyle(.bordered).accessibilityIdentifier("choosePassagePhoto")
        }.disabled(loading || saving)
    }

    private func openCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            errorMessage = "A camera is not available here. Choose a passage from Photos instead."; return
        }
        acquiringCamera?.cancel()
        acquiringCamera = Task { @MainActor in
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            var allowed = status == .authorized
            if status == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .video) }
            guard !Task.isCancelled else { return }
            guard allowed else { cameraDenied = true; return }
            guard let lease = await FaceGestureService.reserveForPassageCapture() else {
                errorMessage = "The camera is already in use. Close the other camera view and try again."; return
            }
            guard !Task.isCancelled else { FaceGestureService.releasePassageCapture(lease); return }
            cameraLease = lease; errorMessage = nil; showingCamera = true
        }
    }

    private func releaseCamera() {
        if let cameraLease { FaceGestureService.releasePassageCapture(cameraLease); self.cameraLease = nil }
    }

    private func load(_ photo: UIImage) {
        processing?.cancel(); let token = UUID(); generation = token; loading = true
        processing = Task { @MainActor in
            do {
                let normalized = try await PassageCaptureProcessor.shared.normalize(photo)
                guard !Task.isCancelled, generation == token else { return }
                image = normalized; crop = CGRect(x: 0.04, y: 0.25, width: 0.92, height: 0.45); errorMessage = nil
            } catch { if !Task.isCancelled, generation == token { errorMessage = error.localizedDescription } }
            if generation == token { loading = false }
        }
    }

    private func load(_ item: PhotosPickerItem) {
        processing?.cancel(); let token = UUID(); generation = token; loading = true
        processing = Task { @MainActor in
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw PracticeError.invalid("This photo is unavailable. Download it in Photos or choose another image.")
                }
                let decoded = try await PassageCaptureProcessor.shared.decode(data)
                guard !Task.isCancelled, generation == token else { return }
                image = decoded; crop = CGRect(x: 0.04, y: 0.25, width: 0.92, height: 0.45); errorMessage = nil
            } catch { if !Task.isCancelled, generation == token { errorMessage = error.localizedDescription } }
            if generation == token { loading = false; selection = nil }
        }
    }

    private func rotate(_ photo: UIImage) {
        processing?.cancel(); let token = UUID(); generation = token; loading = true
        processing = Task { @MainActor in
            do {
                let rotated = try await PassageCaptureProcessor.shared.normalize(photo, clockwise: true)
                guard !Task.isCancelled, generation == token else { return }
                image = rotated; crop = CGRect(x: 0, y: 0, width: 1, height: 1)
            } catch { if !Task.isCancelled { errorMessage = error.localizedDescription } }
            if generation == token { loading = false }
        }
    }

    private func save() {
        guard let image, !saving, !loading else { return }
        let title = workTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 500, passageTitle.count <= 500, focus.count <= 500, composer.count <= 500 else {
            errorMessage = "Keep each name and focus to 500 characters or fewer."; return
        }
        saving = true; errorMessage = nil
        let rect = crop, enhance = enhance, directory = store.directory
        processing = Task { @MainActor in
            var staged: URL?
            do {
                let data = try await PassageCaptureProcessor.shared.preparePDF(image: image, rect: rect, enhance: enhance)
                try Task.checkCancellation()
                let name = UUID().uuidString + ".pdf"
                staged = try await PassageCaptureProcessor.shared.stage(data, directory: directory, fileName: name)
                try Task.checkCancellation()
                let piece = Piece(title: title, composer: composer.trimmingCharacters(in: .whitespacesAndNewlines), pdfFileName: name, pageCount: 1)
                let trimmedName = passageTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedFocus = focus.trimmingCharacters(in: .whitespacesAndNewlines)
                let passage = Passage(pieceID: piece.id, title: trimmedName.isEmpty ? title : trimmedName,
                                      focus: trimmedFocus.isEmpty ? "Pulse" : trimmedFocus,
                                      regions: [PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)])
                try await store.addPassageCardPreparedAsync(piece: piece, passage: passage)
                PraeludeHaptic.confirm(); saving = false; staged = nil
                onSaved(piece.id, passage.id); dismiss()
            } catch {
                if let staged { await PassageCaptureProcessor.shared.removeStaged(staged) }
                if !Task.isCancelled { errorMessage = error.localizedDescription }
                saving = false
            }
        }
    }

    private func cancel() {
        processing?.cancel(); acquiringCamera?.cancel(); releaseCamera(); dismiss()
    }

    #if DEBUG
    /// Synthetic original music-like marks, used only by the explicit disposable-store audit.
    /// The crop, PDF staging, atomic save and subsequent practice paths remain production code.
    private static func auditPhoto() -> UIImage {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: 1000, height: 700), format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1000, height: 700))
            ("Passage photo study" as NSString).draw(at: CGPoint(x: 55, y: 35), withAttributes: [.font: UIFont.systemFont(ofSize: 30), .foregroundColor: UIColor.black])
            let cg = context.cgContext; cg.setStrokeColor(UIColor.black.cgColor); cg.setLineWidth(2)
            for staff in 0..<4 {
                let y = CGFloat(180 + staff * 100)
                for line in 0..<5 {
                    cg.move(to: CGPoint(x: 55, y: y + CGFloat(line * 12)))
                    cg.addLine(to: CGPoint(x: 945, y: y + CGFloat(line * 12)))
                }
                cg.strokePath()
                for note in 0..<12 {
                    let x = CGFloat(100 + note * 68), noteY = y + CGFloat((note % 5) * 12)
                    cg.setFillColor(UIColor.black.cgColor); cg.fillEllipse(in: CGRect(x: x, y: noteY, width: 20, height: 13))
                    cg.move(to: CGPoint(x: x + 18, y: noteY + 6)); cg.addLine(to: CGPoint(x: x + 18, y: noteY - 40)); cg.strokePath()
                }
            }
        }
    }
    #endif
}

private struct PassagePhotoCamera: UIViewControllerRepresentable {
    let onFinish: (UIImage) -> Void
    let onCancel: () -> Void
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera; controller.cameraCaptureMode = .photo
        controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish, onCancel: onCancel) }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage) -> Void
        let onCancel: () -> Void
        init(onFinish: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) { self.onFinish = onFinish; self.onCancel = onCancel }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onFinish(image) } else { onCancel() }
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onCancel() }
    }
}
