# Evaluated by @bacons/apple-targets inside `target 'widget' do ... end` (see
# with-pod-target-extension.js) -- links this extension against the SAME
# FinancetrackerNative pod the main app uses, so TodaySpendAttributes
# (defined there, not as a plain shared source file) is the identical
# compiled type on both sides, which ActivityKit requires.
#
# :path is resolved relative to the generated Podfile (mobile/ios/Podfile),
# NOT relative to this file's own location on disk -- this whole block is
# eval'd directly into that Podfile.
pod 'FinancetrackerNative', :path => '../modules/financetracker-native/ios'
