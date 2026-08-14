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
import CurrenciesScreen from "../screens/settings/CurrenciesScreen";
import CurrencyFormScreen from "../screens/settings/CurrencyFormScreen";
import TemplatesScreen from "../screens/settings/TemplatesScreen";
import TemplateFormScreen from "../screens/settings/TemplateFormScreen";
import ApiTokensScreen from "../screens/settings/ApiTokensScreen";
import UsersScreen from "../screens/settings/UsersScreen";
import UserFormScreen from "../screens/settings/UserFormScreen";
import ExternalAccountsScreen from "../screens/settings/ExternalAccountsScreen";
import BackupScreen from "../screens/settings/BackupScreen";
import McpScreen from "../screens/settings/McpScreen";
import LogsScreen from "../screens/settings/LogsScreen";
import BillingScreen from "../screens/settings/BillingScreen";
import PrivacyScreen from "../screens/settings/PrivacyScreen";
import HelpScreen from "../screens/settings/HelpScreen";
import AboutScreen from "../screens/settings/AboutScreen";
import { Bank, Category, Label, AutoRule, NotificationRule, Currency, Template, AdminUser } from "../types";

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
  Currencies: undefined;
  CurrencyForm: { currency?: Currency } | undefined;
  Templates: undefined;
  TemplateForm: { template?: Template } | undefined;
  ApiTokens: undefined;
  Users: undefined;
  UserForm: { user?: AdminUser } | undefined;
  ExternalAccounts: undefined;
  Backup: undefined;
  Mcp: undefined;
  Logs: undefined;
  Billing: undefined;
  Privacy: undefined;
  Help: undefined;
  About: undefined;
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
      <Stack.Screen name="Currencies" component={CurrenciesScreen} options={{ title: "Currencies" }} />
      <Stack.Screen name="CurrencyForm" component={CurrencyFormScreen} options={{ title: "Currency" }} />
      <Stack.Screen name="Templates" component={TemplatesScreen} options={{ title: "Templates" }} />
      <Stack.Screen name="TemplateForm" component={TemplateFormScreen} options={{ title: "Template" }} />
      <Stack.Screen name="ApiTokens" component={ApiTokensScreen} options={{ title: "REST API" }} />
      <Stack.Screen name="Users" component={UsersScreen} options={{ title: "Users" }} />
      <Stack.Screen name="UserForm" component={UserFormScreen} options={{ title: "User" }} />
      <Stack.Screen
        name="ExternalAccounts"
        component={ExternalAccountsScreen}
        options={{ title: "External Accounts" }}
      />
      <Stack.Screen name="Backup" component={BackupScreen} options={{ title: "Backup" }} />
      <Stack.Screen name="Mcp" component={McpScreen} options={{ title: "MCP Server" }} />
      <Stack.Screen name="Logs" component={LogsScreen} options={{ title: "Application Logs" }} />
      <Stack.Screen name="Billing" component={BillingScreen} options={{ title: "Billing" }} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: "Personal data & privacy" }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: "Help" }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: "About" }} />
    </Stack.Navigator>
  );
}
