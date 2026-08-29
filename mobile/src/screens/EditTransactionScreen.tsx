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
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";

import { listCategories } from "../api/categories";
import { updateTransaction, deleteTransaction } from "../api/transactions";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { Category, TransactionType } from "../types";
import { getCachedCategories, deleteCachedTransaction, upsertTransactions } from "../offline/db";
import { RootStackParamList } from "../navigation/RootNavigator";

type EditRouteProp = RouteProp<RootStackParamList, "EditTransaction">;

export default function EditTransactionScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const route = useRoute<EditRouteProp>();
  const navigation = useNavigation();
  const { transaction } = route.params;

  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<TransactionType>(transaction.transaction_type);
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [description, setDescription] = useState(transaction.description);
  const [category, setCategory] = useState<string | null>(transaction.category);
  const [date, setDate] = useState(transaction.transaction_date.slice(0, 10));
  const [notes, setNotes] = useState(transaction.notes || "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setCategories(await listCategories());
      } catch {
        setCategories(await getCachedCategories());
      }
    })();
  }, []);

  const numericId = typeof transaction.id === "number" ? transaction.id : null;

  const onSave = async () => {
    const parsedAmount = parseFloat(amount);
    if (!description.trim()) {
      Alert.alert("Missing description", "Add a short description for this transaction.");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }
    if (!numericId) {
      Alert.alert("Can't edit yet", "This transaction hasn't finished syncing -- try again once it's synced.");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateTransaction(numericId, {
        description: description.trim(),
        amount: parsedAmount,
        transaction_type: type,
        category: category || undefined,
        notes: notes.trim() || undefined,
        transaction_date: `${date}T12:00:00`,
      });
      upsertTransactions([updated]).catch(() => {});
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = () => {
    if (!numericId) {
      Alert.alert("Can't delete yet", "This transaction hasn't finished syncing -- try again once it's synced.");
      return;
    }
    Alert.alert("Delete transaction?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteTransaction(numericId);
            deleteCachedTransaction(transaction.id).catch(() => {});
            navigation.goBack();
          } catch (err: any) {
            const detail = err?.response?.data?.detail;
            Alert.alert("Couldn't delete", typeof detail === "string" ? detail : "Please try again.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
          placeholderTextColor={colors.textSecondary}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={styles.label}>Account</Text>
        <Text style={styles.hint}>{transaction.bank_name || "External"} (can't be changed here)</Text>

        <Text style={styles.label}>Category</Text>
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
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting || deleting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Changes</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.deleteButton, deleting && styles.buttonDisabled]} onPress={onDelete} disabled={submitting || deleting}>
          {deleting ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.deleteButtonText}>Delete Transaction</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={[styles.segment, active && styles.segmentActive]} onPress={onPress}>
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
      {options.map((o) => {
        const active = selected === o.key;
        return (
          <TouchableOpacity key={String(o.key)} style={[styles.chip, active && styles.chipActive]} onPress={() => onSelect(o.key)}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 16, marginBottom: 6 },
    hint: { fontSize: 13, color: c.textSecondary, paddingVertical: 8 },
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
    segmentRow: { flexDirection: "row", gap: 8, marginTop: 4 },
    segment: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center", backgroundColor: c.chipBg },
    segmentActive: { backgroundColor: c.primary },
    segmentText: { fontWeight: "600", color: c.text },
    segmentTextActive: { color: "#fff" },
    chipRow: { flexDirection: "row" },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg, marginRight: 8 },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    deleteButton: {
      marginTop: 12,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.danger,
    },
    deleteButtonText: { color: c.danger, fontSize: 16, fontWeight: "600" },
  });
