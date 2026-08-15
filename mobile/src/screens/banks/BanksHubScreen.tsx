import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ThemeColors, useTheme } from "../../context/ThemeContext";
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
];

export default function BanksHubScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.list}>
        {ROWS.map((row) => (
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
