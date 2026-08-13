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
import { Transaction } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const PAGE_SIZE = 30;

export default function TransactionsScreen() {
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
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
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
        {!txn.is_confirmed && <Text style={styles.pending}>Pending</Text>}
      </View>
      <Text style={[styles.amount, { color: isCredit ? "#1b6b4c" : "#b3261e" }]}>
        {isCredit ? "+" : "-"}
        {formatCurrency(Math.abs(txn.amount), txn.currency_code)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, flexGrow: 1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  description: { fontSize: 15, fontWeight: "600", color: "#222" },
  meta: { fontSize: 12, color: "#777", marginTop: 2 },
  pending: { fontSize: 11, color: "#b8860b", marginTop: 2, fontWeight: "600" },
  amount: { fontSize: 15, fontWeight: "700" },
  error: { color: "#b3261e", textAlign: "center", marginTop: 40 },
  empty: { color: "#888", textAlign: "center", marginTop: 40 },
});
