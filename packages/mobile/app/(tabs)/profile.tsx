import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Switch,
  StyleSheet,
  Clipboard,
  Alert,
  ActivityIndicator,
} from "react-native";
import Constants from "expo-constants";
import { trpc } from "@template/hooks";
import { useAuth } from "../../src/contexts/AuthContext";
import { registerForPushNotifications } from "../../src/lib/notifications";

const API_BASE =
  Constants.expoConfig?.extra?.apiUrl?.replace(/\/trpc$/, "") ??
  "https://TEMPLATE_DOMAIN/api";

export default function ProfileScreen() {
  const { isAuthenticated, isLoading, user, login, logout } = useAuth();
  const [pushOptOut, setPushOptOut] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const [pushRegError, setPushRegError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<"checking" | "up" | "down">("checking");

  const checkServer = useCallback(async () => {
    setServerStatus("checking");
    try {
      const res = await fetch(`${API_BASE}/health`, { method: "GET" });
      setServerStatus(res.ok ? "up" : "down");
    } catch {
      setServerStatus("down");
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      checkServer();
    }
  }, [isAuthenticated, checkServer]);

  const usersQuery = trpc.user.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const updateOptOut = trpc.notification.updatePushOptOut.useMutation({
    onSuccess: (data) => setPushOptOut(data.pushOptOut),
  });
  const registerTokenMutation = trpc.notification.registerPushToken.useMutation();

  useEffect(() => {
    if (usersQuery.data && user?.email) {
      const me = usersQuery.data.find((u) => u.email === user.email);
      if (me) setPushOptOut(me.pushOptOut);
    }
  }, [usersQuery.data, user?.email]);

  const registerTokenWithApi = useCallback(async (token: string) => {
    setPushRegError(null);
    try {
      await registerTokenMutation.mutateAsync({ token });
      setPushRegistered(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPushRegError(msg);
      setPushRegistered(false);
    }
  }, [registerTokenMutation]);

  useEffect(() => {
    if (!isAuthenticated) return;
    registerForPushNotifications()
      .then((token) => {
        setPushToken(token);
        if (!token) {
          setPushError("Token returned null (check permissions & project ID)");
        } else {
          registerTokenWithApi(token);
        }
      })
      .catch((err) => setPushError(String(err)));
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>Loading...</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.subtitle}>Log in to access your profile</Text>
        {serverStatus === "checking" && (
          <ActivityIndicator style={{ marginBottom: 16 }} />
        )}
        {serverStatus === "down" && (
          <View style={styles.serverDown}>
            <Text style={styles.serverDownText}>
              Server is not reachable. Make sure the API is deployed and try again.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={checkServer}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity
          style={[styles.button, serverStatus !== "up" && styles.buttonDisabled]}
          onPress={login}
          disabled={serverStatus !== "up"}
        >
          <Text style={styles.buttonText}>Log In</Text>
        </TouchableOpacity>
        <Text style={styles.serverHint}>
          {serverStatus === "up" ? "Server connected" : ""}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {user?.picture && (
        <Image source={{ uri: user.picture }} style={styles.avatar} />
      )}
      <Text style={styles.name}>{user?.name}</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Push Notifications</Text>
        <Switch
          value={!pushOptOut}
          onValueChange={(enabled) => {
            updateOptOut.mutate({ optOut: !enabled });
          }}
          disabled={updateOptOut.isPending}
        />
      </View>
      <TouchableOpacity
        style={styles.tokenRow}
        onPress={() => {
          if (pushToken) {
            Clipboard.setString(pushToken);
            Alert.alert("Copied", "Push token copied to clipboard");
          }
        }}
      >
        <Text style={styles.tokenLabel}>Push Token</Text>
        <Text style={[styles.tokenValue, !pushToken && pushError && styles.tokenError]}>
          {pushToken
            ? `${pushToken.slice(0, 25)}...`
            : pushError ?? "Loading..."}
        </Text>
        {pushToken && pushRegistered === true && (
          <Text style={styles.regSuccess}>Registered with server</Text>
        )}
        {pushToken && pushRegistered === false && (
          <View>
            <Text style={styles.regError}>Registration failed: {pushRegError}</Text>
            <TouchableOpacity
              style={styles.regRetry}
              onPress={() => registerTokenWithApi(pushToken)}
            >
              <Text style={styles.regRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {pushToken && pushRegistered === null && (
          <Text style={styles.regPending}>Registering...</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loading: { color: "#888" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 8 },
  subtitle: { color: "#666", marginBottom: 24 },
  button: {
    backgroundColor: "#4f46e5",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  avatar: { width: 96, height: 96, borderRadius: 48, marginBottom: 16 },
  name: { fontSize: 22, fontWeight: "bold", marginBottom: 4 },
  email: { color: "#666", marginBottom: 16 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
  },
  settingLabel: { fontSize: 16, fontWeight: "500" },
  logoutButton: {
    borderWidth: 1,
    borderColor: "#ddd",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  logoutText: { color: "#555", fontWeight: "500" },
  serverDown: {
    backgroundColor: "#fef2f2",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: "center",
    width: "100%",
  },
  serverDownText: { color: "#dc2626", textAlign: "center", marginBottom: 8 },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dc2626",
  },
  retryText: { color: "#dc2626", fontWeight: "500" },
  buttonDisabled: { opacity: 0.4 },
  serverHint: { color: "#22c55e", fontSize: 12, marginTop: 8 },
  tokenRow: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
  },
  tokenLabel: { fontSize: 14, fontWeight: "500", marginBottom: 4 },
  tokenValue: { fontSize: 11, color: "#888", fontFamily: "Courier" },
  tokenError: { color: "#dc2626" },
  regSuccess: { fontSize: 11, color: "#22c55e", marginTop: 4 },
  regError: { fontSize: 11, color: "#dc2626", marginTop: 4 },
  regPending: { fontSize: 11, color: "#888", marginTop: 4 },
  regRetry: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#dc2626",
    alignSelf: "flex-start",
  },
  regRetryText: { color: "#dc2626", fontSize: 11, fontWeight: "500" },
});
