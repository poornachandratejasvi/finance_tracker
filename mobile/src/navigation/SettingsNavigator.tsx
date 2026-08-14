import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import SettingsHubScreen from "../screens/settings/SettingsHubScreen";
import ProfileScreen from "../screens/settings/ProfileScreen";
import BanksScreen from "../screens/settings/BanksScreen";
import BankFormScreen from "../screens/settings/BankFormScreen";
import CategoriesScreen from "../screens/settings/CategoriesScreen";
import CategoryFormScreen from "../screens/settings/CategoryFormScreen";
import LabelsScreen from "../screens/settings/LabelsScreen";
import LabelFormScreen from "../screens/settings/LabelFormScreen";
import AIScreen from "../screens/settings/AIScreen";
import AutoRulesScreen from "../screens/settings/AutoRulesScreen";
import AutoRuleFormScreen from "../screens/settings/AutoRuleFormScreen";
import NotificationRulesScreen from "../screens/settings/NotificationRulesScreen";
import NotificationRuleFormScreen from "../screens/settings/NotificationRuleFormScreen";
import { Bank, Category, Label, AutoRule, NotificationRule } from "../types";

export type SettingsStackParamList = {
  SettingsHub: undefined;
  Profile: undefined;
  Banks: undefined;
  BankForm: { bank?: Bank } | undefined;
  Categories: undefined;
  CategoryForm: { category?: Category } | undefined;
  Labels: undefined;
  LabelForm: { label?: Label } | undefined;
  AI: undefined;
  AutoRules: undefined;
  AutoRuleForm: { rule?: AutoRule } | undefined;
  NotificationRules: undefined;
  NotificationRuleForm: { rule?: NotificationRule } | undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="SettingsHub" component={SettingsHubScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Banks" component={BanksScreen} options={{ title: "Accounts" }} />
      <Stack.Screen name="BankForm" component={BankFormScreen} options={{ title: "Account" }} />
      <Stack.Screen name="Categories" component={CategoriesScreen} options={{ title: "Categories" }} />
      <Stack.Screen name="CategoryForm" component={CategoryFormScreen} options={{ title: "Category" }} />
      <Stack.Screen name="Labels" component={LabelsScreen} options={{ title: "Labels" }} />
      <Stack.Screen name="LabelForm" component={LabelFormScreen} options={{ title: "Label" }} />
      <Stack.Screen name="AI" component={AIScreen} options={{ title: "AI" }} />
      <Stack.Screen name="AutoRules" component={AutoRulesScreen} options={{ title: "Automatic Rules" }} />
      <Stack.Screen name="AutoRuleForm" component={AutoRuleFormScreen} options={{ title: "Rule" }} />
      <Stack.Screen
        name="NotificationRules"
        component={NotificationRulesScreen}
        options={{ title: "Notification Rules" }}
      />
      <Stack.Screen
        name="NotificationRuleForm"
        component={NotificationRuleFormScreen}
        options={{ title: "Notification Rule" }}
      />
    </Stack.Navigator>
  );
}
