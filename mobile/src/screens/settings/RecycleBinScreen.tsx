import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { listRecycleBin, restoreTransactions, purgeTransactions, RecycleBinItem } from "../../api/transactions";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";

const daysLeft = (purgeAt: string) => {
  const ms = new Date(purgeAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

export default function RecycleBinScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listRecycleBin());
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

  const onRestore = async (item: RecycleBinItem) => {
    setBusyId(item.id);
    try {
      await restoreTransactions([item.id]);
      setItems((prev) => prev.filter((t) => t.id !== item.id));
    } catch {
      Alert.alert("Couldn't restore", "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const onPurge = (item: RecycleBinItem) => {
    Alert.alert("Delete forever?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete Forever",
        style: "destructive",
        onPress: async () => {
          setBusyId(item.id);
          try {
            await purgeTransactions([item.id]);
            setItems((prev) => prev.filter((t) => t.id !== item.id));
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Text style={styles.hint}>
        Deleted transactions sit here for 30 days before being permanently removed.
      </Text>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>Recycle bin is empty.</Text>}
        renderItem={({ item }) => {
          const busy = busyId === item.id;
          const left = daysLeft(item.purge_at);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.description} numberOfLines={1}>{item.description}</Text>
                <Text style={[styles.amount, { color: item.transaction_type === "credit" ? colors.primary : colors.text }]}>
                  {item.transaction_type === "credit" ? "+" : "-"}{formatCurrency(Math.abs(item.amount))}
                </Text>
              </View>
              <Text style={styles.meta}>
                {formatDate(item.transaction_date)} · {item.bank_name || "External"}
                {item.category ? ` · ${item.category}` : ""}
              </Text>
              <Text style={styles.meta}>
                Deleted {formatDateTime(item.deleted_at)} · {left > 0 ? `${left}d until purge` : "purging soon"}
              </Text>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.restoreButton} onPress={() => onRestore(item)} disabled={busy}>
                  {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.restoreButtonText}>Restore</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.purgeButton} onPress={() => onPurge(item)} disabled={busy}>
                  <Text style={styles.purgeButtonText}>Delete Forever</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    hint: { fontSize: 12, color: c.textSecondary, padding: 16, paddingBottom: 0 },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    description: { flex: 1, fontSize: 14, fontWeight: "600", color: c.text, marginRight: 8 },
    amount: { fontSize: 14, fontWeight: "700" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    restoreButton: {
      flex: 1,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    restoreButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
    purgeButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    purgeButtonText: { color: c.danger, fontSize: 13, fontWeight: "600" },
  });
