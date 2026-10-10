#!/usr/bin/env python3
"""Generate the dependency-free native Xcode project; never touches user data."""

from pathlib import Path
import hashlib
import json
import plistlib

root = Path(__file__).resolve().parents[1]
objects = {}

# Permission requests otherwise terminate the app before Swift can report an error. Check the
# actual plist used by both Debug and Release, not a generated setting that can silently drift.
with (root / "Praelude" / "Info.plist").open("rb") as source:
    privacy_plist = plistlib.load(source)
for privacy_key in ("NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription", "NSCameraUsageDescription"):
    if not isinstance(privacy_plist.get(privacy_key), str) or not privacy_plist[privacy_key].strip():
        raise ValueError(f"Missing required privacy description: {privacy_key}")


def ident(value):
    return hashlib.sha1(value.encode()).hexdigest()[:24].upper()


def obj(key, body):
    value = ident(key)
    objects[value] = body
    return value


def q(value):
    return json.dumps(str(value))


def array(values):
    return "(" + ", ".join(values) + (",)" if values else ")")


def configs(prefix, settings, base_config=None):
    ids = []
    for mode in ("Debug", "Release"):
        options = dict(settings)
        options.update(
            {
                "ENABLE_TESTABILITY": "YES" if mode == "Debug" else "NO",
                # Xcode's own new-project default, which nothing else in this scripted project sets:
                # without it, Debug falls back to building every ARCHS entry (arm64 *and* x86_64) for
                # any concrete (non-"generic") simulator destination. On an Apple Silicon Mac the
                # Supabase SPM package products only ever get built for the host's native arm64 slice,
                # so an x86_64 Debug build of this app target then fails with "Unable to resolve
                # module dependency" for Auth/PostgREST/Storage — a real module, just never built for
                # the arch this setting was wrongly asking for. Release keeps building every arch
                # (matches ARCHS/VALID_ARCHS below) since an archive must run on real devices.
                "ONLY_ACTIVE_ARCH": "YES" if mode == "Debug" else "NO",
                "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if mode == "Debug" else "-O",
                "SWIFT_ACTIVE_COMPILATION_CONDITIONS": (
                    "DEBUG" if mode == "Debug" else ""
                ),
                "DEBUG_INFORMATION_FORMAT": (
                    "dwarf" if mode == "Debug" else "dwarf-with-dsym"
                ),
            }
        )
        # Release links supabase-swift's internal `Helpers` target statically (Products/Helpers.o,
        # no PackageFrameworks/Helpers.framework), so the Debug-only `-framework Helpers` workaround
        # documented on OTHER_LDFLAGS below would fail the device Release link with
        # "framework 'Helpers' not found". Keep it for Debug only.
        if mode == "Release" and "OTHER_LDFLAGS" in options:
            options["OTHER_LDFLAGS"] = options["OTHER_LDFLAGS"].replace(" -framework Helpers", "")
        base = (
            "baseConfigurationReference = " + base_config + "; " if base_config else ""
        )
        ids.append(
            obj(
                prefix + mode,
                "isa = XCBuildConfiguration; name = "
                + mode
                + "; "
                + base
                + "buildSettings = {"
                # Every key is quoted via q(), not just values — a bareword key is only valid in the
                # old-style ASCII plist .pbxproj format for a limited character set; a conditionalized
                # key like "EXCLUDED_ARCHS[sdk=iphonesimulator*]" (brackets, "=", "*") needs quoting
                # or the project file fails to parse ("damaged ... parse error"). A quoted plain key
                # like "SWIFT_VERSION" is equally valid, so this is safe for every existing entry too.
                + " ".join(q(k) + " = " + q(v) + ";" for k, v in options.items())
                + "};",
            )
        )
    return obj(
        prefix + "configs",
        "isa = XCConfigurationList; buildConfigurations = "
        + array(ids)
        + "; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;",
    )


app_files = []
app_sources = []
resources = []
for path in sorted((root / "Praelude").rglob("*.swift")):
    rel = path.relative_to(root).as_posix()
    f = obj(
        rel,
        "isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "
        + q(rel)
        + "; sourceTree = SOURCE_ROOT;",
    )
    app_files.append(f)
    app_sources.append(obj(rel + "build", "isa = PBXBuildFile; fileRef = " + f + ";"))
for path in ("Praelude/Resources/Assets.xcassets", "Praelude/PrivacyInfo.xcprivacy"):
    kind = "folder.assetcatalog" if path.endswith("xcassets") else "text.xml"
    f = obj(
        path,
        "isa = PBXFileReference; lastKnownFileType = "
        + kind
        + "; path = "
        + q(path)
        + "; sourceTree = SOURCE_ROOT;",
    )
    app_files.append(f)
    resources.append(obj(path + "build", "isa = PBXBuildFile; fileRef = " + f + ";"))
# Bundled fonts (design system: BodoniModa.ttf display/numeral face, Bravura.otf SMuFL music glyphs).
# Both are OFL-licensed and registered via Info.plist UIAppFonts; only the font binaries are
# Copy-Bundle-Resources build-phase members, not their sibling *-OFL.txt license text.
for path in sorted((root / "Praelude/Resources/Fonts").glob("*.ttf")) + sorted(
    (root / "Praelude/Resources/Fonts").glob("*.otf")
):
    rel = path.relative_to(root).as_posix()
    f = obj(
        rel,
        "isa = PBXFileReference; lastKnownFileType = file; path = "
        + q(rel)
        + "; sourceTree = SOURCE_ROOT;",
    )
    app_files.append(f)
    resources.append(obj(rel + "build", "isa = PBXBuildFile; fileRef = " + f + ";"))

# Remote SPM dependency: supabase-swift, pinned to an exact release (spec 4b/4c/4d - auth, sync,
# storage). Individual products only (Auth, PostgREST, Storage, Realtime), not the combined
# "Supabase" product, "Functions" or "PostgrestMacros" - verified against the package's own
# Package.swift at this tag: those four targets' only dependencies are swift-crypto (Auth only),
# swift-http-types, swift-log and swift-concurrency-extras/xctest-dynamic-overlay, none of them a
# macro/codegen package, keeping this dependency-free project's new dependency graph small and
# predictable to resolve on a Mac shared with other agents' builds.
supabase_package = obj(
    "supabasePackage",
    "isa = XCRemoteSwiftPackageReference; repositoryURL = "
    + q("https://github.com/supabase/supabase-swift")
    + "; requirement = {kind = exactVersion; version = "
    + q("2.55.2")
    + ";};",
)
supabase_products = {
    name: obj(
        "supabaseProduct" + name,
        "isa = XCSwiftPackageProductDependency; package = "
        + supabase_package
        + "; productName = "
        + name
        + ";",
    )
    for name in ("Auth", "PostgREST", "Storage", "Realtime")
}


def package_build_files(tag):
    # A package product is linked via a PBXBuildFile whose productRef (not fileRef) points at the
    # XCSwiftPackageProductDependency - a separate PBXBuildFile per target/phase, same as Xcode's
    # own generator, even though every one of them points at the same four product dependencies.
    return [
        obj(tag + name + "Build", "isa = PBXBuildFile; productRef = " + ref + ";")
        for name, ref in supabase_products.items()
    ]


test_files = []
test_sources = []
for path in sorted((root / "PraeludeUITests").glob("*.swift")):
    rel = path.relative_to(root).as_posix()
    f = obj(
        rel,
        "isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "
        + q(rel)
        + "; sourceTree = SOURCE_ROOT;",
    )
    test_files.append(f)
    test_sources.append(obj(rel + "build", "isa = PBXBuildFile; fileRef = " + f + ";"))
unit_files = []
unit_sources = []
for path in sorted((root / "PraeludeAppTests").glob("*.swift")):
    rel = path.relative_to(root).as_posix()
    f = obj(
        rel,
        "isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "
        + q(rel)
        + "; sourceTree = SOURCE_ROOT;",
    )
    unit_files.append(f)
    unit_sources.append(obj(rel + "build", "isa = PBXBuildFile; fileRef = " + f + ";"))
unit_product = obj(
    "unitProduct",
    "isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = PraeludeAppTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;",
)
unit_group = obj(
    "unitGroup",
    "isa = PBXGroup; name = PraeludeAppTests; children = "
    + array(unit_files)
    + '; sourceTree = "<group>";',
)
app_product = obj(
    "appProduct",
    "isa = PBXFileReference; explicitFileType = wrapper.application; path = Praelude.app; sourceTree = BUILT_PRODUCTS_DIR;",
)
test_product = obj(
    "testProduct",
    "isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = PraeludeUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;",
)
products = obj(
    "products",
    "isa = PBXGroup; name = Products; children = "
    + array([app_product, test_product, unit_product])
    + '; sourceTree = "<group>";',
)
app_group = obj(
    "appGroup",
    "isa = PBXGroup; name = Praelude; children = "
    + array(app_files)
    + '; sourceTree = "<group>";',
)
test_group = obj(
    "testGroup",
    "isa = PBXGroup; name = PraeludeUITests; children = "
    + array(test_files)
    + '; sourceTree = "<group>";',
)
signing_config = obj(
    "Signing.xcconfig",
    'isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = "Signing.xcconfig"; sourceTree = SOURCE_ROOT;',
)
main = obj(
    "main",
    "isa = PBXGroup; children = "
    + array([signing_config, app_group, test_group, unit_group, products])
    + '; sourceTree = "<group>";',
)


def phase(key, isa, files):
    return obj(
        key,
        "isa = "
        + isa
        + "; buildActionMask = 2147483647; files = "
        + array(files)
        + "; runOnlyForDeploymentPostprocessing = 0;",
    )


app_phases = [
    phase("sources", "PBXSourcesBuildPhase", app_sources),
    phase("frameworks", "PBXFrameworksBuildPhase", package_build_files("app")),
    phase("resources", "PBXResourcesBuildPhase", resources),
]
test_phases = [
    phase("testSources", "PBXSourcesBuildPhase", test_sources),
    phase("testFrameworks", "PBXFrameworksBuildPhase", []),
    phase("testResources", "PBXResourcesBuildPhase", []),
]
common = {
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "SDKROOT": "iphoneos",
    "SWIFT_VERSION": "6.0",
    "TARGETED_DEVICE_FAMILY": "1,2",
    "CODE_SIGN_STYLE": "Automatic",
    "CLANG_ENABLE_MODULES": "YES",
    "SWIFT_STRICT_CONCURRENCY": "complete",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    # The Supabase SPM package products (Auth/PostgREST/Storage/Realtime) only ever resolve an
    # arm64 slice for the simulator SDK on this Apple Silicon host (verified: `swiftpm` never built
    # an x86_64 variant for them, matching the ONLY_ACTIVE_ARCH comment above). ONLY_ACTIVE_ARCH
    # only narrows a *concrete* simulator destination down to one arch; a *generic* one (what
    # `scripts/check.sh`'s own build step and an archive both use) ignores it and builds every
    # ARCHS entry regardless, which for the simulator SDK's Xcode default (`$(ARCHS_STANDARD)` =
    # arm64 *and* x86_64) fails to resolve those package products for the x86_64 leg. Project-level
    # (inherited by every target: app, app tests, UI tests, all of which link the same four
    # products) rather than only on the app target, and scoped to the simulator SDK only — the
    # device path (iphoneos) was never affected and still builds every real-device arch.
    "EXCLUDED_ARCHS[sdk=iphonesimulator*]": "x86_64",
    # `xcodebuild test` (never plain `build` — that path doesn't build this at all, which is why
    # `scripts/check.sh`'s own build step never hit this) links a separate "debug dylib" for fast
    # relaunch-without-reinstall. That link step failed with undefined symbols from supabase-swift's
    # internal `Helpers` module (PostgrestError, ObservationToken, AnyJSON.decoder) even though the
    # same symbols link fine into the app's own main binary in the same build — verified by running
    # an actual `xcodebuild test`, not assumed: `EXCLUDED_ARCHS`/`ONLY_ACTIVE_ARCH` don't touch this,
    # it is a different link phase. Turning the debug-dylib optimization off makes `test` link the
    # ordinary way, matching plain `build`.
    "ENABLE_DEBUG_DYLIB": "NO",
    # supabase-swift's `Helpers` target (PostgrestError, ObservationToken, AnyJSON, ...) is an
    # internal dependency of Auth/PostgREST/Storage/Realtime, never one of the package's own
    # declared library products (only Auth/Functions/PostgREST/Realtime/Storage/Supabase are, per
    # its Package.swift) — so unlike those four, it cannot be added as a `packageProductDependencies`
    # entry. Xcode still builds it as its own `PackageFrameworks/Helpers.framework` (each package
    # target gets its own framework under Xcode's SPM integration), and the app binary's own final
    # link needs its symbols resolved directly, not merely by the four products that import it —
    # verified with an actual `xcodebuild test` full app-binary link, which surfaced this even though
    # `scripts/check.sh`'s own generic-destination `build` action does not exercise the same link
    # step. `FRAMEWORK_SEARCH_PATHS` already includes `PackageFrameworks` (Xcode adds it once any
    # package product is linked), so this only needs to ask the linker to actually use it.
    "OTHER_LDFLAGS": "$(inherited) -framework Helpers",
}
project_configs = configs("project", common, signing_config)
app_config = configs(
    "app",
    {
        "PRODUCT_BUNDLE_IDENTIFIER": "com.christian.praelude.ios",
        "PRODUCT_NAME": "Praelude",
        "INFOPLIST_FILE": "Praelude/Info.plist",
        "GENERATE_INFOPLIST_FILE": "NO",
        "MARKETING_VERSION": "2.0.0",
        "CURRENT_PROJECT_VERSION": "10",
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
        "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "SUPPORTS_MACCATALYST": "NO",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
    },
)
app_target = obj(
    "appTarget",
    'isa = PBXNativeTarget; name = Praelude; productName = Praelude; productType = "com.apple.product-type.application"; productReference = '
    + app_product
    + "; buildConfigurationList = "
    + app_config
    + "; buildPhases = "
    + array(app_phases)
    + "; buildRules = (); dependencies = (); packageProductDependencies = "
    + array(list(supabase_products.values()))
    + ";",
)
proxy = obj(
    "proxy",
    "isa = PBXContainerItemProxy; containerPortal = "
    + ident("project")
    + "; proxyType = 1; remoteGlobalIDString = "
    + app_target
    + "; remoteInfo = Praelude;",
)
dep = obj(
    "dependency",
    "isa = PBXTargetDependency; target = "
    + app_target
    + "; targetProxy = "
    + proxy
    + ";",
)
test_config = configs(
    "uitest",
    {
        "PRODUCT_BUNDLE_IDENTIFIER": "com.christian.praelude.ios.uitests",
        "PRODUCT_NAME": "PraeludeUITests",
        "GENERATE_INFOPLIST_FILE": "YES",
        "TEST_TARGET_NAME": "Praelude",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @loader_path/Frameworks",
    },
)
test_target = obj(
    "testTarget",
    'isa = PBXNativeTarget; name = PraeludeUITests; productName = PraeludeUITests; productType = "com.apple.product-type.bundle.ui-testing"; productReference = '
    + test_product
    + "; buildConfigurationList = "
    + test_config
    + "; buildPhases = "
    + array(test_phases)
    + "; buildRules = (); dependencies = "
    + array([dep])
    + ";",
)
unit_phases = [
    phase("unitSources", "PBXSourcesBuildPhase", unit_sources),
    phase("unitFrameworks", "PBXFrameworksBuildPhase", package_build_files("unitTest")),
    phase("unitResources", "PBXResourcesBuildPhase", []),
]
unit_config = configs(
    "appTests",
    {
        "PRODUCT_BUNDLE_IDENTIFIER": "com.christian.praelude.ios.apptests",
        "PRODUCT_NAME": "PraeludeAppTests",
        "GENERATE_INFOPLIST_FILE": "YES",
        "TEST_HOST": "$(BUILT_PRODUCTS_DIR)/Praelude.app/Praelude",
        "BUNDLE_LOADER": "$(TEST_HOST)",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @loader_path/Frameworks",
    },
)
unit_target = obj(
    "unitTarget",
    'isa = PBXNativeTarget; name = PraeludeAppTests; productName = PraeludeAppTests; productType = "com.apple.product-type.bundle.unit-test"; productReference = '
    + unit_product
    + "; buildConfigurationList = "
    + unit_config
    + "; buildPhases = "
    + array(unit_phases)
    + "; buildRules = (); dependencies = "
    + array([dep])
    + "; packageProductDependencies = "
    + array(list(supabase_products.values()))
    + ";",
)
project = obj(
    "project",
    "isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 2660; TargetAttributes = {"
    + app_target
    + " = {CreatedOnToolsVersion = 26.6;}; "
    + test_target
    + " = {CreatedOnToolsVersion = 26.6; TestTargetID = "
    + app_target
    + ";};};}; buildConfigurationList = "
    + project_configs
    + '; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = '
    + main
    + "; productRefGroup = "
    + products
    + '; projectDirPath = ""; projectRoot = ""; targets = '
    + array([app_target, test_target, unit_target])
    + "; packageReferences = "
    + array([supabase_package])
    + ";",
)
project_dir = root / "Praelude.xcodeproj"
project_dir.mkdir(exist_ok=True)
(project_dir / "project.pbxproj").write_text(
    "// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n"
    + "\n".join(k + " = {" + v + "};" for k, v in objects.items())
    + "\n}; rootObject = "
    + project
    + "; }\n"
)
schemes = project_dir / "xcshareddata/xcschemes"
schemes.mkdir(parents=True, exist_ok=True)


def ref(t, name):
    return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{t}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:Praelude.xcodeproj"/>'


(schemes / "Praelude.xcscheme").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2660" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref(app_target,'Praelude.app')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{ref(test_target,'PraeludeUITests.xctest')}</TestableReference><TestableReference skipped="NO">{ref(unit_target,'PraeludeAppTests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref(app_target,'Praelude.app')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref(app_target,'Praelude.app')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>""")
print(
    f"Generated {project_dir} with {len(app_sources)} app and {len(test_sources)} UI test sources"
)
