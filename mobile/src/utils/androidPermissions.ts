import { PermissionsAndroid, Platform } from "react-native";

// Manifest declarations (added by plugins/withSmsReceiver.js) are necessary but not
// sufficient on Android 6+ -- these "dangerous" permissions also need a runtime request,
// which only makes sense once there's a user present to grant them (i.e. after login),
// not at cold-start before anyone's signed in.
export async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;

  const permissions = [
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  ];
  // POST_NOTIFICATIONS only exists as a runtime permission from Android 13 (API 33) --
  // the constant itself isn't present in PermissionsAndroid.PERMISSIONS on all RN versions,
  // so reference it as a plain string rather than risk an undefined lookup.
  const NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS" as const;

  try {
    await PermissionsAndroid.requestMultiple([...permissions, NOTIFICATIONS] as any);
  } catch {
    // Permission requests failing/being denied is a normal user choice, not an error to
    // surface -- SMS auto-detection simply won't fire for anyone who declines.
  }
}
