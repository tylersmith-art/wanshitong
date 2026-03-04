import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";
import { useUsers } from "@template/hooks";
import { useAuth } from "../../src/contexts/AuthContext";

export default function UsersScreen() {
  const { isAuthenticated } = useAuth();
  const { users, isLoading, error, createUser, isCreating } = useUsers();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleCreate = async () => {
    if (!name || !email) return;
    await createUser({ name, email });
    setName("");
    setEmail("");
  };

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}

      {isAuthenticated && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name"
          />
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.button}
            onPress={handleCreate}
            disabled={isCreating}
          >
            <Text style={styles.buttonText}>
              {isCreating ? "Creating..." : "Create"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <Text style={styles.loading}>Loading...</Text>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.email}>{item.email}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No users yet.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  error: {
    color: "#dc2626",
    backgroundColor: "#fef2f2",
    padding: 12,
    borderRadius: 4,
    marginBottom: 12,
  },
  form: { marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
    fontSize: 14,
  },
  button: {
    backgroundColor: "#4f46e5",
    padding: 12,
    borderRadius: 4,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  loading: { textAlign: "center", color: "#888", padding: 32 },
  empty: { textAlign: "center", color: "#888", padding: 32 },
  row: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  name: { fontWeight: "600", marginBottom: 2 },
  email: { color: "#666", fontSize: 13 },
});
