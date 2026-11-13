import Foundation
import PDFKit
import UIKit
import Vision

struct ScoreNumberHint: Identifiable, Sendable {
    let id = UUID()
    let number: Int
    let region: NormalizedRect
}

struct ScoreMapScan: @unchecked Sendable {
    let image: UIImage
    let rotation: Int
    let hints: [ScoreNumberHint]
}

/// All PDF opening, rendering and OCR stays off the UI actor. Hints remain unconfirmed until
/// the player identifies their region and measure range; page numbers/fingerings may look alike.
enum ScoreOrganizationScanner {
    static func sections(url: URL) async -> [ScoreSection] {
        await Task.detached(priority: .userInitiated) {
            guard let pdf = PDFDocument(url: url), let root = pdf.outlineRoot else { return [] }
            var starts: [(String, Int)] = []
            func visit(_ outline: PDFOutline) {
                if let title = outline.label?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty,
                   let page = outline.destination?.page {
                    let index = pdf.index(for: page)
                    if index != NSNotFound { starts.append((title, index + 1)) }
                }
                for index in 0..<outline.numberOfChildren { if let child = outline.child(at: index) { visit(child) } }
            }
            visit(root)
            var seen: Set<Int> = []
            let unique = starts.sorted { $0.1 < $1.1 }.filter { seen.insert($0.1).inserted }.prefix(1000)
            let values = Array(unique)
            return values.enumerated().map { index, item in
                ScoreSection(title: String(item.0.prefix(200)), startPage: item.1,
                             endPage: index + 1 < values.count ? values[index + 1].1 - 1 : pdf.pageCount)
            }
        }.value
    }

    static func page(url: URL, number: Int, recognizeNumbers: Bool) async throws -> ScoreMapScan {
        try await Task.detached(priority: .userInitiated) {
            guard let pdf = PDFDocument(url: url), let page = pdf.page(at: number - 1) else {
                throw PracticeError.invalid("This score page could not be opened.")
            }
            let image = page.thumbnail(of: CGSize(width: 1400, height: 1900), for: .cropBox)
            var hints: [ScoreNumberHint] = []
            if recognizeNumbers, let cgImage = image.cgImage {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate; request.usesLanguageCorrection = false
                try VNImageRequestHandler(cgImage: cgImage).perform([request])
                for observation in request.results ?? [] {
                    guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.5,
                          let value = Int(candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)),
                          (1...100000).contains(value) else { continue }
                    let box = observation.boundingBox
                    let displayed = CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
                    let original = displayed.normalizedRotatedForDisplay(pageRotationDegrees: -page.rotation)
                    hints.append(ScoreNumberHint(number: value, region: NormalizedRect(x: original.minX, y: original.minY,
                                                                                      width: original.width, height: original.height)))
                }
            }
            return ScoreMapScan(image: image, rotation: page.rotation, hints: hints.sorted { $0.region.y < $1.region.y })
        }.value
    }
}
