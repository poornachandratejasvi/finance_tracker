import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { listBanks } from "../api/banks";
import { listCategories } from "../api/categories";
import { createTransaction } from "../api/transactions";
import { Bank, Category, TransactionType } from "../types";
import { todayIsoDate } from "../utils/format";

export default function AddTransactionScreen() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [bankId, setBankId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [type, setType] = useState<TransactionType>("debit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [b, c] = await Promise.all([listBanks(), listCategories()]);
        setBanks(b);
        setCategories(c);
        if (b.length > 0) setBankId(b[0].id);
      } catch {
        Alert.alert("Couldn't load accounts", "Pull to refresh the Dashboard tab, then try again.");
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, []);

  const resetForm = () => {
    setAmount("");
    setDescription("");
    setCategory(null);
    setNotes("");
    setDate(todayIsoDate());
  };

  const onSubmit = async () => {
    const parsedAmount = parseFloat(amount);
    if (!bankId) {
      Alert.alert("Pick an account", "Choose which account this transaction belongs to.");
      return;
    }
    if (!description.trim()) {
      Alert.alert("Missing description", "Add a short description for this transaction.");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }

    setSubmitting(true);
    try {
      await createTransaction({
        bank_id: bankId,
        transaction_date: `${date}T12:00:00`,
        description: description.trim(),
        amount: parsedAmount,
        transaction_type: type,
        category: category || undefined,
        notes: notes.trim() || undefined,
      });
      Alert.alert("Saved", "Transaction added.");
      resetForm();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingOptions) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.segmentRow}>
          <Segment label="Expense" active={type === "debit"} onPress={() => setType("debit")} />
          <Segment label="Income" active={type === "credit"} onPress={() => setType("credit")} />
        </View>

        <Text style={styles.label}>Amount</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Swiggy dinner"
        />

        <Text style={styles.label}>Account</Text>
        {banks.length === 0 ? (
          <Text style={styles.hint}>No accounts found on the server yet.</Text>
        ) : (
          <ChipRow
            options={banks.map((b) => ({ key: b.id, label: b.name }))}
            selected={bankId}
            onSelect={(k) => setBankId(k as number)}
          />
        )}

        <Text style={styles.label}>Category (optional — auto-detected if left blank)</Text>
        <ChipRow
          options={categories.map((c) => ({ key: c.name, label: c.name }))}
          selected={category}
          onSelect={(k) => setCategory(category === k ? null : (k as string))}
        />

        <Text style={styles.label}>Date</Text>
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save Transaction</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.segment, active && styles.segmentActive]}
      onPress={onPress}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ChipRow({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ key: string | number; label: string }>;
  selected: string | number | null;
  onSelect: (key: string | number) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
      {options.map((o) => {
        const active = selected === o.key;
        return (
          <TouchableOpacity
            key={String(o.key)}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(o.key)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: "600", color: "#333", marginTop: 16, marginBottom: 6 },
  hint: { fontSize: 12, color: "#888" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#f0f0f0",
  },
  segmentActive: { backgroundColor: "#1b6b4c" },
  segmentText: { fontWeight: "600", color: "#333" },
  segmentTextActive: { color: "#fff" },
  chipRow: { flexDirection: "row" },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    marginRight: 8,
  },
  chipActive: { backgroundColor: "#1b6b4c" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  button: {
    marginTop: 28,
    backgroundColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
