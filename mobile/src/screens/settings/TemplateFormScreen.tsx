import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { listBanks } from "../../api/banks";
import { listLabels } from "../../api/labels";
import { createTemplate, deleteTemplate, updateTemplate } from "../../api/templates";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Bank, Label } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "TemplateForm">;

export default function TemplateFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.template;

  const [name, setName] = useState(existing?.name || "");
  const [bankId, setBankId] = useState<number | null>(existing?.bank_id ?? null);
  const [category, setCategory] = useState(existing?.category || "");
  const [amount, setAmount] = useState(existing?.amount != null ? String(existing.amount) : "");
  const [transactionType, setTransactionType] = useState(existing?.transaction_type || "debit");
  const [description, setDescription] = useState(existing?.description || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [labelIds, setLabelIds] = useState<number[]>(existing?.label_ids || []);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listBanks().then(setBanks).catch(() => {});
    listLabels().then(setLabels).catch(() => {});
  }, []);

  const toggleLabel = (id: number) => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Give this template a name.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        bank_id: bankId,
        category: category.trim() || undefined,
        amount: amount ? parseFloat(amount) : undefined,
        transaction_type: transactionType,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        label_ids: labelIds,
      };
      if (existing) {
        await updateTemplate(existing.id, payload);
      } else {
        await createTemplate(payload);
      }
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
    Alert.alert("Delete template?", `Remove "${existing.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTemplate(existing.id);
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
        placeholder="e.g. Monthly rent"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.chipRow}>
        {["debit", "credit"].map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, transactionType === t && styles.chipActive]}
            onPress={() => setTransactionType(t)}
          >
            <Text style={[styles.chipText, transactionType === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Rent payment"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Amount (optional)</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />

      <Text style={styles.label}>Category (optional)</Text>
      <TextInput
        style={styles.input}
        value={category}
        onChangeText={setCategory}
        placeholder="Housing"
        placeholderTextColor={colors.textSecondary}
      />

      {banks.length > 0 && (
        <>
          <Text style={styles.label}>Account (optional)</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, bankId === null && styles.chipActive]}
              onPress={() => setBankId(null)}
            >
              <Text style={[styles.chipText, bankId === null && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
            {banks.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={[styles.chip, bankId === b.id && styles.chipActive]}
                onPress={() => setBankId(b.id)}
              >
                <Text style={[styles.chipText, bankId === b.id && styles.chipTextActive]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {labels.length > 0 && (
        <>
          <Text style={styles.label}>Labels (optional)</Text>
          <View style={styles.chipRow}>
            {labels.map((l) => (
              <TouchableOpacity
                key={l.id}
                style={[styles.chip, labelIds.includes(l.id) && { backgroundColor: l.color }]}
                onPress={() => toggleLabel(l.id)}
              >
                <Text style={[styles.chipText, labelIds.includes(l.id) && styles.chipTextActive]}>
                  {l.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Template</Text>
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
    multiline: { minHeight: 70, textAlignVertical: "top" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13, textTransform: "capitalize" },
    chipTextActive: { color: "#fff", fontWeight: "600" },
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
