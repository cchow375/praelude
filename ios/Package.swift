// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PraeludeCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PraeludeCore", targets: ["PraeludeCore"])],
    targets: [
        .target(name: "PraeludeCore", path: "Praelude/Core"),
        .testTarget(name: "PraeludeCoreTests", dependencies: ["PraeludeCore"], path: "PraeludeCoreTests")
    ]
)
