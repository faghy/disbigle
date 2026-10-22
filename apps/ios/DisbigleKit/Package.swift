// swift-tools-version: 6.0
import PackageDescription

// Models, API client and sign-in for the Disbigle iOS app. No UI code: it also builds and
// tests on Linux.
let package = Package(
  name: "DisbigleKit",
  defaultLocalization: "en",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "DisbigleKit", targets: ["DisbigleKit"])],
  targets: [
    .target(name: "DisbigleKit", resources: [.process("Resources")]),
    .testTarget(name: "DisbigleKitTests", dependencies: ["DisbigleKit"]),
  ]
)
