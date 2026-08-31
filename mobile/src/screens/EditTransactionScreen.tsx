import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { useOffline } from "../offline/OfflineProvider";
import { queueOfflineUpdate, queueOfflineDelete } from "../offline/syncEngine";
import { RootStackParamList } from "../navigation/RootNavigator";
import TypeSegmentedControl, { TxnMode } from "../components/TypeSegmentedControl";
import { FormGroup, FormSectionHeader } from "../components/FormGroup";
import { PickerRow } from "../components/PickerRow";
import NumericKeypad from "../components/NumericKeypad";
import SelectModal from "../components/SelectModal";
import TextPromptModal from "../components/TextPromptModal";

type EditRouteProp = RouteProp<RootStackParamList, "EditTransaction">;

export default function EditTransactionScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const route = useRoute<EditRouteProp>();
  const navigation = useNavigation();
  const { transaction } = route.params;
  const { isOnline } = useOffline();

  const [categories, setCategories] = useState<Category[]>([]);
  const [mode, setMode] = useState<TxnMode>(
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

  const [showKeypad, setShowKeypad] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(date);
  const [fromAccountModalOpen, setFromAccountModalOpen] = useState(false);
  const [fromAccountDraft, setFromAccountDraft] = useState("");

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

    const payload = {
      description: description.trim(),
      amount: parsedAmount,
      transaction_type: type,
      category: category || undefined,
      notes: notes.trim() || undefined,
      transaction_date: `${date}T12:00:00`,
      from_account: mode === "transfer" ? fromAccount.trim() || undefined : undefined,
    };

    setSubmitting(true);
    try {
      // Skip the network attempt entirely when already known offline --
      // avoids hanging on a flaky-but-technically-online axios timeout.
      if (!isOnline) {
        await queueOfflineUpdate(numericId, payload);
        await syncLabels(numericId).catch(() => {});
        Alert.alert("Saved offline", "Will sync once you're back online.");
        navigation.goBack();
        return;
      }
      const updated = await updateTransaction(numericId, payload);
      await syncLabels(numericId).catch(() => {});
      upsertTransactions([updated]).catch(() => {});
      navigation.goBack();
    } catch (err: any) {
      if (!err?.response) {
        // No server response at all -- a genuine network failure (not a
        // validation rejection), so it's safe to queue and retry later.
        await queueOfflineUpdate(numericId, payload);
        await syncLabels(numericId).catch(() => {});
        Alert.alert("Saved offline", "Will sync once you're back online.");
        navigation.goBack();
        return;
      }
      const detail = err.response?.data?.detail;
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
            if (!isOnline) {
              await queueOfflineDelete(numericId);
              Alert.alert("Deleted offline", "Will sync once you're back online.");
              navigation.goBack();
              return;
            }
            await deleteTransaction(numericId);
            deleteCachedTransaction(transaction.id).catch(() => {});
            navigation.goBack();
          } catch (err: any) {
            if (!err?.response) {
              await queueOfflineDelete(numericId);
              Alert.alert("Deleted offline", "Will sync once you're back online.");
              navigation.goBack();
              return;
            }
            const detail = err?.response?.data?.detail;
            Alert.alert("Couldn't delete", typeof detail === "string" ? detail : "Please try again.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const onDigit = (d: string) => setAmount((prev) => (prev === "0" ? d : prev + d));
  const onDecimal = () => setAmount((prev) => (prev.includes(".") ? prev : `${prev || "0"}.`));
  const onBackspace = () => setAmount((prev) => prev.slice(0, -1));

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TypeSegmentedControl
          mode={mode}
          onChange={(m) => {
            setMode(m);
            if (m === "transfer" && !category) setCategory("Transfer");
          }}
        />

        <TouchableOpacity
          activeOpacity={1}
          style={styles.amountCard}
          onPress={() => {
            Keyboard.dismiss();
            setShowKeypad(true);
          }}
        >
          <Text style={styles.currencyTag}>Amount</Text>
          <Text style={[styles.amountText, { color: mode === "income" ? colors.primary : colors.danger }]}>
            {mode === "income" ? "+" : "-"}
            {amount || "0"}
          </Text>
        </TouchableOpacity>

        <TextInput
          style={styles.descriptionInput}
          value={description}
          onChangeText={setDescription}
          placeholder="Description"
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setShowKeypad(false)}
        />

        <FormSectionHeader title="General" />
        <FormGroup>
          <PickerRow icon="card-outline" label="Account" value={transaction.bank_name || "External"} />
          <PickerRow
            icon="pricetag-outline"
            label="Category"
            value={category}
            placeholder="Auto-detect"
            onPress={() => {
              Keyboard.dismiss();
              setCategoryModalOpen(true);
            }}
          />
          <PickerRow
            icon="calendar-outline"
            label="Date & Time"
            value={date}
            onPress={() => {
              Keyboard.dismiss();
              setDateDraft(date);
              setDateModalOpen(true);
            }}
          />
          {mode === "transfer" && (
            <PickerRow
              icon="swap-horizontal-outline"
              label="From Account"
              value={fromAccount || null}
              placeholder="Optional"
              onPress={() => {
                Keyboard.dismiss();
                setFromAccountDraft(fromAccount);
                setFromAccountModalOpen(true);
              }}
            />
          )}
        </FormGroup>

        {labels.length > 0 && (
          <>
            <FormSectionHeader title="Labels" />
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

        <FormSectionHeader title="More detail" />
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.textSecondary}
          multiline
          onFocus={() => setShowKeypad(false)}
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

      {showKeypad && <NumericKeypad onDigit={onDigit} onDecimal={onDecimal} onBackspace={onBackspace} onClear={() => setAmount("")} />}

      <SelectModal
        visible={categoryModalOpen}
        title="Category"
        options={categories.map((c) => ({ key: c.name, label: c.name, color: c.color || undefined }))}
        selectedKey={category}
        onSelect={(k) => setCategory(k as string | null)}
        onClose={() => setCategoryModalOpen(false)}
        allowClear
      />
      <TextPromptModal
        visible={dateModalOpen}
        title="Date"
        value={dateDraft}
        onChangeValue={setDateDraft}
        onSave={() => setDate(dateDraft.trim() || date)}
        onClose={() => setDateModalOpen(false)}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
      />
      <TextPromptModal
        visible={fromAccountModalOpen}
        title="From Account"
        value={fromAccountDraft}
        onChangeValue={setFromAccountDraft}
        onSave={() => setFromAccount(fromAccountDraft.trim())}
        onClose={() => setFromAccountModalOpen(false)}
        placeholder="e.g. Savings Account"
      />

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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 24 },
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
    amountCard: { alignItems: "center", paddingVertical: 20 },
    currencyTag: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textSecondary,
      backgroundColor: c.chipBg,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 12,
      marginBottom: 8,
      overflow: "hidden",
    },
    amountText: { fontSize: 44, fontWeight: "700" },
    descriptionInput: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      marginBottom: 4,
    },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg, marginRight: 8, marginBottom: 8 },
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
