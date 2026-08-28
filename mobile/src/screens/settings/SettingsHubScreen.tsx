import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useAuth } from "../../context/AuthContext";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
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

const TOOLS_ROWS: Row[] = [
  { key: "Budgets", label: "Budgets", icon: "💰" },
  { key: "Goals", label: "Goals", icon: "🎯" },
  { key: "Vehicles", label: "Vehicles", icon: "🚗" },
  { key: "Jobs", label: "Jobs", icon: "🔄" },
  { key: "Automation", label: "Automation", icon: "🤖" },
  { key: "AskAi", label: "Ask AI", icon: "💬" },
];

const GENERAL_ROWS: Row[] = [
  { key: "Profile", label: "Profile & Preferences", icon: "👤" },
  { key: "AI", label: "AI", icon: "✨" },
  { key: "ApiTokens", label: "REST API", icon: "🔑" },
  { key: "SmsAutoDetect", label: "SMS Auto-Detect", icon: "📱" },
  { key: "SmsImport", label: "Import from SMS", icon: "📥" },
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
  const { colors, mode, setMode } = useTheme();
  const styles = makeStyles(colors);
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

      <Text style={styles.sectionTitle}>Appearance</Text>
      <View style={styles.themeRow}>
        {(["system", "light", "dark"] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.themeChip, mode === m && styles.themeChipActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.themeChipText, mode === m && styles.themeChipTextActive]}>
              {m}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {renderSection("Wallet", WALLET_ROWS)}
      {renderSection("Tools", TOOLS_ROWS)}
      {renderSection("General", GENERAL_ROWS)}

      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    greeting: { fontSize: 20, fontWeight: "700", marginTop: 8, color: c.text },
    email: { fontSize: 13, color: c.textSecondary, marginBottom: 20 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: c.textSecondary,
      textTransform: "uppercase",
      marginBottom: 8,
      marginTop: 16,
    },
    themeRow: { flexDirection: "row", gap: 8 },
    themeChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: "center",
      backgroundColor: c.chipBg,
    },
    themeChipActive: { backgroundColor: c.primary },
    themeChipText: { color: c.text, fontSize: 13, textTransform: "capitalize" },
    themeChipTextActive: { color: "#fff", fontWeight: "600" },
    list: {
      backgroundColor: c.card,
      borderRadius: 12,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    icon: { fontSize: 18, width: 30 },
    label: { flex: 1, fontSize: 15, color: c.text },
    chevron: { fontSize: 20, color: c.textSecondary },
    logoutButton: {
      marginTop: 28,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: c.card,
      borderRadius: 8,
    },
    logoutText: { color: c.danger, fontWeight: "600", fontSize: 15 },
  });
