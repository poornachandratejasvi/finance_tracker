import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { closePlannedItemOccurrence, getPlannedItemsSummary, listPlannedItems } from "../../api/plannedItems";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { PlannedItem, PlannedItemsSummary } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "PlannedItems">;

const STATUS_META: Record<string, { label: string; color: (c: ThemeColors) => string }> = {
  open: { label: "Open", color: (c) => c.warning },
  matched: { label: "Matched", color: (c) => c.primary },
  closed: { label: "Closed", color: (c) => c.textSecondary },
};

export default function PlannedItemsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState<PlannedItem[]>([]);
  const [summary, setSummary] = useState<PlannedItemsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rows, s] = await Promise.all([listPlannedItems(), getPlannedItemsSummary()]);
      setItems(rows);
      setSummary(s);
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

  const closeNoMatch = async (item: PlannedItem) => {
    if (!item.current_occurrence) return;
    try {
      await closePlannedItemOccurrence(item.current_occurrence.id);
      load();
    } catch {
      // no-op; user can retry
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
    <View style={styles.flex}>
      {summary && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Planned Income</Text>
            <Text style={[styles.summaryValue, { color: colors.primary }]}>{formatCurrency(summary.planned_income)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Planned Expense</Text>
            <Text style={[styles.summaryValue, { color: colors.danger }]}>{formatCurrency(summary.planned_expense)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Open</Text>
            <Text style={[styles.summaryValue, { color: colors.warning }]}>{summary.open_count}</Text>
          </View>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing planned yet — add your rent, EMIs, subscriptions, or expected salary.</Text>
        }
        renderItem={({ item }) => {
          const occ = item.current_occurrence;
          const status = occ ? STATUS_META[occ.status] || STATUS_META.open : null;
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("PlannedItemForm", { item })}>
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <View
                  style={[
                    styles.directionBadge,
                    { backgroundColor: item.direction === "income" ? colors.primary : colors.danger },
                  ]}
                >
                  <Text style={styles.directionBadgeText}>{item.direction === "income" ? "Income" : "Expense"}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {item.amount != null ? formatCurrency(item.amount) : "No fixed amount"} · {item.recurrence}
                {occ ? ` · Due ${occ.due_date.slice(0, 10)}` : ""}
              </Text>
              {status && (
                <Text style={[styles.statusText, { color: status.color(colors) }]}>{status.label}</Text>
              )}
              {occ && occ.status === "open" && (
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => navigation.navigate("PlannedItemMatch", { item })}
                  >
                    <Ionicons name="link-outline" size={14} color={colors.primary} />
                    <Text style={[styles.actionText, { color: colors.primary }]}>Map</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButton} onPress={() => closeNoMatch(item)}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.actionText, { color: colors.textSecondary }]}>Close</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("PlannedItemForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Planned Item</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    summaryRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 16 },
    summaryCard: { flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 10 },
    summaryLabel: { fontSize: 10, color: c.textSecondary, fontWeight: "600", textTransform: "uppercase" },
    summaryValue: { fontSize: 15, fontWeight: "800", marginTop: 4 },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    name: { fontSize: 15, fontWeight: "700", color: c.text, flex: 1 },
    directionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    directionBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    statusText: { fontSize: 12, fontWeight: "700", marginTop: 6 },
    actionsRow: { flexDirection: "row", gap: 16, marginTop: 10 },
    actionButton: { flexDirection: "row", alignItems: "center", gap: 4 },
    actionText: { fontSize: 12, fontWeight: "700" },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
