import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { listUsers } from "../../api/adminUsers";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { AdminUser } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "Users">;

export default function UsersScreen({ navigation }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch {
      // keep prior list; pull-to-refresh can retry
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        data={users}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No users found.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("UserForm", { user: item })}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{item.full_name || item.username}</Text>
              <Text style={styles.meta}>{item.email}</Text>
            </View>
            <Text style={styles.role}>{item.role}</Text>
            {!item.is_active && <Text style={styles.inactive}>disabled</Text>}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("UserForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add User</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, flexGrow: 1 },
  empty: { color: "#888", textAlign: "center", marginTop: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  rowMain: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", color: "#222" },
  meta: { fontSize: 12, color: "#777", marginTop: 2 },
  role: { fontSize: 12, color: "#1b6b4c", fontWeight: "700", marginRight: 8, textTransform: "capitalize" },
  inactive: { fontSize: 11, color: "#b3261e", fontWeight: "700" },
  addButton: {
    margin: 16,
    backgroundColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
