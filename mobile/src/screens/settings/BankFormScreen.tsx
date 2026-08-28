import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createBank, deleteBank, updateBank } from "../../api/banks";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";

type Props = NativeStackScreenProps<BanksStackParamList, "BankForm">;

const BANK_TYPES = ["savings", "credit", "loan", "investment", "other"];
const COLORS = ["#1b6b4c", "#b3261e", "#0b5fff", "#b8860b", "#7d3fc4", "#008080"];

export default function BankFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.bank;

  const [name, setName] = useState(existing?.name || "");
  const [bankType, setBankType] = useState(existing?.bank_type || "savings");
  const [currencyCode, setCurrencyCode] = useState(existing?.currency_code || "INR");
  const [color, setColor] = useState(existing?.color || COLORS[0]);
  const [currentBalance, setCurrentBalance] = useState(
    existing?.current_balance != null ? String(existing.current_balance) : ""
  );
  const [smsSenderPattern, setSmsSenderPattern] = useState(existing?.sms_sender_pattern || "");
  const [isArchived, setIsArchived] = useState(!!existing?.is_archived);
  const [interestRate, setInterestRate] = useState(existing?.interest_rate != null ? String(existing.interest_rate) : "");
  const [minimumPayment, setMinimumPayment] = useState(existing?.minimum_payment != null ? String(existing.minimum_payment) : "");
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Give this account a name.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        bank_type: bankType,
        currency_code: currencyCode.trim().toUpperCase() || "INR",
        color,
        current_balance: currentBalance ? parseFloat(currentBalance) : undefined,
        sms_sender_pattern: smsSenderPattern.trim() || undefined,
        is_archived: isArchived,
        interest_rate: interestRate ? parseFloat(interestRate) : undefined,
        minimum_payment: minimumPayment ? parseFloat(minimumPayment) : undefined,
      };
      if (existing) {
        await updateBank(existing.id, payload);
      } else {
        await createBank(payload);
      }
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
    Alert.alert("Delete account?", `This removes "${existing.name}" and can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteBank(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. HDFC Savings"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.chipRow}>
        {BANK_TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, bankType === t && styles.chipActive]}
            onPress={() => setBankType(t)}
          >
            <Text style={[styles.chipText, bankType === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {bankType === "investment" && (
        <Text style={styles.hint}>
          Won't show up as a bank balance — this just lets statement emails from this
          sender (e.g. eCAS@cdslstatement.com for a CDSL CAS) get auto-downloaded, so
          their holdings feed the Investments tab instead. Add the PDF password below
          like any other bank once it's created.
        </Text>
      )}

      <Text style={styles.label}>Currency code</Text>
      <TextInput
        style={styles.input}
        value={currencyCode}
        onChangeText={setCurrencyCode}
        autoCapitalize="characters"
        maxLength={3}
        placeholder="INR"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Color</Text>
      <View style={styles.chipRow}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
            onPress={() => setColor(c)}
          />
        ))}
      </View>

      <Text style={styles.label}>Current balance (optional)</Text>
      <TextInput
        style={styles.input}
        value={currentBalance}
        onChangeText={setCurrentBalance}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={colors.textSecondary}
      />

      {(bankType === "credit" || bankType === "loan") && (
        <>
          <Text style={styles.label}>Interest rate % / year (optional)</Text>
          <TextInput
            style={styles.input}
            value={interestRate}
            onChangeText={setInterestRate}
            keyboardType="decimal-pad"
            placeholder="e.g. 42"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={styles.label}>Minimum payment (optional)</Text>
          <TextInput
            style={styles.input}
            value={minimumPayment}
            onChangeText={setMinimumPayment}
            keyboardType="decimal-pad"
            placeholder="Leave blank to estimate as 2% of balance"
            placeholderTextColor={colors.textSecondary}
          />
        </>
      )}

      <Text style={styles.label}>SMS Sender ID (optional)</Text>
      <TextInput
        style={styles.input}
        value={smsSenderPattern}
        onChangeText={setSmsSenderPattern}
        autoCapitalize="characters"
        placeholder="HDFCBK"
        placeholderTextColor={colors.textSecondary}
      />
      <Text style={styles.hint}>
        The alphanumeric ID your bank's alert texts come from (e.g. HDFCBK,
        AD-SBIINB) -- not a phone number. Lets an incoming SMS get matched to
        this account automatically.
      </Text>

      {existing && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>Archived</Text>
          <Switch value={isArchived} onValueChange={setIsArchived} />
        </View>
      )}

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Account</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 16, marginBottom: 6 },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 6, fontStyle: "italic" },
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
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13, textTransform: "capitalize" },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    swatch: { width: 32, height: 32, borderRadius: 16 },
    swatchActive: { borderWidth: 3, borderColor: c.text },
    switchRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 8,
    },
    button: {
      marginTop: 28,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    deleteButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
