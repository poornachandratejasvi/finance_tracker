import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { listTransactions } from "../api/transactions";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { Transaction } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const PAGE_SIZE = 30;

export default function TransactionsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (skip: number) => {
    const data = await listTransactions({ skip, limit: PAGE_SIZE });
    return data;
  }, []);

  const initialLoad = useCallback(async () => {
    setError(null);
    try {
      const data = await loadPage(0);
      setItems(data.items);
      setTotal(data.total);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't load transactions.");
    }
  }, [loadPage]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await initialLoad();
      setLoading(false);
    })();
  }, [initialLoad]);

  const onRefresh = async () => {
    setRefreshing(true);
    await initialLoad();
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const data = await loadPage(items.length);
      setItems((prev) => [...prev, ...data.items]);
    } catch {
      // Silently ignore — pull-to-refresh can recover.
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.flex}
      data={items}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onEndReachedThreshold={0.4}
      onEndReached={onLoadMore}
      ListEmptyComponent={
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.empty}>No transactions yet.</Text>
        )
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null
      }
      renderItem={({ item }) => <TransactionRow txn={item} />}
    />
  );
}

function TransactionRow({ txn }: { txn: Transaction }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isCredit = txn.transaction_type === "credit";
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.description} numberOfLines={1}>
          {txn.description}
        </Text>
        <Text style={styles.meta}>
          {formatDate(txn.transaction_date)} · {txn.bank_name || "External"}
          {txn.category ? ` · ${txn.category}` : ""}
        </Text>
        <View style={styles.tagRow}>
          {!txn.is_confirmed && <Text style={styles.pending}>Pending</Text>}
          {txn.source === "sms" && <Text style={styles.smsTag}>via SMS</Text>}
        </View>
      </View>
      <Text style={[styles.amount, { color: isCredit ? colors.primary : colors.danger }]}>
        {isCredit ? "+" : "-"}
        {formatCurrency(Math.abs(txn.amount), txn.currency_code)}
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    list: { padding: 16, flexGrow: 1 },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowLeft: { flex: 1, paddingRight: 12 },
    description: { fontSize: 15, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    tagRow: { flexDirection: "row", gap: 8, marginTop: 2 },
    pending: { fontSize: 11, color: c.warning, fontWeight: "600" },
    smsTag: { fontSize: 11, color: c.primary, fontWeight: "600" },
    amount: { fontSize: 15, fontWeight: "700" },
    error: { color: c.danger, textAlign: "center", marginTop: 40 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
  });
