import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../context/AuthContext";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { TabParamList, RootStackParamList } from "../navigation/RootNavigator";

type TabNav = BottomTabNavigationProp<TabParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

interface Tile {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  go: (tabNav: TabNav, rootNav: RootNav) => void;
  adminOnly?: boolean;
}

// A colorful 2-column tile grid -- matches the reference app's "More" screen,
// which is where it puts everything not pinned to a main tab. This app has
// far more features than the reference, so rather than flattening all ~35
// settings/banks screens into one huge grid, the highest-traffic ones get a
// direct tile and everything else is one tap away via the "Accounts &
// Statements" and "All Settings" catch-all tiles (which land on the existing,
// still-fully-functional BanksHub/SettingsHub list screens). BanksStack and
// SettingsStack are root-level screens (not tabs -- see RootNavigator), so
// they're reached via the root nav, not the tab nav.
const TILES: Tile[] = [
  { key: "records", label: "Records", icon: "list-outline", color: "#2e7d32", go: (tn) => tn.navigate("Transactions") },
  { key: "investments", label: "Investments", icon: "trending-up-outline", color: "#6a1b9a", go: (_, rn) => rn.navigate("BanksStack", { screen: "Investments" }) },
  { key: "budgets", label: "Budgets", icon: "wallet-outline", color: "#ef6c00", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Budgets" }) },
  { key: "goals", label: "Goals", icon: "flag-outline", color: "#c2185b", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Goals" }) },
  { key: "reward-points", label: "Reward Points", icon: "gift-outline", color: "#f9a825", go: (_, rn) => rn.navigate("BanksStack", { screen: "RewardPoints" }) },
  { key: "vehicles", label: "Vehicles", icon: "car-outline", color: "#1565c0", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Vehicles" }) },
  { key: "debt-payoff", label: "Debt Payoff", icon: "trending-down-outline", color: "#c62828", go: (_, rn) => rn.navigate("SettingsStack", { screen: "DebtPayoff" }) },
  { key: "automatic-rules", label: "Automatic Rules", icon: "flash-outline", color: "#4527a0", go: (_, rn) => rn.navigate("SettingsStack", { screen: "AutoRules" }) },
  { key: "labels", label: "Labels", icon: "bookmark-outline", color: "#00838f", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Labels" }) },
  { key: "categories", label: "Categories", icon: "pricetags-outline", color: "#558b2f", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Categories" }) },
  { key: "recycle-bin", label: "Recycle Bin", icon: "trash-outline", color: "#616161", go: (_, rn) => rn.navigate("SettingsStack", { screen: "RecycleBin" }) },
  { key: "ask-ai", label: "Ask AI", icon: "chatbubble-ellipses-outline", color: "#5e35b1", go: (_, rn) => rn.navigate("SettingsStack", { screen: "AskAi" }) },
  { key: "jobs", label: "Jobs", icon: "sync-outline", color: "#00695c", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Jobs" }) },
  { key: "family-dashboard", label: "Family Dashboard", icon: "people-outline", color: "#8e24aa", go: (_, rn) => rn.navigate("BanksStack", { screen: "FamilyDashboard" }), adminOnly: true },
  { key: "calendar", label: "Calendar", icon: "calendar-outline", color: "#2e5aac", go: (_, rn) => rn.navigate("SettingsStack", { screen: "Calendar" }) },
  { key: "net-worth", label: "Net Worth", icon: "trending-up-outline", color: "#0b8043", go: (_, rn) => rn.navigate("SettingsStack", { screen: "NetWorth" }) },
  { key: "ious", label: "IOUs", icon: "people-outline", color: "#ad1457", go: (_, rn) => rn.navigate("SettingsStack", { screen: "IOUs" }) },
  { key: "accounts", label: "Accounts & Statements", icon: "business-outline", color: "#283593", go: (_, rn) => rn.navigate("BanksStack", { screen: "BanksHub" }) },
  { key: "settings", label: "All Settings", icon: "settings-outline", color: "#37474f", go: (_, rn) => rn.navigate("SettingsStack", { screen: "SettingsHub" }) },
];

export default function MoreHubScreen() {
  const tabNavigation = useNavigation<TabNav>();
  // useNavigation() always returns the CLOSEST navigator (the tab navigator
  // here) regardless of the generic type asserted -- getParent() is what
  // actually walks up to the root stack, which is where BanksStack/
  // SettingsStack live (see RootNavigator).
  const rootNavigation = tabNavigation.getParent<RootNav>()!;
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isAdmin = user?.role === "ADMIN";
  const tiles = TILES.filter((t) => !t.adminOnly || isAdmin);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.profileRow} onPress={() => rootNavigation.navigate("SettingsStack", { screen: "Profile" })}>
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
          <TouchableOpacity key={t.key} style={styles.tile} onPress={() => t.go(tabNavigation, rootNavigation)} activeOpacity={0.7}>
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
