import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { Stack, router } from "expo-router";
import Constants from "expo-constants";
import { TRPCProvider, trpc, useNotificationToast, useSessionSync } from "@wanshitong/hooks";
import { AuthProvider, useAuth } from "../src/contexts/AuthContext";
import {
  registerForPushNotifications,
  addNotificationListeners,
} from "../src/lib/notifications";

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ??
  "https://wanshitong.tylermakes.art/api/trpc";

function SessionSync() {
  const { isAuthenticated, user } = useAuth();
  const synced = useSessionSync(isAuthenticated && user ? user : null);
  const pushRegistered = useRef(false);
  const registerToken = trpc.notification.registerPushToken.useMutation();

  useEffect(() => {
    if (!synced || pushRegistered.current) return;

    const registerPush = async () => {
      const token = await registerForPushNotifications();
      if (!token) return; // permissions denied or no project ID — nothing to do
      try {
        await registerToken.mutateAsync({ token });
        pushRegistered.current = true;
      } catch (err) {
        console.error("Failed to register push token:", err);
        // Don't mark as registered — will retry on next mount
      }
    };

    registerPush();
  }, [synced]);

  return null;
}

function NotificationToast() {
  const { data: me } = trpc.user.me.useQuery();

  useNotificationToast(me?.id, (notification) => {
    Alert.alert(
      notification.title,
      notification.body,
      notification.actionUrl
        ? [
            { text: "Dismiss", style: "cancel" },
            { text: "View", onPress: () => router.push(notification.actionUrl!) },
          ]
        : [{ text: "OK" }],
    );
  });

  return null;
}

function AppInner() {
  const { getAccessToken, isAuthenticated } = useAuth();

  useEffect(() => {
    const cleanup = addNotificationListeners((actionUrl) => {
      router.push(actionUrl);
    });
    return cleanup;
  }, []);

  return (
    <TRPCProvider apiUrl={API_URL} getAccessToken={getAccessToken}>
      <SessionSync />
      {isAuthenticated && <NotificationToast />}
      <Stack screenOptions={{ headerShown: true }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </TRPCProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
