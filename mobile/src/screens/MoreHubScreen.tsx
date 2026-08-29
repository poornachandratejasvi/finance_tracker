import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../context/AuthContext";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { TabParamList } from "../navigation/RootNavigator";

type Nav = BottomTabNavigationProp<TabParamList>;

interface Tile {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  go: (nav: Nav) => void;
  adminOnly?: boolean;
}

// A colorful 2-column tile grid -- matches the reference app's "More" screen,
// which is where it puts everything not pinned to a main tab. This app has
// far more features than the reference, so rather than flattening all ~35
// settings/banks screens into one huge grid, the highest-traffic ones get a
// direct tile and everything else is one tap away via the "Accounts &
// Statements" and "All Settings" catch-all tiles (which land on the existing,
// still-fully-functional BanksHub/SettingsHub list screens).
const TILES: Tile[] = [
  { key: "records", label: "Records", icon: "list-outline", color: "#2e7d32", go: (n) => n.navigate("Transactions") },
  { key: "investments", label: "Investments", icon: "trending-up-outline", color: "#6a1b9a", go: (n) => n.navigate("Banks", { screen: "Investments" }) },
  { key: "budgets", label: "Budgets", icon: "wallet-outline", color: "#ef6c00", go: (n) => n.navigate("Settings", { screen: "Budgets" }) },
  { key: "goals", label: "Goals", icon: "flag-outline", color: "#c2185b", go: (n) => n.navigate("Settings", { screen: "Goals" }) },
  { key: "reward-points", label: "Reward Points", icon: "gift-outline", color: "#f9a825", go: (n) => n.navigate("Banks", { screen: "RewardPoints" }) },
  { key: "vehicles", label: "Vehicles", icon: "car-outline", color: "#1565c0", go: (n) => n.navigate("Settings", { screen: "Vehicles" }) },
  { key: "debt-payoff", label: "Debt Payoff", icon: "trending-down-outline", color: "#c62828", go: (n) => n.navigate("Settings", { screen: "DebtPayoff" }) },
  { key: "automatic-rules", label: "Automatic Rules", icon: "flash-outline", color: "#4527a0", go: (n) => n.navigate("Settings", { screen: "AutoRules" }) },
  { key: "labels", label: "Labels", icon: "bookmark-outline", color: "#00838f", go: (n) => n.navigate("Settings", { screen: "Labels" }) },
  { key: "categories", label: "Categories", icon: "pricetags-outline", color: "#558b2f", go: (n) => n.navigate("Settings", { screen: "Categories" }) },
  { key: "recycle-bin", label: "Recycle Bin", icon: "trash-outline", color: "#616161", go: (n) => n.navigate("Settings", { screen: "RecycleBin" }) },
  { key: "ask-ai", label: "Ask AI", icon: "chatbubble-ellipses-outline", color: "#5e35b1", go: (n) => n.navigate("Settings", { screen: "AskAi" }) },
  { key: "jobs", label: "Jobs", icon: "sync-outline", color: "#00695c", go: (n) => n.navigate("Settings", { screen: "Jobs" }) },
  { key: "family-dashboard", label: "Family Dashboard", icon: "people-outline", color: "#8e24aa", go: (n) => n.navigate("Banks", { screen: "FamilyDashboard" }), adminOnly: true },
  { key: "accounts", label: "Accounts & Statements", icon: "business-outline", color: "#283593", go: (n) => n.navigate("Banks", { screen: "BanksHub" }) },
  { key: "settings", label: "All Settings", icon: "settings-outline", color: "#37474f", go: (n) => n.navigate("Settings", { screen: "SettingsHub" }) },
];

export default function MoreHubScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isAdmin = user?.role === "ADMIN";
  const tiles = TILES.filter((t) => !t.adminOnly || isAdmin);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.profileRow} onPress={() => navigation.navigate("Settings", { screen: "Profile" })}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.full_name || user?.username || "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.full_name || user?.username}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.grid}>
        {tiles.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tile} onPress={() => t.go(navigation)} activeOpacity={0.7}>
            <View style={[styles.tileIcon, { backgroundColor: t.color }]}>
              <Ionicons name={t.icon} size={22} color="#fff" />
            </View>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    profileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 14,
      marginBottom: 20,
    },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
    name: { fontSize: 15, fontWeight: "700", color: c.text },
    email: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    tile: {
      width: "47%",
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 14,
      minHeight: 92,
      justifyContent: "space-between",
    },
    tileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
    tileLabel: { fontSize: 13, fontWeight: "600", color: c.text },
  });
