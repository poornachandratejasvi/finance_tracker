import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../context/AuthContext";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "SettingsHub">;

interface Row {
  key: keyof SettingsStackParamList;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  adminOnly?: boolean;
}

const WALLET_ROWS: Row[] = [
  { key: "Currencies", label: "Currencies", icon: "swap-horizontal-outline" },
  { key: "Categories", label: "Categories", icon: "pricetags-outline" },
  { key: "Templates", label: "Templates", icon: "document-text-outline" },
  { key: "Labels", label: "Labels", icon: "bookmark-outline" },
  { key: "AutoRules", label: "Automatic Rules", icon: "flash-outline" },
  { key: "NotificationRules", label: "Notification Rules", icon: "notifications-outline" },
];

const TOOLS_ROWS: Row[] = [
  { key: "Budgets", label: "Budgets", icon: "wallet-outline" },
  { key: "Goals", label: "Goals", icon: "flag-outline" },
  { key: "Vehicles", label: "Vehicles", icon: "car-outline" },
  { key: "DebtPayoff", label: "Debt Payoff", icon: "trending-down-outline" },
  { key: "Jobs", label: "Jobs", icon: "sync-outline" },
  { key: "Automation", label: "Automation", icon: "hardware-chip-outline" },
  { key: "AskAi", label: "Ask AI", icon: "chatbubble-ellipses-outline" },
  { key: "RecycleBin", label: "Recycle Bin", icon: "trash-outline" },
];

const GENERAL_ROWS: Row[] = [
  { key: "Profile", label: "Profile & Preferences", icon: "person-outline" },
  { key: "AI", label: "AI", icon: "sparkles-outline" },
  { key: "ApiTokens", label: "REST API", icon: "key-outline" },
  { key: "SmsAutoDetect", label: "SMS Auto-Detect", icon: "phone-portrait-outline" },
  { key: "SmsImport", label: "Import from SMS", icon: "download-outline" },
  { key: "Users", label: "Users", icon: "people-outline", adminOnly: true },
  { key: "ExternalAccounts", label: "External Accounts", icon: "mail-outline" },
  { key: "Backup", label: "Backup", icon: "cloud-outline" },
  { key: "Mcp", label: "MCP Server", icon: "desktop-outline" },
  { key: "Logs", label: "Application Logs", icon: "list-outline", adminOnly: true },
  { key: "Billing", label: "Billing", icon: "card-outline" },
  { key: "Privacy", label: "Personal data & privacy", icon: "shield-checkmark-outline" },
  { key: "Help", label: "Help", icon: "help-circle-outline" },
  { key: "About", label: "About", icon: "information-circle-outline" },
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
              <View style={styles.icon}>
                <Ionicons name={row.icon} size={19} color={colors.primary} />
              </View>
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
    icon: { width: 30, alignItems: "flex-start", justifyContent: "center" },
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
