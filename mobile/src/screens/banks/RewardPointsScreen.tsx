import React, { useCallback, useEffect, useState } from "react";
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

import { listBanks } from "../../api/banks";
import { createRewardEntry, deleteRewardEntry, getRewardPoints } from "../../api/rewardPoints";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { Bank, RewardEntryType, RewardPointEntry, RewardPointSummary } from "../../types";
import { formatDate, todayIsoDate } from "../../utils/format";

const ENTRY_TYPES: RewardEntryType[] = ["earned", "redeemed", "expired", "adjustment"];

export default function RewardPointsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [summaries, setSummaries] = useState<RewardPointSummary[]>([]);
  const [entries, setEntries] = useState<RewardPointEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [bankId, setBankId] = useState<number | null>(null);
  const [entryType, setEntryType] = useState<RewardEntryType>("earned");
  const [points, setPoints] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [bankList, data] = await Promise.all([listBanks(), getRewardPoints()]);
      setBanks(bankList.filter((b) => (b.bank_type || "").toLowerCase() === "credit"));
      setSummaries(data.summaries);
      setEntries(data.entries);
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

  useEffect(() => {
    if (banks.length > 0 && bankId === null) setBankId(banks[0].id);
  }, [banks, bankId]);

  const openModal = (forBankId?: number) => {
    setBankId(forBankId || banks[0]?.id || null);
    setEntryType("earned");
    setPoints("");
    setExpiryDate(todayIsoDate());
    setDescription("");
    setModalVisible(true);
  };

  const onSave = async () => {
    if (!bankId || !points) return;
    setSaving(true);
    try {
      await createRewardEntry({
        bank_id: bankId,
        entry_type: entryType,
        points: parseFloat(points),
        expiry_date: entryType === "earned" && expiryDate ? expiryDate : null,
        description: description.trim() || null,
      });
      setModalVisible(false);
      await load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (entry: RewardPointEntry) => {
    Alert.alert("Delete entry?", entry.description || `${entry.points} points`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteRewardEntry(entry.id);
            await load();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const bankName = (id: number) =>
    banks.find((b) => b.id === id)?.name || summaries.find((s) => s.bank_id === id)?.bank_name || String(id);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {summaries.length === 0 && (
        <Text style={styles.empty}>No credit card accounts found. Add one under Banks first.</Text>
      )}

      {summaries.map((s) => (
        <View key={s.bank_id} style={styles.card}>
          <Text style={styles.bankName}>{s.bank_name}</Text>
          <Text style={styles.balance}>{s.balance.toLocaleString()}</Text>
          <Text style={styles.meta}>points</Text>
          {s.expiring.length > 0 ? (
            <View style={styles.chipRow}>
              {s.expiring.map((e, i) => (
                <View
                  key={i}
                  style={[
                    styles.expiryChip,
                    { backgroundColor: new Date(e.expiry_date).getTime() - Date.now() < 7 * 86400000 ? colors.danger : colors.warning },
                  ]}
                >
                  <Text style={styles.expiryChipText}>
                    {e.points.toLocaleString()} pts by {formatDate(e.expiry_date)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>Nothing expiring soon</Text>
          )}
          <TouchableOpacity style={styles.smallButtonOutline} onPress={() => openModal(s.bank_id)}>
            <Text style={styles.smallButtonOutlineText}>+ Add Entry</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>History</Text>
        {entries.length === 0 && <Text style={styles.empty}>No entries yet.</Text>}
        {entries.map((e) => (
          <TouchableOpacity key={e.id} style={styles.entryRow} onLongPress={() => onDelete(e)}>
            <View style={styles.rowMain}>
              <Text style={styles.entryBank}>
                {bankName(e.bank_id)} · <Text style={styles.entryType}>{e.entry_type}</Text>
              </Text>
              <Text style={styles.meta}>
                {e.description || "—"}
                {e.expiry_date ? ` · expires ${formatDate(e.expiry_date)}` : ""}
              </Text>
            </View>
            <Text style={[styles.entryPoints, { color: e.points < 0 ? colors.danger : colors.primary }]}>
              {e.points > 0 ? "+" : ""}
              {e.points.toLocaleString()}
            </Text>
          </TouchableOpacity>
        ))}
        {entries.length > 0 && <Text style={styles.hint}>Long-press an entry to delete it.</Text>}
      </View>

      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Reward Points Entry</Text>

            <Text style={styles.label}>Account</Text>
            <View style={styles.chipRow}>
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

            <Text style={styles.label}>Type</Text>
            <View style={styles.chipRow}>
              {ENTRY_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, entryType === t && styles.chipActive]}
                  onPress={() => setEntryType(t)}
                >
                  <Text style={[styles.chipText, entryType === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Points</Text>
            <TextInput
              style={styles.input}
              value={points}
              onChangeText={setPoints}
              keyboardType="number-pad"
              placeholder="1000"
              placeholderTextColor={colors.textSecondary}
            />

            {entryType === "earned" && (
              <>
                <Text style={styles.label}>Expiry date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                  placeholder={todayIsoDate()}
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                />
              </>
            )}

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={styles.input}
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. May statement"
              placeholderTextColor={colors.textSecondary}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreate}
                onPress={onSave}
                disabled={saving || !bankId || !points}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Save</Text>}
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
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    bankName: { fontSize: 15, fontWeight: "700", color: c.text },
    balance: { fontSize: 26, fontWeight: "700", color: c.text, marginTop: 4 },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 10 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    expiryChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
    expiryChipText: { color: "#fff", fontSize: 11, fontWeight: "600" },
    smallButtonOutline: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowMain: { flex: 1, paddingRight: 8 },
    entryBank: { fontSize: 13, fontWeight: "600", color: c.text },
    entryType: { color: c.textSecondary, fontWeight: "400", textTransform: "capitalize" },
    entryPoints: { fontSize: 14, fontWeight: "700" },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 10, fontStyle: "italic" },
    label: { fontSize: 12, fontWeight: "600", color: c.text, marginTop: 12, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 12, textTransform: "capitalize" },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    modalCard: { backgroundColor: c.card, borderRadius: 12, padding: 20 },
    modalTitle: { fontSize: 15, fontWeight: "700", color: c.text },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 20, alignItems: "center" },
    modalCancel: { color: c.textSecondary, fontWeight: "600" },
    modalCreate: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
    modalCreateText: { color: "#fff", fontWeight: "600" },
  });
