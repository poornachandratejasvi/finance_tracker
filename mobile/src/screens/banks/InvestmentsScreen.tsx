import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  createInvestmentAccount, createInvestmentEntry, deleteInvestmentAccount,
  deleteInvestmentEntry, getInvestmentEntries, getInvestmentsDashboard,
} from "../../api/investments";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import {
  InvestmentAccountSummary, InvestmentCategory, InvestmentEntry,
  InvestmentEntryType, InvestmentsDashboard,
} from "../../types";

const CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  ppf: "PPF",
  mutual_fund: "Mutual Funds",
  stocks: "Stocks",
  nps: "NPS",
  epf: "EPF",
  bonds: "Bonds",
  gold: "Gold",
  vehicle: "Vehicle",
  crypto: "Crypto",
  collectible: "Collectibles",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as InvestmentCategory[];

const ENTRY_TYPES: { value: InvestmentEntryType; label: string; unitBased?: boolean }[] = [
  { value: "buy", label: "Buy", unitBased: true },
  { value: "sell", label: "Sell", unitBased: true },
  { value: "contribution", label: "Contribution" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "value_update", label: "Update value" },
];

export default function InvestmentsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [data, setData] = useState<InvestmentsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [entriesByAccount, setEntriesByAccount] = useState<Record<number, InvestmentEntry[]>>({});

  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountCategory, setAccountCategory] = useState<InvestmentCategory>("mutual_fund");
  const [savingAccount, setSavingAccount] = useState(false);

  const [entryAccount, setEntryAccount] = useState<InvestmentAccountSummary | null>(null);
  const [entryType, setEntryType] = useState<InvestmentEntryType>("buy");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [description, setDescription] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getInvestmentsDashboard());
    } catch {
      // keep prior state; pull-to-refresh can retry
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

  const toggleExpand = async (account: InvestmentAccountSummary) => {
    const isOpen = !!expanded[account.id];
    setExpanded({ ...expanded, [account.id]: !isOpen });
    if (!isOpen && !entriesByAccount[account.id]) {
      try {
        const res = await getInvestmentEntries(account.id);
        setEntriesByAccount((prev) => ({ ...prev, [account.id]: res.entries }));
      } catch {
        Alert.alert("Couldn't load entries", "Please try again.");
      }
    }
  };

  const openAccountModal = (category?: InvestmentCategory) => {
    setAccountName("");
    setAccountCategory(category || "mutual_fund");
    setAccountModalVisible(true);
  };

  const onSaveAccount = async () => {
    if (!accountName.trim()) return;
    setSavingAccount(true);
    try {
      await createInvestmentAccount({ name: accountName.trim(), category: accountCategory });
      setAccountModalVisible(false);
      await load();
    } catch (err: any) {
      Alert.alert("Couldn't save", err?.response?.data?.detail || "Please try again.");
    } finally {
      setSavingAccount(false);
    }
  };

  const onDeleteAccount = (account: InvestmentAccountSummary) => {
    Alert.alert("Delete account?", account.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteInvestmentAccount(account.id);
            await load();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const openEntryModal = (account: InvestmentAccountSummary) => {
    setEntryType("buy");
    setAmount(""); setQuantity(""); setPricePerUnit(""); setDescription("");
    setEntryAccount(account);
  };

  const onSaveEntry = async () => {
    if (!entryAccount || !amount) return;
    setSavingEntry(true);
    try {
      await createInvestmentEntry(entryAccount.id, {
        entry_type: entryType,
        amount: parseFloat(amount),
        quantity: quantity ? parseFloat(quantity) : null,
        price_per_unit: pricePerUnit ? parseFloat(pricePerUnit) : null,
        description: description.trim() || null,
      });
      const accId = entryAccount.id;
      setEntryAccount(null);
      await load();
      const res = await getInvestmentEntries(accId);
      setEntriesByAccount((prev) => ({ ...prev, [accId]: res.entries }));
    } catch (err: any) {
      Alert.alert("Couldn't save", err?.response?.data?.detail || "Please try again.");
    } finally {
      setSavingEntry(false);
    }
  };

  const onDeleteEntry = (accountId: number, entry: InvestmentEntry) => {
    Alert.alert("Delete entry?", entry.description || `${entry.amount} amount`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteInvestmentEntry(entry.id);
            await load();
            const res = await getInvestmentEntries(accountId);
            setEntriesByAccount((prev) => ({ ...prev, [accountId]: res.entries }));
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const entryTypeMeta = ENTRY_TYPES.find((t) => t.value === entryType);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Investments Value</Text>
        <Text style={styles.totalValue}>{(data?.total_value || 0).toLocaleString()}</Text>
        <Text style={styles.hint}>Tracked separately from your bank accounts and net worth.</Text>
      </View>

      <TouchableOpacity style={styles.addAccountButton} onPress={() => openAccountModal()}>
        <Text style={styles.addAccountButtonText}>+ Add Account</Text>
      </TouchableOpacity>

      {(!data || data.categories.length === 0) && (
        <Text style={styles.empty}>
          No investment accounts yet. PPF is auto-detected from linked bank statements when available.
        </Text>
      )}

      {data?.categories.map((cat) => (
        <View key={cat.category} style={styles.card}>
          <View style={styles.categoryHeader}>
            <Text style={styles.categoryTitle}>{CATEGORY_LABELS[cat.category] || cat.category}</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.categoryTotal}>{cat.total_value.toLocaleString()}</Text>
          </View>
          <TouchableOpacity onPress={() => openAccountModal(cat.category)}>
            <Text style={styles.addLink}>+ Add to {CATEGORY_LABELS[cat.category]}</Text>
          </TouchableOpacity>

          {cat.accounts.map((acc) => (
            <View key={acc.id}>
              <TouchableOpacity style={styles.accountRow} onPress={() => toggleExpand(acc)}>
                <View style={styles.rowMain}>
                  <Text style={styles.accountName}>{acc.name}</Text>
                  {acc.source === "auto" && <Text style={styles.meta}>Auto-detected</Text>}
                </View>
                <Text style={styles.accountValue}>{acc.current_value.toLocaleString()}</Text>
              </TouchableOpacity>
              {expanded[acc.id] && (
                <View style={styles.entriesBlock}>
                  <View style={styles.entryActionsRow}>
                    <TouchableOpacity onPress={() => openEntryModal(acc)}>
                      <Text style={styles.addLink}>+ Add entry</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onDeleteAccount(acc)}>
                      <Text style={styles.deleteLink}>Delete account</Text>
                    </TouchableOpacity>
                  </View>
                  {(entriesByAccount[acc.id] || []).length === 0 ? (
                    <Text style={styles.meta}>No entries yet.</Text>
                  ) : (
                    (entriesByAccount[acc.id] || []).map((e) => (
                      <TouchableOpacity
                        key={e.id} style={styles.entryRow}
                        onLongPress={() => onDeleteEntry(acc.id, e)}
                      >
                        <View style={styles.rowMain}>
                          <Text style={styles.entryType}>{e.entry_type.replace("_", " ")}</Text>
                          {!!e.description && <Text style={styles.meta}>{e.description}</Text>}
                        </View>
                        <Text style={[styles.entryAmount, { color: e.amount < 0 ? colors.danger : colors.primary }]}>
                          {e.amount > 0 ? "+" : ""}{e.amount.toLocaleString()}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      ))}

      <Modal visible={accountModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Investment Account</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input} value={accountName} onChangeText={setAccountName}
              placeholder="e.g. Groww - Axis Bluechip Fund" placeholderTextColor={colors.textSecondary}
            />
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c} style={[styles.chip, accountCategory === c && styles.chipActive]}
                  onPress={() => setAccountCategory(c)}
                >
                  <Text style={[styles.chipText, accountCategory === c && styles.chipTextActive]}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAccountModalVisible(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreate} onPress={onSaveAccount}
                disabled={savingAccount || !accountName.trim()}
              >
                {savingAccount ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!entryAccount} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Entry — {entryAccount?.name}</Text>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chipRow}>
              {ENTRY_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value} style={[styles.chip, entryType === t.value && styles.chipActive]}
                  onPress={() => setEntryType(t.value)}
                >
                  <Text style={[styles.chipText, entryType === t.value && styles.chipTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>{entryType === "value_update" ? "New current value" : "Amount"}</Text>
            <TextInput
              style={styles.input} value={amount} onChangeText={setAmount}
              keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textSecondary}
            />
            {entryTypeMeta?.unitBased && (
              <>
                <Text style={styles.label}>Quantity (units)</Text>
                <TextInput
                  style={styles.input} value={quantity} onChangeText={setQuantity}
                  keyboardType="number-pad" placeholderTextColor={colors.textSecondary}
                />
                <Text style={styles.label}>Price per unit</Text>
                <TextInput
                  style={styles.input} value={pricePerUnit} onChangeText={setPricePerUnit}
                  keyboardType="number-pad" placeholderTextColor={colors.textSecondary}
                />
              </>
            )}
            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={styles.input} value={description} onChangeText={setDescription}
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEntryAccount(null)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreate} onPress={onSaveEntry}
                disabled={savingEntry || !amount}
              >
                {savingEntry ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 12 },
    totalCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12 },
    totalLabel: { fontSize: 12, color: c.textSecondary },
    totalValue: { fontSize: 24, fontWeight: "700", color: c.text, marginTop: 4 },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 6 },
    addAccountButton: {
      borderWidth: 1, borderColor: c.primary, borderRadius: 8,
      paddingVertical: 10, alignItems: "center", marginBottom: 14,
    },
    addAccountButtonText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    categoryHeader: { flexDirection: "row", alignItems: "center" },
    categoryTitle: { fontSize: 15, fontWeight: "700", color: c.text },
    categoryTotal: { fontSize: 16, fontWeight: "700", color: c.text },
    addLink: { color: c.primary, fontSize: 12, fontWeight: "600", marginTop: 6, marginBottom: 4 },
    deleteLink: { color: c.danger, fontSize: 12, fontWeight: "600", marginTop: 6, marginBottom: 4 },
    accountRow: {
      flexDirection: "row", alignItems: "center", paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, marginTop: 6,
    },
    rowMain: { flex: 1 },
    accountName: { fontSize: 13, fontWeight: "600", color: c.text },
    accountValue: { fontSize: 14, fontWeight: "700", color: c.text },
    meta: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    entriesBlock: { paddingLeft: 8, paddingBottom: 4 },
    entryActionsRow: { flexDirection: "row", gap: 16 },
    entryRow: {
      flexDirection: "row", alignItems: "center", paddingVertical: 6,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    entryType: { fontSize: 12, fontWeight: "600", color: c.text, textTransform: "capitalize" },
    entryAmount: { fontSize: 13, fontWeight: "700" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    modalCard: { backgroundColor: c.card, borderRadius: 12, padding: 20 },
    modalTitle: { fontSize: 15, fontWeight: "700", color: c.text },
    label: { fontSize: 12, fontWeight: "600", color: c.text, marginTop: 12, marginBottom: 6 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 12 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 20, alignItems: "center" },
    modalCancel: { color: c.textSecondary, fontWeight: "600" },
    modalCreate: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
    modalCreateText: { color: "#fff", fontWeight: "600" },
  });
