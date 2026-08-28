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

import { listBanks } from "../api/banks";
import { listCategories } from "../api/categories";
import { createTransaction } from "../api/transactions";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { Bank, Category, TransactionType } from "../types";
import { todayIsoDate } from "../utils/format";
import { getCachedBanks, getCachedCategories, upsertTransactions } from "../offline/db";
import { queueOfflineTransaction } from "../offline/syncEngine";
import { useOffline } from "../offline/OfflineProvider";
import { TabParamList } from "../navigation/RootNavigator";

export interface ReceiptPrefill {
  amount?: number;
  description?: string | null;
  transaction_date?: string | null;
  category?: string | null;
}

type AddRouteProp = RouteProp<TabParamList, "Add">;

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
  const [type, setType] = useState<TransactionType>("debit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { isOnline } = useOffline();

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
    setType("debit");
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

  if (loadingOptions) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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
          placeholderTextColor={colors.textSecondary}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Swiggy dinner"
          placeholderTextColor={colors.textSecondary}
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
          placeholderTextColor={colors.textSecondary}
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 16, marginBottom: 6 },
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
    multiline: { minHeight: 70, textAlignVertical: "top" },
    segmentRow: { flexDirection: "row", gap: 8, marginTop: 4 },
    segment: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: "center",
      backgroundColor: c.chipBg,
    },
    segmentActive: { backgroundColor: c.primary },
    segmentText: { fontWeight: "600", color: c.text },
    segmentTextActive: { color: "#fff" },
    chipRow: { flexDirection: "row" },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: c.chipBg,
      marginRight: 8,
    },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13 },
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
  });
