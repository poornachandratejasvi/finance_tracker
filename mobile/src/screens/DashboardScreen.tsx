import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchDashboardSummary, fetchLatestMonth } from "../api/dashboard";
import { useAuth } from "../context/AuthContext";
import { DashboardSummary } from "../types";
import { formatCurrency } from "../utils/format";

export default function DashboardScreen() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [monthLabel, setMonthLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const latest = await fetchLatestMonth();
      if (latest.has_data) {
        setMonthLabel(latest.month_label);
        const data = await fetchDashboardSummary({
          start_date: latest.start_date,
          end_date: latest.end_date,
        });
        setSummary(data);
      } else {
        setMonthLabel(null);
        setSummary(await fetchDashboardSummary());
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't load the dashboard.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.full_name || user?.username}</Text>
          {monthLabel && <Text style={styles.period}>{monthLabel}</Text>}
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {summary && (
        <>
          <View style={styles.card}>
            <Text style={styles.netLabel}>Net this period</Text>
            <Text
              style={[
                styles.netValue,
                { color: summary.net_balance >= 0 ? "#1b6b4c" : "#b3261e" },
              ]}
            >
              {formatCurrency(summary.net_balance)}
            </Text>
            <View style={styles.row}>
              <Stat label="Income" value={formatCurrency(summary.total_credit)} color="#1b6b4c" />
              <Stat label="Spent" value={formatCurrency(summary.total_debit)} color="#b3261e" />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Balances</Text>
            <View style={styles.row}>
              <Stat
                label="Savings"
                value={formatCurrency(summary.balances.savings_total)}
                color="#1b6b4c"
              />
              <Stat
                label="Credit owed"
                value={formatCurrency(summary.balances.credit_total)}
                color="#b3261e"
              />
            </View>
          </View>

          {summary.category_summary.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Top categories</Text>
              {summary.category_summary
                .slice()
                .sort((a, b) => b.total_amount - a.total_amount)
                .slice(0, 6)
                .map((c) => (
                  <View key={c.category} style={styles.listRow}>
                    <Text style={styles.listLabel}>{c.category}</Text>
                    <Text style={styles.listValue}>{formatCurrency(c.total_amount)}</Text>
                  </View>
                ))}
            </View>
          )}

          {summary.balances.banks.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Accounts</Text>
              {summary.balances.banks.map((b) => (
                <View key={b.bank_id} style={styles.listRow}>
                  <Text style={styles.listLabel}>{b.bank_name}</Text>
                  <Text style={styles.listValue}>{formatCurrency(b.current_balance)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 16, paddingBottom: 32 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  greeting: { fontSize: 20, fontWeight: "700" },
  period: { fontSize: 13, color: "#666", marginTop: 2 },
  logout: { color: "#b3261e", fontWeight: "600" },
  error: { color: "#b3261e", marginBottom: 12 },
  card: {
    backgroundColor: "#f7f7f7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  netLabel: { fontSize: 13, color: "#666" },
  netValue: { fontSize: 30, fontWeight: "700", marginTop: 4, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10 },
  row: { flexDirection: "row", gap: 16 },
  stat: { flex: 1 },
  statLabel: { fontSize: 12, color: "#666" },
  statValue: { fontSize: 18, fontWeight: "700", marginTop: 2 },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  listLabel: { fontSize: 14, color: "#333" },
  listValue: { fontSize: 14, fontWeight: "600" },
});
