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
  adminOnly?: boolean;
}

const WALLET_ROWS: Row[] = [
  { key: "Currencies", label: "Currencies", icon: "💱" },
  { key: "Categories", label: "Categories", icon: "🏷️" },
  { key: "Templates", label: "Templates", icon: "📄" },
  { key: "Labels", label: "Labels", icon: "📌" },
  { key: "AutoRules", label: "Automatic Rules", icon: "⚙️" },
  { key: "NotificationRules", label: "Notification Rules", icon: "🔔" },
];

const GENERAL_ROWS: Row[] = [
  { key: "Profile", label: "Profile & Preferences", icon: "👤" },
  { key: "Banks", label: "Accounts", icon: "🏦" },
  { key: "AI", label: "AI", icon: "✨" },
  { key: "ApiTokens", label: "REST API", icon: "🔑" },
  { key: "Users", label: "Users", icon: "👥", adminOnly: true },
  { key: "ExternalAccounts", label: "External Accounts", icon: "📧" },
  { key: "Backup", label: "Backup", icon: "☁️" },
  { key: "Mcp", label: "MCP Server", icon: "🖥️" },
  { key: "Logs", label: "Application Logs", icon: "📋", adminOnly: true },
  { key: "Billing", label: "Billing", icon: "💳" },
  { key: "Privacy", label: "Personal data & privacy", icon: "🔒" },
  { key: "Help", label: "Help", icon: "❓" },
  { key: "About", label: "About", icon: "ℹ️" },
];

export default function SettingsHubScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const renderSection = (title: string, rows: Row[]) => {
    const visible = rows.filter((r) => !r.adminOnly || isAdmin);
    if (visible.length === 0) return null;
    return (
      <React.Fragment key={title}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.list}>
          {visible.map((row) => (
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
      </React.Fragment>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.greeting}>{user?.full_name || user?.username}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      {renderSection("Wallet", WALLET_ROWS)}
      {renderSection("General", GENERAL_ROWS)}

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
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#888", textTransform: "uppercase", marginBottom: 8, marginTop: 16 },
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
