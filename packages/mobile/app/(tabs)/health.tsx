import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";

// HealthKit is iOS-only; guard imports for Android
let HealthKit: typeof import("@kingstinct/react-native-healthkit").default | null =
  null;
let AuthorizationRequestStatus: typeof import("@kingstinct/react-native-healthkit").AuthorizationRequestStatus | null =
  null;

if (Platform.OS === "ios") {
  const hk = require("@kingstinct/react-native-healthkit");
  HealthKit = hk.default;
  AuthorizationRequestStatus = hk.AuthorizationRequestStatus;
}

export default function HealthScreen() {
  const [authorized, setAuthorized] = useState(false);
  const [steps, setSteps] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS === "ios") {
      checkAuthorization();
    }
  }, []);

  async function checkAuthorization() {
    if (!HealthKit || !AuthorizationRequestStatus) return;

    const isAvailable = HealthKit.isHealthDataAvailable();
    if (!isAvailable) {
      Alert.alert("HealthKit not available on this device");
      return;
    }

    const status = await HealthKit.getRequestStatusForAuthorization({
      toRead: ["HKQuantityTypeIdentifierStepCount"],
    });
    if (status === AuthorizationRequestStatus.unnecessary) {
      setAuthorized(true);
    }
  }

  async function requestAccess() {
    if (!HealthKit) return;

    await HealthKit.requestAuthorization({
      toRead: ["HKQuantityTypeIdentifierStepCount"],
    });
    setAuthorized(true);
    fetchSteps();
  }

  async function fetchSteps() {
    if (!HealthKit) return;

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const result = await HealthKit.queryQuantitySamples(
      "HKQuantityTypeIdentifierStepCount",
      {
        limit: 0,
        filter: {
          date: {
            startDate: startOfDay,
            endDate: now,
          },
        },
        ascending: false,
      }
    );

    const total = result.reduce((sum, sample) => sum + sample.quantity, 0);
    setSteps(Math.round(total));
  }

  useEffect(() => {
    if (authorized) fetchSteps();
  }, [authorized]);

  if (Platform.OS !== "ios") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Health</Text>
        <Text style={styles.subtitle}>
          HealthKit is only available on iOS.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HealthKit</Text>
      {!authorized ? (
        <TouchableOpacity style={styles.button} onPress={requestAccess}>
          <Text style={styles.buttonText}>Grant HealthKit Access</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Steps Today</Text>
          <Text style={styles.value}>
            {steps !== null ? steps.toLocaleString() : "..."}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, alignItems: "center" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 24 },
  subtitle: { fontSize: 16, color: "#666", textAlign: "center" },
  button: { backgroundColor: "#4f46e5", padding: 14, borderRadius: 8 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  card: {
    backgroundColor: "#fff",
    padding: 24,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
  },
  label: { color: "#666", fontSize: 14, marginBottom: 8 },
  value: { fontSize: 48, fontWeight: "bold" },
});
