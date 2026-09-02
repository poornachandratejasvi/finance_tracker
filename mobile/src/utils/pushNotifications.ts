import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";

import { registerPushToken } from "../api/pushTokens";

// Foreground notifications are suppressed by default (esp. on Android) --
// still show a banner/sound while the app is open, same as a backgrounded one.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Requests notification permission (if not already granted/denied), gets this
// device's Expo push token, and registers it with the backend -- called once
// after login/session-restore, same hook point as requestAndroidPermissions().
// Fails silently: getting a real push token beyond Expo Go requires an EAS
// project (projectId) to be configured, which isn't done yet for this app --
// Discord reminders still work regardless of whether this succeeds.
export async function registerForPushNotificationsAsync(): Promise<void> {
  if (!Device.isDevice) {
    return; // simulators/emulators have no push token to register
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      return; // user declined -- respect it
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await registerPushToken(token, Platform.OS === "ios" ? "ios" : "android");
  } catch (err) {
    console.warn("Push notification registration failed:", err);
  }
}
