import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
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

import { deleteSharedExpense, listSharedExpenses, settleSharedExpenseShare } from "../../api/sharedExpenses";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { SharedExpense } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "SharedExpenses">;

export default function SharedExpensesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [expenses, setExpenses] = useState<SharedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setExpenses(await listSharedExpenses());
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

  const settle = async (expenseId: number, shareId: number) => {
    try {
      await settleSharedExpenseShare(expenseId, shareId);
      await load();
    } catch {
      Alert.alert("Couldn't settle", "Please try again.");
    }
  };

  const remove = (expense: SharedExpense) => {
    Alert.alert("Delete expense?", expense.description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSharedExpense(expense.id);
            await load();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
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
      <FlatList
        data={expenses}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No shared expenses yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{item.description}</Text>
              <TouchableOpacity onPress={() => remove(item)}>
                <Text style={styles.deleteLink}>Delete</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.meta}>
              {formatCurrency(item.total_amount)} · paid by {item.paid_by_username} · {item.expense_date}
            </Text>
            {item.shares.map((s) => (
              <View key={s.id} style={styles.shareRow}>
                <Text style={styles.shareLabel}>{s.username} — {formatCurrency(s.amount)}</Text>
                {s.is_settled ? (
                  <Text style={styles.settledTag}>Settled</Text>
                ) : (
                  <TouchableOpacity onPress={() => settle(item.id, s.id)} style={styles.settleButton}>
                    <Text style={styles.settleButtonText}>Mark Settled</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("SharedExpenseForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Expense</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    name: { fontSize: 15, fontWeight: "700", color: c.text, flex: 1 },
    deleteLink: { fontSize: 12, color: c.danger, fontWeight: "600" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4, marginBottom: 8 },
    shareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    shareLabel: { fontSize: 13, color: c.text },
    settledTag: { fontSize: 11, fontWeight: "700", color: c.primary },
    settleButton: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: c.chipBg },
    settleButtonText: { fontSize: 11, fontWeight: "700", color: c.text },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
