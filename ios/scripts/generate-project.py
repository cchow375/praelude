#!/usr/bin/env python3
"""Generate the dependency-free native Xcode project; never touches user data."""
from pathlib import Path
import hashlib
import json
root = Path(__file__).resolve().parents[1]
objects = {}
def ident(value): return hashlib.sha1(value.encode()).hexdigest()[:24].upper()
def obj(key, body):
    value = ident(key)
    objects[value] = body
    return value
def q(value): return json.dumps(str(value))
def array(values): return '(' + ', '.join(values) + (',)' if values else ')')
def configs(prefix, settings, base_config=None):
    ids = []
    for mode in ('Debug', 'Release'):
        options = dict(settings)
        options.update({'ENABLE_TESTABILITY': 'YES' if mode == 'Debug' else 'NO', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if mode == 'Debug' else '-O', 'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG' if mode == 'Debug' else '', 'DEBUG_INFORMATION_FORMAT': 'dwarf' if mode == 'Debug' else 'dwarf-with-dsym'})
        base = 'baseConfigurationReference = '+base_config+'; ' if base_config else ''
        ids.append(obj(prefix+mode, 'isa = XCBuildConfiguration; name = '+mode+'; '+base+'buildSettings = {'+' '.join(k+' = '+q(v)+';' for k,v in options.items())+'};'))
    return obj(prefix+'configs', 'isa = XCConfigurationList; buildConfigurations = '+array(ids)+'; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
app_files=[]; app_sources=[]; resources=[]
for path in sorted((root/'Praelude').rglob('*.swift')):
    rel=path.relative_to(root).as_posix()
    f=obj(rel, 'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = '+q(rel)+'; sourceTree = SOURCE_ROOT;')
    app_files.append(f); app_sources.append(obj(rel+'build', 'isa = PBXBuildFile; fileRef = '+f+';'))
for path in ('Praelude/Resources/Assets.xcassets','Praelude/PrivacyInfo.xcprivacy'):
    kind = 'folder.assetcatalog' if path.endswith('xcassets') else 'text.xml'
    f=obj(path, 'isa = PBXFileReference; lastKnownFileType = '+kind+'; path = '+q(path)+'; sourceTree = SOURCE_ROOT;')
    app_files.append(f); resources.append(obj(path+'build', 'isa = PBXBuildFile; fileRef = '+f+';'))
test_files=[]; test_sources=[]
for path in sorted((root/'PraeludeUITests').glob('*.swift')):
    rel=path.relative_to(root).as_posix()
    f=obj(rel, 'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = '+q(rel)+'; sourceTree = SOURCE_ROOT;')
    test_files.append(f); test_sources.append(obj(rel+'build', 'isa = PBXBuildFile; fileRef = '+f+';'))
unit_files=[]; unit_sources=[]
for path in sorted((root/'PraeludeAppTests').glob('*.swift')):
    rel=path.relative_to(root).as_posix()
    f=obj(rel, 'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = '+q(rel)+'; sourceTree = SOURCE_ROOT;')
    unit_files.append(f); unit_sources.append(obj(rel+'build', 'isa = PBXBuildFile; fileRef = '+f+';'))
unit_product=obj('unitProduct', 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = PraeludeAppTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
unit_group=obj('unitGroup','isa = PBXGroup; name = PraeludeAppTests; children = '+array(unit_files)+'; sourceTree = "<group>";')
app_product=obj('appProduct', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = Praelude.app; sourceTree = BUILT_PRODUCTS_DIR;')
test_product=obj('testProduct', 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = PraeludeUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
products=obj('products', 'isa = PBXGroup; name = Products; children = '+array([app_product,test_product,unit_product])+'; sourceTree = "<group>";')
app_group=obj('appGroup','isa = PBXGroup; name = Praelude; children = '+array(app_files)+'; sourceTree = "<group>";')
test_group=obj('testGroup','isa = PBXGroup; name = PraeludeUITests; children = '+array(test_files)+'; sourceTree = "<group>";')
signing_config=obj('Signing.xcconfig', 'isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = "Signing.xcconfig"; sourceTree = SOURCE_ROOT;')
main=obj('main','isa = PBXGroup; children = '+array([signing_config,app_group,test_group,unit_group,products])+'; sourceTree = "<group>";')
def phase(key, isa, files): return obj(key, 'isa = '+isa+'; buildActionMask = 2147483647; files = '+array(files)+'; runOnlyForDeploymentPostprocessing = 0;')
app_phases=[phase('sources','PBXSourcesBuildPhase',app_sources),phase('frameworks','PBXFrameworksBuildPhase',[]),phase('resources','PBXResourcesBuildPhase',resources)]
test_phases=[phase('testSources','PBXSourcesBuildPhase',test_sources),phase('testFrameworks','PBXFrameworksBuildPhase',[]),phase('testResources','PBXResourcesBuildPhase',[])]
common={'IPHONEOS_DEPLOYMENT_TARGET':'17.0','SDKROOT':'iphoneos','SWIFT_VERSION':'6.0','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGN_STYLE':'Automatic','CLANG_ENABLE_MODULES':'YES','SWIFT_STRICT_CONCURRENCY':'complete','ENABLE_USER_SCRIPT_SANDBOXING':'YES'}
project_configs=configs('project',common,signing_config)
app_config=configs('app',{'PRODUCT_BUNDLE_IDENTIFIER':'com.christian.praelude.ios','PRODUCT_NAME':'Praelude','INFOPLIST_FILE':'Praelude/Info.plist','GENERATE_INFOPLIST_FILE':'NO','MARKETING_VERSION':'1.1.0','CURRENT_PROJECT_VERSION':'2','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME':'AccentColor','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SUPPORTS_MACCATALYST':'NO','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks'})
app_target=obj('appTarget','isa = PBXNativeTarget; name = Praelude; productName = Praelude; productType = "com.apple.product-type.application"; productReference = '+app_product+'; buildConfigurationList = '+app_config+'; buildPhases = '+array(app_phases)+'; buildRules = (); dependencies = ();')
proxy=obj('proxy','isa = PBXContainerItemProxy; containerPortal = '+ident('project')+'; proxyType = 1; remoteGlobalIDString = '+app_target+'; remoteInfo = Praelude;')
dep=obj('dependency','isa = PBXTargetDependency; target = '+app_target+'; targetProxy = '+proxy+';')
test_config=configs('uitest',{'PRODUCT_BUNDLE_IDENTIFIER':'com.christian.praelude.ios.uitests','PRODUCT_NAME':'PraeludeUITests','GENERATE_INFOPLIST_FILE':'YES','TEST_TARGET_NAME':'Praelude','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks @loader_path/Frameworks'})
test_target=obj('testTarget','isa = PBXNativeTarget; name = PraeludeUITests; productName = PraeludeUITests; productType = "com.apple.product-type.bundle.ui-testing"; productReference = '+test_product+'; buildConfigurationList = '+test_config+'; buildPhases = '+array(test_phases)+'; buildRules = (); dependencies = '+array([dep])+';')
unit_phases=[phase('unitSources','PBXSourcesBuildPhase',unit_sources),phase('unitFrameworks','PBXFrameworksBuildPhase',[]),phase('unitResources','PBXResourcesBuildPhase',[])]
unit_config=configs('appTests',{'PRODUCT_BUNDLE_IDENTIFIER':'com.christian.praelude.ios.apptests','PRODUCT_NAME':'PraeludeAppTests','GENERATE_INFOPLIST_FILE':'YES','TEST_HOST':'$(BUILT_PRODUCTS_DIR)/Praelude.app/Praelude','BUNDLE_LOADER':'$(TEST_HOST)','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks @loader_path/Frameworks'})
unit_target=obj('unitTarget','isa = PBXNativeTarget; name = PraeludeAppTests; productName = PraeludeAppTests; productType = "com.apple.product-type.bundle.unit-test"; productReference = '+unit_product+'; buildConfigurationList = '+unit_config+'; buildPhases = '+array(unit_phases)+'; buildRules = (); dependencies = '+array([dep])+';')
project=obj('project','isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 2660; TargetAttributes = {'+app_target+' = {CreatedOnToolsVersion = 26.6;}; '+test_target+' = {CreatedOnToolsVersion = 26.6; TestTargetID = '+app_target+';};};}; buildConfigurationList = '+project_configs+'; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = '+main+'; productRefGroup = '+products+'; projectDirPath = ""; projectRoot = ""; targets = '+array([app_target,test_target,unit_target])+';')
project_dir=root/'Praelude.xcodeproj'; project_dir.mkdir(exist_ok=True)
(project_dir/'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(k+' = {'+v+'};' for k,v in objects.items())+'\n}; rootObject = '+project+'; }\n')
schemes=project_dir/'xcshareddata/xcschemes'; schemes.mkdir(parents=True,exist_ok=True)
def ref(t,name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{t}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:Praelude.xcodeproj"/>'
(schemes/'Praelude.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2660" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref(app_target,'Praelude.app')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{ref(test_target,'PraeludeUITests.xctest')}</TestableReference><TestableReference skipped="NO">{ref(unit_target,'PraeludeAppTests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref(app_target,'Praelude.app')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref(app_target,'Praelude.app')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print(f'Generated {project_dir} with {len(app_sources)} app and {len(test_sources)} UI test sources')
