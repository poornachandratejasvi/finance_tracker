import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createAutopayMandate, deleteAutopayMandate, updateAutopayMandate } from "../../api/autopayMandates";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { MandateFrequency, MandateStatus } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "AutopayMandateForm">;

const FREQUENCIES: MandateFrequency[] = ["weekly", "monthly", "yearly", "other"];
const STATUSES: MandateStatus[] = ["active", "paused", "cancelled"];

export default function AutopayMandateFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.mandate;

  const [merchantName, setMerchantName] = useState(existing?.merchant_name || "");
  const [upiVpa, setUpiVpa] = useState(existing?.upi_vpa || "");
  const [maxAmount, setMaxAmount] = useState(existing?.max_amount ? String(existing.max_amount) : "");
  const [frequency, setFrequency] = useState<MandateFrequency>(existing?.frequency || "monthly");
  const [nextDebitDate, setNextDebitDate] = useState(existing?.next_debit_date || "");
  const [status, setStatus] = useState<MandateStatus>(existing?.status || "active");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!merchantName.trim()) {
      Alert.alert("Missing field", "Enter the merchant name.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        merchant_name: merchantName.trim(),
        upi_vpa: upiVpa.trim() || null,
        max_amount: maxAmount.trim() ? parseFloat(maxAmount) : null,
        frequency,
        next_debit_date: nextDebitDate.trim() || null,
        status,
        notes: notes.trim() || null,
      };
      if (existing) await updateAutopayMandate(existing.id, payload);
      else await createAutopayMandate(payload);
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
    Alert.alert("Delete mandate?", `Remove "${existing.merchant_name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAutopayMandate(existing.id);
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
      <Text style={styles.label}>Merchant</Text>
      <TextInput style={styles.input} value={merchantName} onChangeText={setMerchantName} />

      <Text style={styles.label}>UPI VPA (optional)</Text>
      <TextInput style={styles.input} value={upiVpa} onChangeText={setUpiVpa} autoCapitalize="none" />

      <Text style={styles.label}>Max Amount (optional)</Text>
      <TextInput style={styles.input} value={maxAmount} onChangeText={setMaxAmount} keyboardType="decimal-pad" />

      <Text style={styles.label}>Frequency</Text>
      <ChipRow options={FREQUENCIES} selected={frequency} onSelect={(v) => setFrequency(v as MandateFrequency)} />

      <Text style={styles.label}>Next Debit Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={nextDebitDate} onChangeText={setNextDebitDate} autoCapitalize="none" />

      <Text style={styles.label}>Status</Text>
      <ChipRow options={STATUSES} selected={status} onSelect={(v) => setStatus(v as MandateStatus)} />

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Mandate</Text>
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
