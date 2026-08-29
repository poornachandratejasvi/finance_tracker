import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { listLabels, bulkLabelTransactions } from "../api/labels";
import { createAutoRule } from "../api/autoRules";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { Category, Label, TransactionType } from "../types";
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
  const [mode, setMode] = useState<"expense" | "income" | "transfer">(
    transaction.category === "Transfer" ? "transfer" : transaction.transaction_type === "credit" ? "income" : "expense"
  );
  const type: TransactionType = mode === "income" ? "credit" : "debit";
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [description, setDescription] = useState(transaction.description);
  const [category, setCategory] = useState<string | null>(transaction.category);
  const [date, setDate] = useState(transaction.transaction_date.slice(0, 10));
  const [notes, setNotes] = useState(transaction.notes || "");
  const [fromAccount, setFromAccount] = useState(transaction.from_account || "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [originalLabelIds, setOriginalLabelIds] = useState<number[]>([]);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleKeywordInput, setRuleKeywordInput] = useState("");
  const [ruleKeywords, setRuleKeywords] = useState<string[]>([]);
  const [ruleSaving, setRuleSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setCategories(await listCategories());
      } catch {
        setCategories(await getCachedCategories());
      }
    })();
    (async () => {
      try {
        const all = await listLabels();
        setLabels(all);
        const existingNames = new Set(transaction.labels || []);
        const ids = all.filter((l) => existingNames.has(l.name)).map((l) => l.id);
        setSelectedLabelIds(ids);
        setOriginalLabelIds(ids);
      } catch {
        // labels are optional -- if this fails, editing still works without them
      }
    })();
  }, []);

  const toggleLabel = (id: number) => {
    setSelectedLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Add-only: apply labels selected but not already on the record (matches web's syncLabels -- no remove endpoint).
  const syncLabels = async (id: number) => {
    const orig = new Set(originalLabelIds);
    const toAdd = selectedLabelIds.filter((x) => !orig.has(x));
    for (const labelId of toAdd) {
      // eslint-disable-next-line no-await-in-loop
      await bulkLabelTransactions([id], labelId);
    }
  };

  const addRuleKeyword = () => {
    const kw = ruleKeywordInput.trim();
    if (!kw) return;
    if (!ruleKeywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
      setRuleKeywords((prev) => [...prev, kw]);
    }
    setRuleKeywordInput("");
  };

  const removeRuleKeyword = (kw: string) => {
    setRuleKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const openRuleDialog = () => {
    setRuleKeywords(description.trim() ? [description.trim().split(" ").slice(0, 2).join(" ")] : []);
    setRuleKeywordInput("");
    setRuleOpen(true);
  };

  const onCreateRule = async () => {
    const kws = ruleKeywords.map((k) => k.trim()).filter(Boolean);
    if (ruleKeywordInput.trim()) kws.push(ruleKeywordInput.trim());
    const uniqueKws = Array.from(new Set(kws));
    if (!uniqueKws.length) {
      Alert.alert("Add a keyword", "Enter at least one keyword to match on.");
      return;
    }
    setRuleSaving(true);
    try {
      await createAutoRule({
        name: `${uniqueKws[0]} → ${category || "Uncategorized"}`,
        keywords: uniqueKws,
        record_type: mode === "income" ? "credit" : mode === "transfer" ? "transfer" : "debit",
        category: category || undefined,
        label_ids: selectedLabelIds,
      });
      setRuleOpen(false);
      Alert.alert("Rule created", `Future records matching ${uniqueKws.length} keyword(s) will be set to ${category || "this category"}.`);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't create rule", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setRuleSaving(false);
    }
  };

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
        from_account: mode === "transfer" ? fromAccount.trim() || undefined : undefined,
      });
      await syncLabels(numericId).catch(() => {});
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
          <Segment label="Expense" active={mode === "expense"} onPress={() => setMode("expense")} />
          <Segment label="Income" active={mode === "income"} onPress={() => setMode("income")} />
          <Segment
            label="Transfer"
            active={mode === "transfer"}
            onPress={() => {
              setMode("transfer");
              if (!category) setCategory("Transfer");
            }}
          />
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

        {mode === "transfer" && (
          <>
            <Text style={styles.label}>From Account (optional)</Text>
            <TextInput
              style={styles.input}
              value={fromAccount}
              onChangeText={setFromAccount}
              placeholder="e.g. Savings Account"
              placeholderTextColor={colors.textSecondary}
            />
          </>
        )}

        <Text style={styles.label}>Category</Text>
        <ChipRow
          options={categories.map((c) => ({ key: c.name, label: c.name }))}
          selected={category}
          onSelect={(k) => setCategory(category === k ? null : (k as string))}
        />

        {labels.length > 0 && (
          <>
            <Text style={styles.label}>Labels</Text>
            <View style={styles.labelWrap}>
              {labels.map((l) => {
                const active = selectedLabelIds.includes(l.id);
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.chip, active && { backgroundColor: l.color || colors.primary }]}
                    onPress={() => toggleLabel(l.id)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{l.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

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

        <TouchableOpacity style={styles.ruleButton} onPress={openRuleDialog}>
          <Text style={styles.ruleButtonText}>✨ New automatic rule from record</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting || deleting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Changes</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.deleteButton, deleting && styles.buttonDisabled]} onPress={onDelete} disabled={submitting || deleting}>
          {deleting ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.deleteButtonText}>Delete Transaction</Text>}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={ruleOpen} animationType="slide" transparent onRequestClose={() => setRuleOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New automatic rule</Text>
            <Text style={styles.hint}>
              Future records whose description contains any of these keywords will be set to{" "}
              <Text style={{ fontWeight: "700" }}>{category || "—"}</Text>
              {selectedLabelIds.length ? ` + ${selectedLabelIds.length} label(s)` : ""}.
            </Text>

            <View style={styles.labelWrap}>
              {ruleKeywords.map((kw) => (
                <TouchableOpacity key={kw} style={styles.keywordChip} onPress={() => removeRuleKeyword(kw)}>
                  <Text style={styles.keywordChipText}>{kw} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.ruleInputRow}>
              <TextInput
                style={[styles.input, styles.ruleInput]}
                value={ruleKeywordInput}
                onChangeText={setRuleKeywordInput}
                placeholder="Add a keyword"
                placeholderTextColor={colors.textSecondary}
                onSubmitEditing={addRuleKeyword}
              />
              <TouchableOpacity style={styles.addKeywordButton} onPress={addRuleKeyword}>
                <Text style={styles.buttonText}>Add</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setRuleOpen(false)} disabled={ruleSaving}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.modalCreateButton, ruleSaving && styles.buttonDisabled]}
                onPress={onCreateRule}
                disabled={ruleSaving}
              >
                {ruleSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Rule</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    labelWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    ruleButton: { marginTop: 20, alignItems: "center", paddingVertical: 6 },
    ruleButtonText: { color: c.primary, fontSize: 14, fontWeight: "600" },
    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    modalCard: {
      backgroundColor: c.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 20,
      paddingBottom: 32,
    },
    modalTitle: { fontSize: 17, fontWeight: "700", color: c.text, marginBottom: 8 },
    keywordChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: c.chipBg },
    keywordChipText: { color: c.text, fontSize: 13, fontWeight: "600" },
    ruleInputRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    ruleInput: { flex: 1 },
    addKeywordButton: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingHorizontal: 18,
      justifyContent: "center",
      alignItems: "center",
    },
    modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
    modalCancelButton: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: 8, borderWidth: 1, borderColor: c.inputBorder },
    modalCancelText: { color: c.text, fontSize: 15, fontWeight: "600" },
    modalCreateButton: { flex: 1, marginTop: 0 },
  });
