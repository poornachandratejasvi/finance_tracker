import React, { useEffect } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { DarkTheme, DefaultTheme, NavigationContainer, NavigatorScreenParams, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useOffline } from "../offline/OfflineProvider";
import { registerQuickActions, useQuickActionRouter } from "../utils/quickActions";
import { TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_MARGIN } from "./tabBarMetrics";
import LoginScreen from "../screens/LoginScreen";
import DashboardScreen from "../screens/DashboardScreen";
import TransactionsScreen from "../screens/TransactionsScreen";
import AddTransactionScreen, { ReceiptPrefill } from "../screens/AddTransactionScreen";
import AnalyticsScreen from "../screens/AnalyticsScreen";
import SearchScreen from "../screens/SearchScreen";
import ScanReceiptScreen from "../screens/ScanReceiptScreen";
import EditTransactionScreen from "../screens/EditTransactionScreen";
import MoreHubScreen from "../screens/MoreHubScreen";
import MetricDetailScreen from "../screens/MetricDetailScreen";
import BanksNavigator, { BanksStackParamList } from "./BanksNavigator";
import SettingsNavigator, { SettingsStackParamList } from "./SettingsNavigator";
import { Transaction } from "../types";

export type MetricKey = "balance" | "spending" | "cashflow" | "outlook" | "credit" | "income";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  Search: undefined;
  ScanReceipt: undefined;
  EditTransaction: { transaction: Transaction };
  Add: { prefill?: ReceiptPrefill } | undefined;
  // Reachable from the More grid (and Search) rather than the tab bar -- a
  // Tab.Screen with tabBarButton:()=>null still reserves a flex slot in the
  // tab bar row (that's what caused the uneven-looking spacing), so these
  // live as root-stack screens instead, exactly like Add/Search/ScanReceipt.
  BanksStack: NavigatorScreenParams<BanksStackParamList>;
  SettingsStack: NavigatorScreenParams<SettingsStackParamList>;
  MetricDetail: { metric: MetricKey };
};

export type TabParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Analytics: undefined;
  More: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(name: keyof typeof Ionicons.glyphMap, focusedName: keyof typeof Ionicons.glyphMap) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Ionicons name={focused ? focusedName : name} size={22} color={color} />
  );
}

// Always-visible label (matches the reference app's tab bar, where every tab
// keeps its text -- only the icon gets a highlighted background when active).
function tabLabel(text: string) {
  return ({ color }: { focused: boolean; color: string }) => (
    <Text style={{ color, fontSize: 11, fontWeight: "600", marginTop: 2 }}>{text}</Text>
  );
}

function AppTabs({ navigation }: any) {
  const { colors } = useTheme();
  const headerIconColor = colors.text;
  const { isSyncing, triggerSync } = useOffline();
  return (
    <Tab.Navigator
      screenOptions={{
        headerTitleAlign: "center",
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        // Deliberately NOT position:"absolute" -- this stays in normal layout
        // flow (so it still reserves its own space and can't hide content
        // behind it on any of the ~30 screens nested under the Banks/Settings
        // tabs), just visually restyled as a rounded, inset "floating" card to
        // match the reference app instead of a flush full-width bar.
        tabBarStyle: {
          marginHorizontal: 16,
          marginBottom: TAB_BAR_BOTTOM_MARGIN,
          height: TAB_BAR_HEIGHT,
          borderRadius: TAB_BAR_HEIGHT / 2,
          backgroundColor: colors.card,
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        },
        tabBarItemStyle: { paddingTop: 6 },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: tabIcon("grid-outline", "grid"),
          tabBarLabel: tabLabel("Dashboard"),
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate("Search")} style={{ paddingHorizontal: 16 }}>
              <Ionicons name="search" size={20} color={headerIconColor} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{
          tabBarIcon: tabIcon("receipt-outline", "receipt"),
          tabBarLabel: tabLabel("Records"),
          // Records gets its own header "+" (matching the reference app) --
          // Statistics/More get neither this nor the Dashboard's floating one.
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TouchableOpacity onPress={triggerSync} disabled={isSyncing} style={{ paddingHorizontal: 10 }}>
                <Ionicons name="sync" size={20} color={isSyncing ? colors.textSecondary : headerIconColor} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate("Add")} style={{ paddingHorizontal: 10 }}>
                <Ionicons name="add-circle" size={26} color={colors.primary} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{ tabBarIcon: tabIcon("bar-chart-outline", "bar-chart"), tabBarLabel: tabLabel("Statistics"), title: "Statistics" }}
      />
      <Tab.Screen
        name="More"
        component={MoreHubScreen}
        options={{ tabBarIcon: tabIcon("ellipsis-horizontal-circle-outline", "ellipsis-horizontal-circle"), tabBarLabel: tabLabel("More"), title: "More" }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { loading, isAuthenticated } = useAuth();
  const { colors, isDark } = useTheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  useEffect(() => {
    registerQuickActions();
  }, []);
  useQuickActionRouter(navigationRef, !loading && isAuthenticated);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Tabs" component={AppTabs} />
            <Stack.Screen
              name="Search"
              component={SearchScreen}
              options={{ headerShown: true, title: "Search", presentation: "modal" }}
            />
            <Stack.Screen
              name="ScanReceipt"
              component={ScanReceiptScreen}
              options={{ headerShown: true, title: "Scan Receipt", presentation: "modal" }}
            />
            <Stack.Screen
              name="EditTransaction"
              component={EditTransactionScreen}
              options={{ headerShown: true, title: "Edit Transaction", presentation: "modal" }}
            />
            <Stack.Screen
              name="Add"
              component={AddTransactionScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: "Add Transaction",
                presentation: "modal",
                headerLeft: () => (
                  <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingHorizontal: 4 }}>
                    <Ionicons name="close" size={22} color={colors.text} />
                  </TouchableOpacity>
                ),
                headerRight: () => (
                  <TouchableOpacity onPress={() => navigation.navigate("ScanReceipt")} style={{ paddingHorizontal: 4 }}>
                    <Ionicons name="camera-outline" size={20} color={colors.text} />
                  </TouchableOpacity>
                ),
              })}
            />
            <Stack.Screen name="BanksStack" component={BanksNavigator} options={{ headerShown: false }} />
            <Stack.Screen name="SettingsStack" component={SettingsNavigator} options={{ headerShown: false }} />
            <Stack.Screen name="MetricDetail" component={MetricDetailScreen} options={{ headerShown: true, title: "" }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
