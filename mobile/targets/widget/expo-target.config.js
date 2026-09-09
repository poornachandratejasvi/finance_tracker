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
  deploymentTarget: "16.1",
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
