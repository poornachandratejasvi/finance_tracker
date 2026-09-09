// Deliberately NOT setting `name` here -- @bacons/apple-targets uses it (if
// present) as the actual Xcode/Podfile target identifier (productName),
// which must match this folder's name ("widget") for targets/widget/pods.rb's
// dynamic target-loader to find the right `target 'widget' do` block to
// inject into (see with-pod-target-extension.js -- it derives the target
// name purely from the folder name, not from any config field). `displayName`
// is separate and safe to customize -- that's just the widget gallery label.
module.exports = (config) => ({
  type: "widget",
  displayName: "Finance Tracker",
  // Must match (or exceed) the app-wide deploymentTarget set by
  // expo-build-properties in app.json, and TodaySpendActivityKit's own
  // platform floor (mobile/modules/today-spend-activity/ios/*.podspec) --
  // CocoaPods compiles that pod at the app's global deployment target (16.4)
  // regardless of its own podspec's lower floor, so a widget extension built
  // at anything lower fails with "compiling for iOS 16.1, but module
  // 'TodaySpendActivityKit' has a minimum deployment target of iOS 16.4".
  deploymentTarget: "16.4",
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
