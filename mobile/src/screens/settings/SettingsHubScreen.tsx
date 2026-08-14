import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useAuth } from "../../context/AuthContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "SettingsHub">;

interface Row {
  key: keyof SettingsStackParamList;
  label: string;
  icon: string;
}

const ROWS: Row[] = [
  { key: "Profile", label: "Profile & Preferences", icon: "👤" },
  { key: "Banks", label: "Accounts", icon: "🏦" },
  { key: "Categories", label: "Categories", icon: "🏷️" },
  { key: "Labels", label: "Labels", icon: "📌" },
  { key: "AutoRules", label: "Automatic Rules", icon: "⚙️" },
  { key: "NotificationRules", label: "Notification Rules", icon: "🔔" },
  { key: "AI", label: "AI", icon: "✨" },
];

export default function SettingsHubScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.greeting}>{user?.full_name || user?.username}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={styles.list}>
        {ROWS.map((row) => (
          <TouchableOpacity
            key={row.key}
            style={styles.row}
            onPress={() => navigation.navigate(row.key as any)}
          >
            <Text style={styles.icon}>{row.icon}</Text>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  greeting: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  email: { fontSize: 13, color: "#666", marginBottom: 20 },
  list: {
    backgroundColor: "#f7f7f7",
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  icon: { fontSize: 18, width: 30 },
  label: { flex: 1, fontSize: 15, color: "#222" },
  chevron: { fontSize: 20, color: "#999" },
  logoutButton: {
    marginTop: 28,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#f7f7f7",
    borderRadius: 8,
  },
  logoutText: { color: "#b3261e", fontWeight: "600", fontSize: 15 },
});
