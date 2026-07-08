#!/usr/bin/env bash
# Compile and test MagLab's scoring spine on Linux (no Xcode required).
#
# Assembles a temporary SwiftPM package from the REAL iOS sources:
#   - Models/SurveyEnums.swift          (pure Foundation)
#   - Scoring/*.swift                   (pure Foundation)
#   - Models/SensorSample.swift         (SwiftData annotations stripped —
#                                        @Model classes are plain classes
#                                        once the macro is removed, so the
#                                        scoring logic under test is
#                                        byte-identical)
#   - MagLabTests/ScoringTests.swift    (the actual XCTest suite)
# then runs `swift test`.
#
# What this DOES prove: the scoring/model logic type-checks under the real
# Swift 6 compiler and every scoring unit test passes.
# What it does NOT prove: SwiftUI views, SwiftData persistence, Core
# Motion/Location integration — those still require Xcode + simulator/device.
#
# Usage:
#   ./tools/verify_scoring_linux.sh          # host with swift installed
#   docker run --rm -v "$PWD":/maglab -w /maglab swift:6.0-noble \
#       bash tools/verify_scoring_linux.sh   # via Docker
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")/../ios" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SRC="$WORK/Sources/MagLab"
TST="$WORK/Tests/MagLabTests"
mkdir -p "$SRC" "$TST"

# Pure-Foundation sources compile unmodified.
cp "$IOS_DIR/MagLab/Models/SurveyEnums.swift" "$SRC/"
cp "$IOS_DIR"/MagLab/Scoring/*.swift "$SRC/"
cp "$IOS_DIR/MagLab/Services/SensorSnapshot.swift" "$SRC/"
cp "$IOS_DIR/MagLab/Services/SignalModule.swift" "$SRC/"
cp "$IOS_DIR/MagLab/Services/MockSensorManager.swift" "$SRC/"
cp "$IOS_DIR/MagLab/Utilities/Formatters.swift" "$SRC/"
cp "$IOS_DIR"/MagLabTests/*.swift "$TST/"

# Strip SwiftData macro annotations from the models under test.
for model in SensorSample Survey SurveyRun SurveyMarker AnomalyEvent; do
    sed -e '/^import SwiftData$/d' \
        -e '/^@Model$/d' \
        -e 's/@Attribute(\.unique) //' \
        "$IOS_DIR/MagLab/Models/$model.swift" > "$SRC/$model.swift"
done

cat > "$WORK/Package.swift" <<'EOF'
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MagLabScoringVerify",
    targets: [
        .target(name: "MagLab", path: "Sources/MagLab"),
        .testTarget(name: "MagLabTests", dependencies: ["MagLab"], path: "Tests/MagLabTests"),
    ]
)
EOF

cd "$WORK"
swift test 2>&1

# Parse-only pass over EVERY iOS source file (SwiftUI/SwiftData/CoreMotion
# included): no type checking without the Apple SDKs, but catches syntax
# errors in the files the test build above can't cover.
echo
echo "== swiftc -parse over all iOS sources =="
find "$IOS_DIR/MagLab" "$IOS_DIR/MagLabTests" -name '*.swift' -print0 \
    | xargs -0 swiftc -parse
echo "parse OK"
