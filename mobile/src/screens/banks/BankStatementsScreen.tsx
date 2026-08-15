import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { fetchStatementDashboard } from "../../api/pdfs";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";
import { StatementDashboardBank } from "../../types";
import { formatCurrency, formatDate } from "../../utils/format";

type Props = NativeStackScreenProps<BanksStackParamList, "Statements">;

function dueStatus(daysUntilNext: number | null): { label: string; kind: "overdue" | "soon" | "ok" | "unknown" } {
  if (daysUntilNext == null) return { label: "No statements yet", kind: "unknown" };
  if (daysUntilNext < 0) return { label: `${Math.abs(daysUntilNext)}d overdue`, kind: "overdue" };
  if (daysUntilNext <= 7) return { label: `Due in ${daysUntilNext}d`, kind: "soon" };
  return { label: `Due in ${daysUntilNext}d`, kind: "ok" };
}

export default function BankStatementsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [banks, setBanks] = useState<StatementDashboardBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setBanks(await fetchStatementDashboard());
    } catch {
      // keep prior list; pull-to-refresh can retry
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const statusColor = {
    overdue: colors.danger,
    soon: colors.warning,
    ok: colors.primary,
    unknown: colors.textSecondary,
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const totalStatements = banks.reduce((sum, b) => sum + b.total_statements, 0);
  const totalTransactions = banks.reduce((sum, b) => sum + b.total_transactions, 0);
  const overdueCount = banks.filter((b) => (b.days_until_next ?? 1) < 0).length;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.summaryRow}>
        <Summary label="Banks" value={String(banks.length)} colors={colors} />
        <Summary label="Statements" value={String(totalStatements)} colors={colors} />
        <Summary label="Transactions" value={String(totalTransactions)} colors={colors} />
        <Summary
          label="Overdue"
          value={String(overdueCount)}
          colors={colors}
          color={overdueCount > 0 ? colors.danger : undefined}
        />
      </View>

      {banks.length === 0 && <Text style={styles.empty}>No accounts with statements yet.</Text>}

      {banks.map((b) => {
        const status = dueStatus(b.days_until_next);
        return (
          <TouchableOpacity
            key={b.bank_id}
            style={styles.card}
            onPress={() => navigation.navigate("Pdfs", { bankId: b.bank_id, bankName: b.bank_name })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.bankName}>{b.bank_name}</Text>
              <Text style={[styles.status, { color: statusColor[status.kind] }]}>{status.label}</Text>
            </View>
            {b.current_balance != null && (
              <Text style={styles.balance}>{formatCurrency(b.current_balance)}</Text>
            )}
            <Text style={styles.meta}>
              {b.total_statements} statement{b.total_statements === 1 ? "" : "s"} · {b.total_transactions} txns
            </Text>
            {b.latest_pdf_filename && (
              <Text style={styles.meta} numberOfLines={1}>
                Latest: {b.latest_pdf_filename} {b.latest_pdf_processed ? "" : "(unprocessed)"}
              </Text>
            )}
            {b.latest_received_date && (
              <Text style={styles.meta}>Received {formatDate(b.latest_received_date)}</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function Summary({
  label,
  value,
  colors,
  color,
}: {
  label: string;
  value: string;
  colors: ThemeColors;
  color?: string;
}) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    summaryRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
    summaryItem: { flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: "center" },
    summaryValue: { fontSize: 16, fontWeight: "700", color: c.text },
    summaryLabel: { fontSize: 10, color: c.textSecondary, marginTop: 2 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    bankName: { fontSize: 15, fontWeight: "700", color: c.text, flexShrink: 1 },
    status: { fontSize: 12, fontWeight: "700" },
    balance: { fontSize: 18, fontWeight: "700", color: c.text, marginTop: 6 },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
  });
