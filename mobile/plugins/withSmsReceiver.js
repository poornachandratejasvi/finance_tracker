const { withDangerousMod, withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Files in mobile/android-native/ that need to end up compiled into the app. Unlike iOS,
// Gradle auto-compiles any .kt file placed under the app's java package directory -- no
// equivalent of Xcode's explicit "add to build phase" step is needed here.
const SOURCE_FILES = ["SmsReceiver.kt", "ApiConfig.kt"];

const SMS_PERMISSIONS = ["android.permission.RECEIVE_SMS", "android.permission.READ_SMS"];
const NOTIFICATION_PERMISSION = "android.permission.POST_NOTIFICATIONS";

function withSmsReceiverFiles(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;
      const packageName = config.android?.package;
      if (!packageName) {
        throw new Error("withSmsReceiver: android.package must be set in app.json");
      }
      const packagePath = packageName.split(".").join("/");
      const targetDir = path.join(
        platformProjectRoot,
        "app/src/main/java",
        packagePath
      );
      const sourceDir = path.join(projectRoot, "android-native");

      for (const file of SOURCE_FILES) {
        const src = path.join(sourceDir, file);
        if (!fs.existsSync(src)) {
          throw new Error(
            `withSmsReceiver: expected ${src} to exist.` +
              (file === "ApiConfig.kt"
                ? " Generate it from android-native/ApiConfig.kt.template (substituting" +
                  " FINANCE_SERVER_URL / FINANCE_API_TOKEN) before running prebuild."
                : "")
          );
        }
        fs.copyFileSync(src, path.join(targetDir, file));
      }

      return config;
    },
  ]);
}

function withSmsReceiverManifest(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    ...SMS_PERMISSIONS,
    NOTIFICATION_PERMISSION,
  ]);

  return withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    mainApplication.receiver = mainApplication.receiver || [];
    const alreadyPresent = mainApplication.receiver.some(
      (r) => r.$?.["android:name"] === ".SmsReceiver"
    );
    if (!alreadyPresent) {
      mainApplication.receiver.push({
        $: {
          "android:name": ".SmsReceiver",
          "android:exported": "true",
          "android:permission": "android.permission.BROADCAST_SMS",
        },
        "intent-filter": [
          {
            action: [
              { $: { "android:name": "android.provider.Telephony.SMS_RECEIVED" } },
            ],
          },
        ],
      });
    }

    return config;
  });
}

module.exports = function withSmsReceiver(config) {
  config = withSmsReceiverFiles(config);
  config = withSmsReceiverManifest(config);
  return config;
};
