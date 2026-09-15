#!/bin/bash
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/praelude-ios-check.XXXXXX")"
trap 'rm -rf "$CHECK_TEMP"' EXIT

swift test --package-path "$IOS_ROOT"
xcrun swiftc -parse-as-library \
  "$IOS_ROOT/Praelude/Services/VoiceCommand.swift" \
  "$IOS_ROOT/Praelude/Services/MetronomePattern.swift" \
  "$IOS_ROOT/Praelude/Services/PracticeFeedbackEvent.swift" \
  "$IOS_ROOT/ServiceChecks/main.swift" \
  -o "$CHECK_TEMP/services-check"
"$CHECK_TEMP/services-check"

# --core-only supports editing native UI while keeping all deterministic checks runnable.
if [[ "${1:-}" != "--core-only" ]]; then
  xcodebuild -project "$IOS_ROOT/Praelude.xcodeproj" -scheme Praelude \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$IOS_ROOT/DerivedData" CODE_SIGNING_ALLOWED=NO build
fi
