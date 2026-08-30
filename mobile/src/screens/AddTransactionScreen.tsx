import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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

import { listBanks } from "../api/banks";
import { listCategories } from "../api/categories";
import { createTransaction } from "../api/transactions";
import { attachReceipt } from "../api/receipts";
import { quickAddParse } from "../api/ai";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { Bank, Category, TransactionType } from "../types";
import { todayIsoDate } from "../utils/format";
import { getCachedBanks, getCachedCategories, upsertTransactions } from "../offline/db";
import { queueOfflineTransaction } from "../offline/syncEngine";
import { useOffline } from "../offline/OfflineProvider";
import { RootStackParamList } from "../navigation/RootNavigator";
import TypeSegmentedControl, { TxnMode } from "../components/TypeSegmentedControl";
import { FormGroup, FormSectionHeader } from "../components/FormGroup";
import { PickerRow } from "../components/PickerRow";
import NumericKeypad from "../components/NumericKeypad";
import SelectModal from "../components/SelectModal";
import TextPromptModal from "../components/TextPromptModal";

export interface ReceiptPrefill {
  amount?: number;
  description?: string | null;
  transaction_date?: string | null;
  category?: string | null;
  items?: { name: string; amount: number }[];
  tax?: number | null;
  tip?: number | null;
  photoUri?: string | null; // carried through so the original photo can be archived to Paperless-ngx on save
}

// Formats a scanned receipt's line items (with tax/tip split proportionally
// across items by their share of the subtotal) into readable notes text --
// no new DB schema for line items, just a readable breakdown alongside the
// transaction like any other manual note.
function formatReceiptNotes(items?: { name: string; amount: number }[], tax?: number | null, tip?: number | null): string {
  if (!items || !items.length) return "";
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const extra = (tax || 0) + (tip || 0);
  const lines = items.map((i) => {
    const share = subtotal > 0 ? (i.amount / subtotal) * extra : 0;
    const total = i.amount + share;
    return `- ${i.name}: ${i.amount.toFixed(2)}${share > 0.005 ? ` (+${share.toFixed(2)} tax/tip = ${total.toFixed(2)})` : ""}`;
  });
  const parts = [`Receipt items:`, ...lines];
  if (tax) parts.push(`Tax: ${tax.toFixed(2)}`);
  if (tip) parts.push(`Tip: ${tip.toFixed(2)}`);
  return parts.join("\n");
}

type AddRouteProp = RouteProp<RootStackParamList, "Add">;

export default function AddTransactionScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const route = useRoute<AddRouteProp>();
  const navigation = useNavigation();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [bankId, setBankId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [mode, setMode] = useState<TxnMode>("expense");
  const type: TransactionType = mode === "income" ? "credit" : "debit";
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [fromAccount, setFromAccount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptPhotoUri, setReceiptPhotoUri] = useState<string | null>(null);
  const [quickText, setQuickText] = useState("");
  const [quickParsing, setQuickParsing] = useState(false);
  const { isOnline } = useOffline();

  const [showKeypad, setShowKeypad] = useState(true);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(date);
  const [fromAccountModalOpen, setFromAccountModalOpen] = useState(false);
  const [fromAccountDraft, setFromAccountDraft] = useState("");

  const onQuickAdd = async () => {
    const text = quickText.trim();
    if (!text) return;
    setQuickParsing(true);
    try {
      const draft = await quickAddParse(text);
      setAmount(String(draft.amount));
      setDescription(draft.description);
      setMode(draft.transaction_type === "credit" ? "income" : "expense");
      if (draft.category) setCategory(draft.category);
      if (draft.transaction_date) setDate(draft.transaction_date);
      if (draft.bank_id) setBankId(draft.bank_id);
      setQuickText("");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't parse that", typeof detail === "string" ? detail : "Try rephrasing with an amount, e.g. 'Spent 450 on lunch'.");
    } finally {
      setQuickParsing(false);
    }
  };

  // A receipt scan hands its extracted draft here via route params (rather than
  // creating a transaction directly) so the user always reviews/edits an OCR/AI
  // guess before it's saved. Clear the param after consuming it so switching
  // away and back to this tab doesn't silently re-apply a stale prefill.
  useEffect(() => {
    const prefill = route.params?.prefill;
    if (!prefill) return;
    if (prefill.amount) setAmount(String(prefill.amount));
    if (prefill.description) setDescription(prefill.description);
    if (prefill.transaction_date) setDate(prefill.transaction_date);
    if (prefill.category) setCategory(prefill.category);
    const receiptNotes = formatReceiptNotes(prefill.items, prefill.tax, prefill.tip);
    if (receiptNotes) setNotes(receiptNotes);
    setMode("expense");
    if (prefill.photoUri) setReceiptPhotoUri(prefill.photoUri);
    navigation.setParams({ prefill: undefined } as never);
  }, [route.params?.prefill]);

  useEffect(() => {
    (async () => {
      try {
        const [b, c] = await Promise.all([listBanks(), listCategories()]);
        setBanks(b);
        setCategories(c);
        if (b.length > 0) setBankId(b[0].id);
      } catch {
        // Offline (or the server's unreachable) -- fall back to whatever was
        // last synced, so adding a transaction still works with no internet.
        const [cachedBanks, cachedCategories] = await Promise.all([getCachedBanks(), getCachedCategories()]);
        setBanks(cachedBanks);
        setCategories(cachedCategories);
        if (cachedBanks.length > 0) setBankId(cachedBanks[0].id);
        else Alert.alert("Couldn't load accounts", "Connect to the internet at least once to set this up.");
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
    setFromAccount("");
    setShowKeypad(true);
    setReceiptPhotoUri(null);
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

    const payload = {
      bank_id: bankId as number,
      transaction_date: `${date}T12:00:00`,
      description: description.trim(),
      amount: parsedAmount,
      transaction_type: type,
      category: category || undefined,
      notes: notes.trim() || undefined,
      from_account: mode === "transfer" ? fromAccount.trim() || undefined : undefined,
    };

    setSubmitting(true);
    try {
      // Skip the network attempt entirely when already known offline --
      // avoids hanging on a flaky-but-technically-online axios timeout.
      if (!isOnline) {
        await queueOfflineTransaction(payload);
        Alert.alert("Saved offline", "Will sync once you're back online.");
        resetForm();
        return;
      }
      const created = await createTransaction(payload);
      upsertTransactions([created]).catch(() => {});
      if (receiptPhotoUri) {
        // Best-effort -- the transaction is already saved either way; a failure
        // here (e.g. Paperless-ngx not configured/unreachable) just means no
        // receipt gets archived, not a lost transaction.
        attachReceipt(Number(created.id), receiptPhotoUri).catch(() => {});
      }
      Alert.alert("Saved", "Transaction added.");
      resetForm();
    } catch (err: any) {
      if (!err?.response) {
        // No server response at all -- a genuine network failure (not a
        // validation rejection), so it's safe to queue and retry later.
        await queueOfflineTransaction(payload);
        Alert.alert("Saved offline", "Will sync once you're back online.");
        resetForm();
        return;
      }
      const detail = err.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDigit = (d: string) => setAmount((prev) => (prev === "0" ? d : prev + d));
  const onDecimal = () => setAmount((prev) => (prev.includes(".") ? prev : `${prev || "0"}.`));
  const onBackspace = () => setAmount((prev) => prev.slice(0, -1));

  const selectedBank = banks.find((b) => b.id === bankId);

  if (loadingOptions) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Quick Add with AI</Text>
        <View style={styles.quickAddRow}>
          <TextInput
            style={[styles.input, styles.quickAddInput]}
            value={quickText}
            onChangeText={setQuickText}
            placeholder="e.g. Spent 450 on coffee at Starbucks yesterday"
            placeholderTextColor={colors.textSecondary}
            editable={!quickParsing}
            onFocus={() => setShowKeypad(false)}
            onSubmitEditing={onQuickAdd}
          />
          <TouchableOpacity
            style={[styles.quickAddButton, (quickParsing || !quickText.trim()) && styles.buttonDisabled]}
            onPress={onQuickAdd}
            disabled={quickParsing || !quickText.trim()}
          >
            {quickParsing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Parse</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 18 }}>
          <TypeSegmentedControl
            mode={mode}
            onChange={(m) => {
              setMode(m);
              if (m === "transfer" && !category) setCategory("Transfer");
            }}
          />
        </View>

        <TouchableOpacity
          activeOpacity={1}
          style={styles.amountCard}
          onPress={() => {
            Keyboard.dismiss();
            setShowKeypad(true);
          }}
        >
          <Text style={styles.currencyTag}>INR</Text>
          <Text style={[styles.amountText, { color: mode === "income" ? colors.primary : colors.danger }]}>
            {mode === "income" ? "+" : "-"}
            {amount || "0"}
          </Text>
        </TouchableOpacity>

        <TextInput
          style={styles.descriptionInput}
          value={description}
          onChangeText={setDescription}
          placeholder="Description (e.g. Swiggy dinner)"
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setShowKeypad(false)}
        />

        <FormSectionHeader title="General" />
        <FormGroup>
          <PickerRow
            icon="card-outline"
            label="Account"
            value={selectedBank?.name}
            required
            onPress={() => {
              Keyboard.dismiss();
              setAccountModalOpen(true);
            }}
          />
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

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Transaction</Text>}
        </TouchableOpacity>
      </ScrollView>

      {showKeypad && <NumericKeypad onDigit={onDigit} onDecimal={onDecimal} onBackspace={onBackspace} onClear={() => setAmount("")} />}

      <SelectModal
        visible={accountModalOpen}
        title="Account"
        options={banks.map((b) => ({ key: b.id, label: b.name }))}
        selectedKey={bankId}
        onSelect={(k) => setBankId(k as number)}
        onClose={() => setAccountModalOpen(false)}
      />
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
        onSave={() => setDate(dateDraft.trim() || todayIsoDate())}
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
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 24 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginBottom: 6 },
    hint: { fontSize: 12, color: c.textSecondary },
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
    multiline: { minHeight: 70, textAlignVertical: "top", marginTop: 4 },
    quickAddRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    quickAddInput: { flex: 1 },
    quickAddButton: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
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
    button: {
      marginTop: 24,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });
