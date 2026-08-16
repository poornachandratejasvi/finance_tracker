import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { getFamilyDashboard } from "../../api/familyDashboard";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { FamilyDashboardResponse } from "../../types";

export default function FamilyDashboardScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [data, setData] = useState<FamilyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          setData(await getFamilyDashboard());
          setError("");
        } catch (err: any) {
          setError(err?.response?.data?.detail || "Failed to load family dashboard");
        } finally {
          setLoading(false);
        }
      })();
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{error || "No data"}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.totalsRow}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Assets</Text>
          <Text style={[styles.totalValue, { color: colors.primary }]}>
            {data.totals.total_assets.toLocaleString()}
          </Text>
        </View>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Liabilities</Text>
          <Text style={[styles.totalValue, { color: colors.danger }]}>
            {data.totals.total_liabilities.toLocaleString()}
          </Text>
        </View>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Net Worth</Text>
          <Text style={styles.totalValue}>{data.totals.net_worth.toLocaleString()}</Text>
        </View>
      </View>

      {data.members.length === 0 && <Text style={styles.empty}>No household members found.</Text>}

      {data.members.map((m) => (
        <View key={m.user_id} style={styles.card}>
          <View style={styles.memberHeader}>
            <Text style={styles.memberName}>
              {(m.full_name || m.username) + (m.is_you ? " (You)" : "")}
            </Text>
            <View style={styles.roleChip}>
              <Text style={styles.roleChipText}>{m.role}</Text>
            </View>
          </View>
          <Text style={styles.meta}>Net: {m.net.toLocaleString()}</Text>
          {m.banks.length === 0 ? (
            <Text style={styles.empty}>No accounts.</Text>
          ) : (
            m.banks.map((b) => (
              <View key={b.bank_id} style={styles.bankRow}>
                <View style={styles.rowMain}>
                  <Text style={styles.bankName}>{b.bank_name}</Text>
                  <Text style={styles.meta}>{b.bank_type}</Text>
                </View>
                <Text style={[styles.bankBalance, { color: b.bank_type === "credit" ? colors.danger : colors.primary }]}>
                  {b.current_balance.toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 12 },
    totalsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
    totalCard: { flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 12 },
    totalLabel: { fontSize: 11, color: c.textSecondary },
    totalValue: { fontSize: 17, fontWeight: "700", color: c.text, marginTop: 4 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    memberHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    memberName: { fontSize: 15, fontWeight: "700", color: c.text },
    roleChip: { backgroundColor: c.chipBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
    roleChipText: { fontSize: 10, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    bankRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      marginTop: 8,
    },
    rowMain: { flex: 1 },
    bankName: { fontSize: 13, fontWeight: "600", color: c.text },
    bankBalance: { fontSize: 14, fontWeight: "700" },
  });
