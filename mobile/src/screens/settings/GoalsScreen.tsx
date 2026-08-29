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

import { listGoals } from "../../api/goals";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Goal } from "../../types";
import { formatCurrency, formatDate } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "Goals">;

export default function GoalsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setGoals(await listGoals());
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
        data={goals}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No goals yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("GoalForm", { goal: item })}>
            <View style={styles.cardHeader}>
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <Text style={styles.name}>{item.name}</Text>
              {!item.is_active && <Text style={styles.inactive}>inactive</Text>}
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${Math.min(100, item.pct)}%`, backgroundColor: item.color }]}
              />
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.meta}>
                {formatCurrency(item.current_amount)} / {formatCurrency(item.target_amount)} ({item.pct}%)
              </Text>
              {item.target_date && <Text style={styles.meta}>by {formatDate(item.target_date)}</Text>}
            </View>
            {item.monthly_target != null && (
              <Text style={[styles.monthlyBadge, item.monthly_target_met && styles.monthlyBadgeMet]}>
                {item.monthly_target_met ? "✓ " : ""}This month: {formatCurrency(item.this_month_saved ?? 0)} / {formatCurrency(item.monthly_target)}
              </Text>
            )}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("GoalForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Goal</Text>
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
    cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
    name: { fontSize: 15, fontWeight: "700", color: c.text, flex: 1 },
    inactive: { fontSize: 11, color: c.textSecondary, fontWeight: "600" },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.chipBg, overflow: "hidden" },
    progressFill: { height: 8, borderRadius: 4 },
    cardFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
    meta: { fontSize: 12, color: c.textSecondary },
    monthlyBadge: { fontSize: 12, color: c.textSecondary, marginTop: 8 },
    monthlyBadgeMet: { color: c.primary, fontWeight: "600" },
    addButton: {
      margin: 16,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
