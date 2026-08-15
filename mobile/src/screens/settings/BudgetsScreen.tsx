import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { getBudgetsConfig, getBudgetStatus, saveBudgetsConfig } from "../../api/budgets";
import { listCategories } from "../../api/categories";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { Budget, BudgetStatus, Category } from "../../types";
import { formatCurrency } from "../../utils/format";

interface EditableBudget extends Budget {
  key: string;
}

export default function BudgetsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<EditableBudget[]>([]);
  const [alertEmail, setAlertEmail] = useState("");
  const [discordAlerts, setDiscordAlerts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [config, budgetStatus, cats] = await Promise.all([
        getBudgetsConfig(),
        getBudgetStatus(),
        listCategories(),
      ]);
      setBudgets(config.budgets.map((b, i) => ({ ...b, key: `${b.category}-${i}` })));
      setAlertEmail(config.alert_email || "");
      setDiscordAlerts(config.discord_alerts);
      setStatus(budgetStatus);
      setCategories(cats);
    } catch {
      // keep prior state; pull-to-refresh can retry
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

  const addRow = () => {
    const firstUnused = categories.find((c) => !budgets.some((b) => b.category === c.name));
    setBudgets((prev) => [
      ...prev,
      { key: `${Date.now()}`, category: firstUnused?.name || "", monthly_limit: 0, alert_at_pct: 80 },
    ]);
  };

  const updateRow = (key: string, patch: Partial<Budget>) => {
    setBudgets((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  };

  const removeRow = (key: string) => {
    setBudgets((prev) => prev.filter((b) => b.key !== key));
  };

  const onSave = async () => {
    const cleaned = budgets
      .filter((b) => b.category.trim() && b.monthly_limit > 0)
      .map(({ category, monthly_limit, alert_at_pct }) => ({ category, monthly_limit, alert_at_pct }));
    setSaving(true);
    try {
      await saveBudgetsConfig(cleaned, alertEmail.trim() || undefined, discordAlerts);
      await load();
      Alert.alert("Saved", "Budgets updated.");
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    } finally {
      setSaving(false);
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
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {status && status.budgets.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{status.period} spend</Text>
          {status.budgets.map((b) => {
            const barColor = b.over ? colors.danger : b.pct >= 80 ? colors.warning : colors.primary;
            return (
              <View key={b.id} style={styles.statusRow}>
                <View style={styles.statusHeader}>
                  <Text style={styles.statusCategory}>{b.category}</Text>
                  <Text style={styles.statusAmounts}>
                    {formatCurrency(b.spent)} / {formatCurrency(b.monthly_limit)}
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.min(100, b.pct)}%`, backgroundColor: barColor },
                    ]}
                  />
                </View>
              </View>
            );
          })}
          <Text style={styles.meta}>
            Total: {formatCurrency(status.total_spent)} / {formatCurrency(status.total_limit)}
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Monthly limits</Text>
        {budgets.map((b) => (
          <View key={b.key} style={styles.editRow}>
            <View style={styles.chipRow}>
              {categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, b.category === c.name && styles.chipActive]}
                  onPress={() => updateRow(b.key, { category: c.name })}
                >
                  <Text style={[styles.chipText, b.category === c.name && styles.chipTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.editInputsRow}>
              <TextInput
                style={[styles.input, styles.editInput]}
                value={b.monthly_limit ? String(b.monthly_limit) : ""}
                onChangeText={(v) => updateRow(b.key, { monthly_limit: parseFloat(v) || 0 })}
                keyboardType="decimal-pad"
                placeholder="Limit"
                placeholderTextColor={colors.textSecondary}
              />
              <TextInput
                style={[styles.input, styles.editInput]}
                value={String(b.alert_at_pct)}
                onChangeText={(v) => updateRow(b.key, { alert_at_pct: parseInt(v, 10) || 0 })}
                keyboardType="number-pad"
                placeholder="Alert %"
                placeholderTextColor={colors.textSecondary}
              />
              <TouchableOpacity onPress={() => removeRow(b.key)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.smallButtonOutline} onPress={addRow}>
          <Text style={styles.smallButtonOutlineText}>+ Add Category Budget</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.label}>Discord alerts</Text>
          <Switch value={discordAlerts} onValueChange={setDiscordAlerts} />
        </View>
      </View>

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={onSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Budgets</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 10 },
    statusRow: { marginBottom: 12 },
    statusHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    statusCategory: { fontSize: 13, color: c.text, fontWeight: "600" },
    statusAmounts: { fontSize: 12, color: c.textSecondary },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.chipBg, overflow: "hidden" },
    progressFill: { height: 8, borderRadius: 4 },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    editRow: { marginBottom: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 12 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    editInputsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
    },
    editInput: { flex: 1 },
    removeText: { color: c.danger, fontWeight: "600", fontSize: 12 },
    smallButtonOutline: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    label: { fontSize: 13, fontWeight: "600", color: c.text },
    button: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });
