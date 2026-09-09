# Evaluated by @bacons/apple-targets inside `target 'widget' do ... end` (see
# with-pod-target-extension.js). Links only the dependency-free
# TodaySpendActivityKit pod -- NOT FinancetrackerNative, which depends on
# ExpoModulesCore -> React-Core. React Native cannot run inside an App
# Extension (e.g. RN's Fabric ScrollView calls UIApplication.sharedApplication,
# which is unavailable there), so the extension must never link anything that
# pulls RN in. TodaySpendActivityKit exists specifically so both this
# extension and the main app (via FinancetrackerNative's own dependency on it)
# share the identical compiled TodaySpendAttributes type without the
# extension ever touching React Native.
#
# :path is resolved relative to the generated Podfile (mobile/ios/Podfile),
# NOT relative to this file's own location on disk -- this whole block is
# eval'd directly into that Podfile.
pod 'TodaySpendActivityKit', :path => '../modules/today-spend-activity/ios'
