import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createSharedExpense, listHouseholdMembers } from "../../api/sharedExpenses";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { HouseholdMember } from "../../types";
import { todayIsoDate } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "SharedExpenseForm">;

export default function SharedExpenseFormScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIsoDate());
  const [customSplits, setCustomSplits] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listHouseholdMembers().then(setMembers).catch(() => setMembers([]));
    }, [])
  );

  const evenSplit = useMemo(() => {
    const amt = parseFloat(totalAmount);
    if (!amt || !members.length) return "";
    return (amt / members.length).toFixed(2);
  }, [totalAmount, members.length]);

  const onSave = async () => {
    const amt = parseFloat(totalAmount);
    if (!description.trim() || !amt || !expenseDate.trim()) {
      Alert.alert("Missing field", "Enter a description, amount, and date.");
      return;
    }
    if (!members.length) {
      Alert.alert("No household members", "You need at least one other person in your household to split with.");
      return;
    }
    setSubmitting(true);
    try {
      const splits = members.map((m) => ({
        user_id: m.id,
        amount: parseFloat(customSplits[m.id] || evenSplit || "0"),
      }));
      await createSharedExpense({ description: description.trim(), total_amount: amt, expense_date: expenseDate.trim(), splits });
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Check that the splits add up to the total.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.label}>Description</Text>
      <TextInput style={styles.input} value={description} onChangeText={setDescription} autoFocus />

      <Text style={styles.label}>Total Amount</Text>
      <TextInput style={styles.input} value={totalAmount} onChangeText={setTotalAmount} keyboardType="decimal-pad" />

      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={expenseDate} onChangeText={setExpenseDate} autoCapitalize="none" />

      <Text style={styles.sectionTitle}>Split (defaults to even — edit any to customize)</Text>
      {members.map((m) => (
        <React.Fragment key={m.id}>
          <Text style={styles.label}>{m.username}</Text>
          <TextInput
            style={styles.input}
            value={customSplits[m.id] !== undefined ? customSplits[m.id] : evenSplit}
            onChangeText={(v) => setCustomSplits({ ...customSplits, [m.id]: v })}
            keyboardType="decimal-pad"
          />
        </React.Fragment>
      ))}

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
    sectionTitle: { fontSize: 14, fontWeight: "700", color: c.text, marginTop: 20 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });
