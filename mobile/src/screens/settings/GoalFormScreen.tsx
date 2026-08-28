import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createGoal, deleteGoal, sweepRoundups, updateGoal } from "../../api/goals";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { todayIsoDate } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "GoalForm">;

const COLORS = ["#4e79a7", "#1b6b4c", "#b3261e", "#b8860b", "#7d3fc4", "#008080"];

export default function GoalFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.goal;

  const [name, setName] = useState(existing?.name || "");
  const [targetAmount, setTargetAmount] = useState(existing ? String(existing.target_amount) : "");
  const [currentAmount, setCurrentAmount] = useState(existing ? String(existing.current_amount) : "0");
  const [targetDate, setTargetDate] = useState(existing?.target_date?.slice(0, 10) || "");
  const [color, setColor] = useState(existing?.color || COLORS[0]);
  const [isActive, setIsActive] = useState(existing?.is_active !== false);
  const [roundupEnabled, setRoundupEnabled] = useState(existing?.roundup_enabled || false);
  const [roundupTo, setRoundupTo] = useState(existing?.roundup_to || 10);
  const [submitting, setSubmitting] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  const onSave = async () => {
    if (!name.trim() || !targetAmount) {
      Alert.alert("Missing fields", "Give the goal a name and a target amount.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        target_amount: parseFloat(targetAmount),
        current_amount: currentAmount ? parseFloat(currentAmount) : 0,
        target_date: targetDate.trim() || null,
        color,
        is_active: isActive,
        roundup_enabled: roundupEnabled,
        roundup_to: roundupTo,
      };
      if (existing) {
        await updateGoal(existing.id, payload);
      } else {
        await createGoal(payload);
      }
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSweep = async () => {
    if (!existing) return;
    setSweeping(true);
    try {
      const result = await sweepRoundups(existing.id);
      Alert.alert(
        "Round-up swept",
        result.swept_amount > 0
          ? `Added ₹${result.swept_amount.toFixed(2)} from ${result.transaction_count} transaction(s).`
          : "No new spare change to sweep right now."
      );
      navigation.goBack();
    } catch {
      Alert.alert("Couldn't sweep", "Please try again.");
    } finally {
      setSweeping(false);
    }
  };

  const onDelete = () => {
    if (!existing) return;
    Alert.alert("Delete goal?", `Remove "${existing.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteGoal(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Emergency Fund"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Target amount</Text>
      <TextInput
        style={styles.input}
        value={targetAmount}
        onChangeText={setTargetAmount}
        keyboardType="decimal-pad"
        placeholder="100000"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Current amount</Text>
      <TextInput
        style={styles.input}
        value={currentAmount}
        onChangeText={setCurrentAmount}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Target date (optional, YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={targetDate}
        onChangeText={setTargetDate}
        placeholder={todayIsoDate()}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Color</Text>
      <View style={styles.chipRow}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
            onPress={() => setColor(c)}
          />
        ))}
      </View>

      {existing && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>Active</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>Round-up savings</Text>
        <Switch value={roundupEnabled} onValueChange={setRoundupEnabled} />
      </View>
      {roundupEnabled && (
        <>
          <Text style={styles.hint}>
            Round each expense up and sweep the spare change here. Only one goal at a time can
            claim the backlog — sweeping consumes it.
          </Text>
          <Text style={styles.label}>Round up to nearest</Text>
          <View style={styles.chipRow}>
            {[10, 50, 100].map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.roundupChip, roundupTo === v && styles.roundupChipActive]}
                onPress={() => setRoundupTo(v)}
              >
                <Text style={[styles.roundupChipText, roundupTo === v && styles.roundupChipTextActive]}>₹{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {existing && (
            <TouchableOpacity style={[styles.sweepButton, sweeping && styles.buttonDisabled]} onPress={onSweep} disabled={sweeping}>
              {sweeping ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.sweepButtonText}>Sweep Now</Text>}
            </TouchableOpacity>
          )}
        </>
      )}

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Goal</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 16, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    swatch: { width: 32, height: 32, borderRadius: 16 },
    swatchActive: { borderWidth: 3, borderColor: c.text },
    hint: { fontSize: 12, color: c.textSecondary, marginTop: 4, marginBottom: 8, lineHeight: 17 },
    roundupChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    roundupChipActive: { backgroundColor: c.primary },
    roundupChipText: { color: c.text, fontSize: 13, fontWeight: "600" },
    roundupChipTextActive: { color: "#fff" },
    sweepButton: {
      marginTop: 16, borderWidth: 1, borderColor: c.primary, borderRadius: 8,
      paddingVertical: 12, alignItems: "center",
    },
    sweepButtonText: { color: c.primary, fontSize: 14, fontWeight: "600" },
    switchRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 8,
    },
    button: {
      marginTop: 28,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    deleteButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
