import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { recordIOUPayment } from "../../api/ious";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { formatCurrency, todayIsoDate } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "IOUPaymentForm">;

export default function IOUPaymentFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { iou } = route.params;

  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    const amt = parseFloat(amount);
    if (!amt || !paymentDate.trim()) {
      Alert.alert("Missing field", "Enter an amount and date.");
      return;
    }
    setSubmitting(true);
    try {
      await recordIOUPayment(iou.id, amt, paymentDate.trim(), notes.trim() || null);
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't record payment", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>Outstanding: {formatCurrency(iou.outstanding_amount)}</Text>

      <Text style={styles.label}>Amount</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />

      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={paymentDate} onChangeText={setPaymentDate} autoCapitalize="none" />

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput style={styles.input} value={notes} onChangeText={setNotes} />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Record Payment</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 10 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });
