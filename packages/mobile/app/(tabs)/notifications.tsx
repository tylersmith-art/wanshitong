import { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import { useNotifications } from "@template/hooks";
import { useAuth } from "../../src/contexts/AuthContext";

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(dateString).toLocaleDateString();
}

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
};

export default function NotificationsScreen() {
  const { isAuthenticated } = useAuth();
  const {
    notifications,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    unreadCount,
    markRead,
    markUnread,
    markAllRead,
  } = useNotifications();

  const handlePress = useCallback((item: NotificationItem) => {
    if (item.actionUrl) {
      router.push(item.actionUrl as never);
    }
  }, []);

  const handleLongPress = useCallback(
    (item: NotificationItem) => {
      if (item.read) {
        markUnread({ id: item.id });
      } else {
        markRead({ id: item.id });
      }
    },
    [markRead, markUnread],
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <TouchableOpacity
        style={[
          styles.item,
          { borderLeftColor: item.read ? "transparent" : "#4f46e5" },
        ]}
        onPress={() => handlePress(item)}
        onLongPress={() => handleLongPress(item)}
      >
        <Text
          style={[
            styles.itemTitle,
            { fontWeight: item.read ? "400" : "700" },
          ]}
        >
          {item.title}
        </Text>
        <Text style={styles.itemBody} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.itemTime}>{formatRelativeTime(item.createdAt)}</Text>
      </TouchableOpacity>
    ),
    [handlePress, handleLongPress],
  );

  if (!isAuthenticated) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Log in to see your notifications.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {unreadCount > 0 && (
        <TouchableOpacity style={styles.markAllButton} onPress={() => markAllRead()}>
          <Text style={styles.markAllText}>Mark all as read</Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {isLoading ? (
        <Text style={styles.loading}>Loading...</Text>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={() => {
            if (hasNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No notifications yet.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  markAllButton: {
    alignSelf: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  markAllText: { color: "#4f46e5", fontWeight: "600", fontSize: 14 },
  error: {
    color: "#dc2626",
    backgroundColor: "#fef2f2",
    padding: 12,
    borderRadius: 4,
    marginBottom: 12,
  },
  loading: { textAlign: "center", color: "#888", padding: 32 },
  emptyText: { textAlign: "center", color: "#888" },
  item: {
    padding: 12,
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemTitle: { fontSize: 15, marginBottom: 2 },
  itemBody: { color: "#666", fontSize: 14, marginBottom: 4 },
  itemTime: { color: "#999", fontSize: 12 },
});
