module.exports = (config) => ({
  type: "widget",
  name: "FinanceTrackerWidget",
  displayName: "Finance Tracker",
  deploymentTarget: "16.1",
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
