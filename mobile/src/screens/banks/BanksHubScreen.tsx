import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";

type Props = NativeStackScreenProps<BanksStackParamList, "BanksHub">;

interface Row {
  key: keyof BanksStackParamList;
  label: string;
  icon: string;
  hint: string;
}

const ROWS: Row[] = [
  { key: "Banks", label: "Accounts", icon: "🏦", hint: "Manage your linked bank accounts" },
  {
    key: "Statements",
    label: "Bank Statements",
    icon: "🧾",
    hint: "Latest statement per account, balances, next-statement due dates",
  },
  { key: "Pdfs", label: "Browse Statement PDFs", icon: "📄", hint: "All received PDFs, reprocess, unlock" },
  { key: "CsvExports", label: "CSV Exports", icon: "📊", hint: "Generate, email, or download CSV statements" },
  { key: "Imports", label: "Imports", icon: "📥", hint: "Import transactions from a CSV or Excel file" },
  { key: "RewardPoints", label: "Reward Points", icon: "🎁", hint: "Track points balance, usage, and upcoming expiries" },
];

const ADMIN_ROWS: Row[] = [
  { key: "FamilyDashboard", label: "Family Dashboard", icon: "👨‍👩‍👧", hint: "Every household member's accounts and balances combined" },
];

export default function BanksHubScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const rows = user?.role === "ADMIN" ? [...ROWS, ...ADMIN_ROWS] : ROWS;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.list}>
        {rows.map((row) => (
          <TouchableOpacity
            key={row.key}
            style={styles.row}
            onPress={() => navigation.navigate(row.key as any)}
          >
            <Text style={styles.icon}>{row.icon}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.hint}>{row.hint}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    list: { backgroundColor: c.card, borderRadius: 12, overflow: "hidden" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    icon: { fontSize: 20, width: 34 },
    rowMain: { flex: 1 },
    label: { fontSize: 15, fontWeight: "600", color: c.text },
    hint: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    chevron: { fontSize: 20, color: c.textSecondary },
  });
