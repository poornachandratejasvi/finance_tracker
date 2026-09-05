import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createPlannedItem, deletePlannedItem, updatePlannedItem } from "../../api/plannedItems";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { PlannedDirection, PlannedRecurrence } from "../../types";
import { todayIsoDate } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "PlannedItemForm">;

const DIRECTIONS: PlannedDirection[] = ["expense", "income"];
const RECURRENCES: PlannedRecurrence[] = ["none", "weekly", "monthly", "yearly"];

export default function PlannedItemFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.item;

  const [name, setName] = useState(existing?.name || "");
  const [direction, setDirection] = useState<PlannedDirection>(existing?.direction || "expense");
  const [amount, setAmount] = useState(existing?.amount ? String(existing.amount) : "");
  const [dueDate, setDueDate] = useState(existing?.due_date ? existing.due_date.slice(0, 10) : todayIsoDate());
  const [recurrence, setRecurrence] = useState<PlannedRecurrence>(existing?.recurrence || "monthly");
  const [matchHint, setMatchHint] = useState(existing?.match_hint || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!name.trim() || !dueDate.trim()) {
      Alert.alert("Missing field", "Enter a name and due date.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        direction,
        amount: amount.trim() ? parseFloat(amount) : null,
        due_date: dueDate.trim(),
        recurrence,
        match_hint: matchHint.trim() || null,
        notes: notes.trim() || null,
      };
      if (existing) await updatePlannedItem(existing.id, payload);
      else await createPlannedItem(payload);
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = () => {
    if (!existing) return;
    Alert.alert("Delete planned item?", `Remove "${existing.name}" and its history?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePlannedItem(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} autoFocus />

      <Text style={styles.label}>Direction</Text>
      <ChipRow options={DIRECTIONS} selected={direction} onSelect={(v) => setDirection(v as PlannedDirection)} />

      <Text style={styles.label}>Amount (optional)</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />

      <Text style={styles.label}>Due Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} autoCapitalize="none" />

      <Text style={styles.label}>Repeats</Text>
      <ChipRow options={RECURRENCES} selected={recurrence} onSelect={(v) => setRecurrence(v as PlannedRecurrence)} />

      <Text style={styles.label}>Match hint (optional)</Text>
      <TextInput style={styles.input} value={matchHint} onChangeText={setMatchHint} placeholder="e.g. Landlord or Netflix" placeholderTextColor={colors.textSecondary} />
      <Text style={styles.hint}>A word that should appear in the transaction description — helps auto-matching pick the right one when amounts are similar.</Text>

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Planned Item</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 6 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    multiline: { minHeight: 80, textAlignVertical: "top" },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    deleteButton: { marginTop: 14, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
