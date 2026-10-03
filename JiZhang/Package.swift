// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JiZhang",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "JiZhangCore", targets: ["JiZhangCore"]),
        .executable(name: "jizhang-verify", targets: ["JiZhangVerify"])
    ],
    targets: [
        .target(name: "JiZhangCore", path: "Sources/JiZhangCore"),
        .executableTarget(name: "JiZhangVerify", dependencies: ["JiZhangCore"], path: "Sources/JiZhangVerify")
    ]
)
