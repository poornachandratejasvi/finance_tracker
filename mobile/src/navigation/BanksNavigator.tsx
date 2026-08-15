import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import BanksHubScreen from "../screens/banks/BanksHubScreen";
import BankStatementsScreen from "../screens/banks/BankStatementsScreen";
import PdfsScreen from "../screens/banks/PdfsScreen";
import CsvExportsScreen from "../screens/banks/CsvExportsScreen";
import ImportsScreen from "../screens/banks/ImportsScreen";
import RewardPointsScreen from "../screens/banks/RewardPointsScreen";
import BanksScreen from "../screens/settings/BanksScreen";
import BankFormScreen from "../screens/settings/BankFormScreen";
import { Bank } from "../types";

export type BanksStackParamList = {
  BanksHub: undefined;
  Banks: undefined;
  BankForm: { bank?: Bank } | undefined;
  Statements: undefined;
  Pdfs: { bankId?: number; bankName?: string } | undefined;
  CsvExports: { bankId?: number; bankName?: string } | undefined;
  Imports: undefined;
  RewardPoints: undefined;
};

const Stack = createNativeStackNavigator<BanksStackParamList>();

export default function BanksNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="BanksHub" component={BanksHubScreen} options={{ title: "Banks" }} />
      <Stack.Screen name="Banks" component={BanksScreen} options={{ title: "Accounts" }} />
      <Stack.Screen name="BankForm" component={BankFormScreen} options={{ title: "Account" }} />
      <Stack.Screen name="Statements" component={BankStatementsScreen} options={{ title: "Bank Statements" }} />
      <Stack.Screen name="Pdfs" component={PdfsScreen} options={{ title: "Statements" }} />
      <Stack.Screen name="CsvExports" component={CsvExportsScreen} options={{ title: "CSV Exports" }} />
      <Stack.Screen name="Imports" component={ImportsScreen} options={{ title: "Imports" }} />
      <Stack.Screen name="RewardPoints" component={RewardPointsScreen} options={{ title: "Reward Points" }} />
    </Stack.Navigator>
  );
}
