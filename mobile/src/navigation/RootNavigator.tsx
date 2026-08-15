import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import LoginScreen from "../screens/LoginScreen";
import DashboardScreen from "../screens/DashboardScreen";
import TransactionsScreen from "../screens/TransactionsScreen";
import AddTransactionScreen from "../screens/AddTransactionScreen";
import SettingsNavigator from "./SettingsNavigator";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Add: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(emoji: string) {
  return () => <Text style={{ fontSize: 20 }}>{emoji}</Text>;
}

function AppTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerTitleAlign: "center" }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: tabIcon("📊") }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{ tabBarIcon: tabIcon("📒") }}
      />
      <Tab.Screen
        name="Add"
        component={AddTransactionScreen}
        options={{ tabBarIcon: tabIcon("➕"), title: "Add Transaction" }}
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
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Tabs" component={AppTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
