import React, { useEffect } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { registerQuickActions, useQuickActionRouter } from "../utils/quickActions";
import LoginScreen from "../screens/LoginScreen";
import DashboardScreen from "../screens/DashboardScreen";
import TransactionsScreen from "../screens/TransactionsScreen";
import AddTransactionScreen, { ReceiptPrefill } from "../screens/AddTransactionScreen";
import AnalyticsScreen from "../screens/AnalyticsScreen";
import SearchScreen from "../screens/SearchScreen";
import ScanReceiptScreen from "../screens/ScanReceiptScreen";
import BanksNavigator from "./BanksNavigator";
import SettingsNavigator from "./SettingsNavigator";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  Search: undefined;
  ScanReceipt: undefined;
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

function tabIcon(emoji: string) {
  return () => <Text style={{ fontSize: 20 }}>{emoji}</Text>;
}

function AppTabs({ navigation }: any) {
  return (
    <Tab.Navigator screenOptions={{ headerTitleAlign: "center" }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: tabIcon("📊"),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate("Search")}
              style={{ paddingHorizontal: 16 }}
            >
              <Text style={{ fontSize: 18 }}>🔍</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{ tabBarIcon: tabIcon("📒") }}
      />
      <Tab.Screen
        name="Add"
        component={AddTransactionScreen}
        options={{
          tabBarIcon: tabIcon("➕"),
          title: "Add Transaction",
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate("ScanReceipt")}
              style={{ paddingHorizontal: 16 }}
            >
              <Text style={{ fontSize: 18 }}>📷</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{ tabBarIcon: tabIcon("📈"), title: "Analytics" }}
      />
      <Tab.Screen
        name="Banks"
        component={BanksNavigator}
        options={{ tabBarIcon: tabIcon("🏦"), headerShown: false, title: "Banks" }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsNavigator}
        options={{ tabBarIcon: tabIcon("⚙️"), headerShown: false }}
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
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
