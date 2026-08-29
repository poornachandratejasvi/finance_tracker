import React, { useEffect } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
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
import BanksNavigator from "./BanksNavigator";
import SettingsNavigator from "./SettingsNavigator";
import { Transaction } from "../types";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  Search: undefined;
  ScanReceipt: undefined;
  EditTransaction: { transaction: Transaction };
};

export type TabParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Add: { prefill?: ReceiptPrefill } | undefined;
  Analytics: undefined;
  Banks: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(name: keyof typeof Ionicons.glyphMap, focusedName: keyof typeof Ionicons.glyphMap) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Ionicons name={focused ? focusedName : name} size={22} color={color} />
  );
}

// Label only shows for the focused tab (icon-only otherwise) -- matches the
// reference app's floating pill tab bar, where only the active tab is labeled.
function tabLabel(text: string) {
  return ({ focused, color }: { focused: boolean; color: string }) =>
    focused ? <Text style={{ color, fontSize: 11, fontWeight: "700", marginTop: 2 }}>{text}</Text> : null;
}

function AppTabs({ navigation }: any) {
  const { colors } = useTheme();
  const headerIconColor = colors.text;
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
            <TouchableOpacity
              onPress={() => navigation.navigate("Search")}
              style={{ paddingHorizontal: 16 }}
            >
              <Ionicons name="search" size={20} color={headerIconColor} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{ tabBarIcon: tabIcon("receipt-outline", "receipt"), tabBarLabel: tabLabel("Transactions") }}
      />
      <Tab.Screen
        name="Add"
        component={AddTransactionScreen}
        options={{
          tabBarIcon: tabIcon("add-circle-outline", "add-circle"),
          tabBarLabel: tabLabel("Add"),
          title: "Add Transaction",
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate("ScanReceipt")}
              style={{ paddingHorizontal: 16 }}
            >
              <Ionicons name="camera-outline" size={20} color={headerIconColor} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{ tabBarIcon: tabIcon("bar-chart-outline", "bar-chart"), tabBarLabel: tabLabel("Analytics"), title: "Analytics" }}
      />
      <Tab.Screen
        name="Banks"
        component={BanksNavigator}
        options={{ tabBarIcon: tabIcon("business-outline", "business"), tabBarLabel: tabLabel("Banks"), headerShown: false, title: "Banks" }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsNavigator}
        options={{ tabBarIcon: tabIcon("settings-outline", "settings"), tabBarLabel: tabLabel("Settings"), headerShown: false }}
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
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
