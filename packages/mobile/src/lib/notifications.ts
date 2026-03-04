import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("Push notification permissions not granted");
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn("Project ID not found in expo config");
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    return tokenData.data;
  } catch (error) {
    console.error("Failed to register for push notifications:", error);
    return null;
  }
}

export function addNotificationListeners(
  onNotificationTap?: (actionUrl: string) => void,
) {
  const notificationListener =
    Notifications.addNotificationReceivedListener((notification) => {
      console.log("Notification received:", notification);
    });

  const responseListener =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const actionUrl = response.notification.request.content.data?.actionUrl;
      if (actionUrl && onNotificationTap) {
        onNotificationTap(actionUrl as string);
      }
    });

  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
}
