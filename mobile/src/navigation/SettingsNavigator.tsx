import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import SettingsHubScreen from "../screens/settings/SettingsHubScreen";
import ProfileScreen from "../screens/settings/ProfileScreen";
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
import SmsAutoDetectScreen from "../screens/settings/SmsAutoDetectScreen";
import SmsImportScreen from "../screens/settings/SmsImportScreen";
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
import BudgetsScreen from "../screens/settings/BudgetsScreen";
import GoalsScreen from "../screens/settings/GoalsScreen";
import GoalFormScreen from "../screens/settings/GoalFormScreen";
import VehiclesScreen from "../screens/settings/VehiclesScreen";
import VehicleFormScreen from "../screens/settings/VehicleFormScreen";
import DebtPayoffScreen from "../screens/settings/DebtPayoffScreen";
import JobsScreen from "../screens/settings/JobsScreen";
import AutomationScreen from "../screens/settings/AutomationScreen";
import AskAiScreen from "../screens/settings/AskAiScreen";
import RecycleBinScreen from "../screens/settings/RecycleBinScreen";
import NetWorthScreen from "../screens/settings/NetWorthScreen";
import AutopayMandatesScreen from "../screens/settings/AutopayMandatesScreen";
import AutopayMandateFormScreen from "../screens/settings/AutopayMandateFormScreen";
import InsuranceScreen from "../screens/settings/InsuranceScreen";
import InsuranceFormScreen from "../screens/settings/InsuranceFormScreen";
import WarrantiesScreen from "../screens/settings/WarrantiesScreen";
import WarrantyFormScreen from "../screens/settings/WarrantyFormScreen";
import IOUsScreen from "../screens/settings/IOUsScreen";
import IOUFormScreen from "../screens/settings/IOUFormScreen";
import IOUPaymentFormScreen from "../screens/settings/IOUPaymentFormScreen";
import TaxDashboardScreen from "../screens/settings/TaxDashboardScreen";
import SharedExpensesScreen from "../screens/settings/SharedExpensesScreen";
import SharedExpenseFormScreen from "../screens/settings/SharedExpenseFormScreen";
import PackagesScreen from "../screens/settings/PackagesScreen";
import PackageFormScreen from "../screens/settings/PackageFormScreen";
import CalendarScreen from "../screens/settings/CalendarScreen";
import PlannedItemsScreen from "../screens/settings/PlannedItemsScreen";
import PlannedItemFormScreen from "../screens/settings/PlannedItemFormScreen";
import PlannedItemMatchScreen from "../screens/settings/PlannedItemMatchScreen";
import {
  Category, Label, AutoRule, NotificationRule, Currency, Template, AdminUser, Goal, Vehicle,
  AutopayMandate, InsurancePolicy, Warranty, Iou, PlannedItem,
} from "../types";

export type SettingsStackParamList = {
  SettingsHub: undefined;
  Profile: undefined;
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
  SmsAutoDetect: undefined;
  SmsImport: undefined;
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
  Budgets: undefined;
  Goals: undefined;
  GoalForm: { goal?: Goal } | undefined;
  Vehicles: undefined;
  VehicleForm: { vehicle?: Vehicle } | undefined;
  DebtPayoff: undefined;
  Jobs: undefined;
  Automation: undefined;
  AskAi: undefined;
  RecycleBin: undefined;
  NetWorth: undefined;
  AutopayMandates: undefined;
  AutopayMandateForm: { mandate?: AutopayMandate } | undefined;
  Insurance: undefined;
  InsuranceForm: { policy?: InsurancePolicy } | undefined;
  Warranties: undefined;
  WarrantyForm: { warranty?: Warranty } | undefined;
  IOUs: undefined;
  IOUForm: { iou?: Iou } | undefined;
  IOUPaymentForm: { iou: Iou };
  TaxDashboard: undefined;
  SharedExpenses: undefined;
  SharedExpenseForm: undefined;
  Packages: undefined;
  PackageForm: undefined;
  Calendar: undefined;
  PlannedItems: undefined;
  PlannedItemForm: { item?: PlannedItem } | undefined;
  PlannedItemMatch: { item: PlannedItem };
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="SettingsHub" component={SettingsHubScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
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
      <Stack.Screen name="SmsAutoDetect" component={SmsAutoDetectScreen} options={{ title: "SMS Auto-Detect" }} />
      <Stack.Screen name="SmsImport" component={SmsImportScreen} options={{ title: "Import from SMS" }} />
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
      <Stack.Screen name="Budgets" component={BudgetsScreen} options={{ title: "Budgets" }} />
      <Stack.Screen name="Goals" component={GoalsScreen} options={{ title: "Goals" }} />
      <Stack.Screen name="GoalForm" component={GoalFormScreen} options={{ title: "Goal" }} />
      <Stack.Screen name="Vehicles" component={VehiclesScreen} options={{ title: "Vehicles" }} />
      <Stack.Screen name="VehicleForm" component={VehicleFormScreen} options={{ title: "Vehicle" }} />
      <Stack.Screen name="DebtPayoff" component={DebtPayoffScreen} options={{ title: "Debt Payoff" }} />
      <Stack.Screen name="Jobs" component={JobsScreen} options={{ title: "Jobs" }} />
      <Stack.Screen name="Automation" component={AutomationScreen} options={{ title: "Automation" }} />
      <Stack.Screen name="AskAi" component={AskAiScreen} options={{ title: "Ask AI" }} />
      <Stack.Screen name="RecycleBin" component={RecycleBinScreen} options={{ title: "Recycle Bin" }} />
      <Stack.Screen name="NetWorth" component={NetWorthScreen} options={{ title: "Net Worth" }} />
      <Stack.Screen name="AutopayMandates" component={AutopayMandatesScreen} options={{ title: "Autopay Mandates" }} />
      <Stack.Screen name="AutopayMandateForm" component={AutopayMandateFormScreen} options={{ title: "Mandate" }} />
      <Stack.Screen name="Insurance" component={InsuranceScreen} options={{ title: "Insurance" }} />
      <Stack.Screen name="InsuranceForm" component={InsuranceFormScreen} options={{ title: "Policy" }} />
      <Stack.Screen name="Warranties" component={WarrantiesScreen} options={{ title: "Warranties" }} />
      <Stack.Screen name="WarrantyForm" component={WarrantyFormScreen} options={{ title: "Warranty" }} />
      <Stack.Screen name="IOUs" component={IOUsScreen} options={{ title: "IOUs" }} />
      <Stack.Screen name="IOUForm" component={IOUFormScreen} options={{ title: "IOU" }} />
      <Stack.Screen name="IOUPaymentForm" component={IOUPaymentFormScreen} options={{ title: "Record Payment" }} />
      <Stack.Screen name="TaxDashboard" component={TaxDashboardScreen} options={{ title: "Tax Dashboard" }} />
      <Stack.Screen name="SharedExpenses" component={SharedExpensesScreen} options={{ title: "Shared Expenses" }} />
      <Stack.Screen name="SharedExpenseForm" component={SharedExpenseFormScreen} options={{ title: "Add Expense" }} />
      <Stack.Screen name="Packages" component={PackagesScreen} options={{ title: "Packages" }} />
      <Stack.Screen name="PackageForm" component={PackageFormScreen} options={{ title: "Add Package" }} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={{ title: "Calendar" }} />
      <Stack.Screen name="PlannedItems" component={PlannedItemsScreen} options={{ title: "Planned Expenses" }} />
      <Stack.Screen name="PlannedItemForm" component={PlannedItemFormScreen} options={{ title: "Planned Item" }} />
      <Stack.Screen name="PlannedItemMatch" component={PlannedItemMatchScreen} options={{ title: "Map Transaction" }} />
    </Stack.Navigator>
  );
}
