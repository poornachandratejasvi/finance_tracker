import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { getDebtPayoffPlan, getDebtSummary } from "../../api/debt";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { DebtPayoffPlan, DebtSummary } from "../../types";
import { formatCurrency } from "../../utils/format";

export default function DebtPayoffScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [summary, setSummary] = useState<DebtSummary | null>(null);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");
  const [extraPayment, setExtraPayment] = useState("0");
  const [plan, setPlan] = useState<DebtPayoffPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          setSummary(await getDebtSummary());
        } catch {
          setSummary(null);
        }
        setLoading(false);
      })();
    }, [])
  );

  useEffect(() => {
    if (!summary?.debts.length) return;
    getDebtPayoffPlan(strategy, parseFloat(extraPayment) || 0)
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [summary, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  const recalc = () => {
    getDebtPayoffPlan(strategy, parseFloat(extraPayment) || 0).then(setPlan).catch(() => setPlan(null));
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!summary?.debts.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>
          No credit cards or loans with an outstanding balance found. Set account type to "Credit
          Card" or "Loan" (with a balance) in Banks to track it here.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      {summary.missing_interest_rate.length > 0 && (
        <View style={styles.infoBanner}>
          <Text style={styles.infoText}>
            No interest rate set for: {summary.missing_interest_rate.join(", ")} — the plan still
            runs, but ordering/interest figures improve once you add rates in Banks.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Your debts</Text>
      {summary.debts.map((d) => (
        <View key={d.bank_id} style={styles.debtRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.debtName}>{d.name}</Text>
            <Text style={styles.debtMeta}>
              {d.interest_rate != null ? `${d.interest_rate}% APR` : "rate not set"} · min{" "}
              {formatCurrency(d.minimum_payment)}
              {d.minimum_payment_is_estimated ? " (est.)" : ""}
            </Text>
          </View>
          <Text style={styles.debtBalance}>{formatCurrency(d.balance)}</Text>
        </View>
      ))}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalLabel}>{formatCurrency(summary.total_balance)}</Text>
      </View>

      <View style={styles.strategyRow}>
        <TouchableOpacity
          style={[styles.strategyChip, strategy === "avalanche" && styles.strategyChipActive]}
          onPress={() => setStrategy("avalanche")}
        >
          <Text style={[styles.strategyChipText, strategy === "avalanche" && styles.strategyChipTextActive]}>
            Avalanche (least interest)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.strategyChip, strategy === "snowball" && styles.strategyChipActive]}
          onPress={() => setStrategy("snowball")}
        >
          <Text style={[styles.strategyChipText, strategy === "snowball" && styles.strategyChipTextActive]}>
            Snowball (quick wins)
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Extra monthly payment</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={extraPayment}
          onChangeText={setExtraPayment}
          keyboardType="decimal-pad"
        />
        <TouchableOpacity style={styles.recalcButton} onPress={recalc}>
          <Text style={styles.recalcButtonText}>Recalculate</Text>
        </TouchableOpacity>
      </View>

      {plan && (
        <>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.debtMeta}>Debt-free in</Text>
              <Text style={styles.summaryValue}>{plan.months != null ? `${plan.months} mo` : "30+ yrs"}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.debtMeta}>Total interest</Text>
              <Text style={[styles.summaryValue, { color: colors.danger }]}>{formatCurrency(plan.total_interest)}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Payoff order</Text>
          {plan.schedule.map((s, i) => (
            <View key={s.bank_id} style={styles.scheduleRow}>
              <Text style={styles.debtName}>{i + 1}. {s.name}</Text>
              <Text style={styles.debtMeta}>{s.payoff_month ? `paid off month ${s.payoff_month}` : "beyond horizon"}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background, padding: 24 },
    container: { padding: 16, paddingBottom: 48 },
    empty: { color: c.textSecondary, textAlign: "center" },
    infoBanner: { backgroundColor: c.chipBg, borderRadius: 8, padding: 10, marginBottom: 16 },
    infoText: { color: c.textSecondary, fontSize: 12 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 8, marginTop: 8 },
    debtRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
    debtName: { color: c.text, fontSize: 14, fontWeight: "600" },
    debtMeta: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
    debtBalance: { color: c.danger, fontSize: 14, fontWeight: "700" },
    totalRow: {
      flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    totalLabel: { color: c.text, fontWeight: "700" },
    strategyRow: { flexDirection: "row", gap: 8, marginTop: 20, marginBottom: 12 },
    strategyChip: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center", backgroundColor: c.chipBg },
    strategyChipActive: { backgroundColor: c.primary },
    strategyChipText: { color: c.text, fontSize: 12, fontWeight: "600", textAlign: "center" },
    strategyChipTextActive: { color: "#fff" },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginBottom: 6 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    recalcButton: { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 16, justifyContent: "center" },
    recalcButtonText: { color: "#fff", fontWeight: "600" },
    summaryRow: {
      flexDirection: "row", justifyContent: "space-between", marginTop: 20, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    summaryValue: { fontSize: 18, fontWeight: "800", color: c.text },
    scheduleRow: { paddingVertical: 6 },
  });
