import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchNetWorth } from "../../api/dashboard";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { NetWorthResponse } from "../../types";
import { formatCurrency } from "../../utils/format";

const PERIODS = ["30", "90", "180", "365"];

export default function NetWorthScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [days, setDays] = useState("180");
  const [data, setData] = useState<NetWorthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: string) => {
    try {
      setData(await fetchNetWorth(parseInt(d, 10)));
    } catch {
      // keep prior state
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load(days);
        setLoading(false);
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, days])
  );

  const current = data?.current;
  const assets = (current?.savings_total || 0) + (current?.investments_total || 0);
  const liabilities = (current?.credit_total || 0) + (current?.loan_total || 0);
  const series = data?.series || [];
  const delta = series.length >= 2 ? series[series.length - 1].full_net_worth - series[0].full_net_worth : null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <View style={styles.periodRow}>
        <ChipRow options={PERIODS} selected={days} onSelect={setDays} labelFor={(v) => `${v}d`} />
      </View>

      <View style={[styles.heroCard, { backgroundColor: colors.chipBg }]}>
        <Text style={styles.heroLabel}>Full Net Worth</Text>
        <Text style={[styles.heroValue, { color: colors.primary }]}>{formatCurrency(current?.full_net_worth || 0)}</Text>
        {delta != null && (
          <Text style={[styles.deltaText, { color: delta >= 0 ? colors.primary : colors.danger }]}>
            {delta >= 0 ? "+" : ""}{formatCurrency(delta)} over {days}d
          </Text>
        )}
      </View>

      <View style={styles.row}>
        <View style={[styles.smallCard, { backgroundColor: colors.chipBg }]}>
          <Text style={styles.heroLabel}>Total Assets</Text>
          <Text style={styles.smallValue}>{formatCurrency(assets)}</Text>
        </View>
        <View style={[styles.smallCard, { backgroundColor: colors.chipBg }]}>
          <Text style={styles.heroLabel}>Total Liabilities</Text>
          <Text style={[styles.smallValue, { color: colors.danger }]}>{formatCurrency(liabilities)}</Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        Bank balances plus investments, minus credit cards and loans — the fuller picture beyond the Dashboard's bank-only net worth figure.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    periodRow: { marginBottom: 12 },
    heroCard: { borderRadius: 14, padding: 18, marginBottom: 16 },
    heroLabel: { fontSize: 11, color: c.textSecondary, textTransform: "uppercase", fontWeight: "700" },
    heroValue: { fontSize: 28, fontWeight: "800", marginTop: 6 },
    deltaText: { fontSize: 13, fontWeight: "600", marginTop: 6 },
    row: { flexDirection: "row", gap: 12 },
    smallCard: { flex: 1, borderRadius: 12, padding: 14 },
    smallValue: { fontSize: 18, fontWeight: "800", color: c.text, marginTop: 4 },
    footnote: { fontSize: 12, color: c.textSecondary, marginTop: 20, lineHeight: 18 },
  });
