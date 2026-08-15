import React, { useEffect, useState } from "react";
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

import { listBanks } from "../../api/banks";
import {
  createNotificationRule,
  deleteNotificationRule,
  testNotificationRule,
  updateNotificationRule,
} from "../../api/notificationRules";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { AmountOperator, Bank, RecordType } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "NotificationRuleForm">;

const RECORD_TYPES: RecordType[] = ["any", "debit", "credit", "transfer"];
const AMOUNT_OPERATORS: AmountOperator[] = ["none", "eq", "gte", "lte", "between"];

export default function NotificationRuleFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.rule;

  const [name, setName] = useState(existing?.name || "");
  const [triggerType, setTriggerType] = useState<"match" | "absence">(
    existing?.trigger_type || "match"
  );
  const [keywords, setKeywords] = useState((existing?.keywords || []).join(", "));
  const [recordType, setRecordType] = useState<RecordType>(existing?.record_type || "any");
  const [bankId, setBankId] = useState<number | null>(existing?.bank_id ?? null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [amountOperator, setAmountOperator] = useState<AmountOperator>(
    existing?.amount_operator || "none"
  );
  const [amountValue, setAmountValue] = useState(
    existing?.amount_value != null ? String(existing.amount_value) : ""
  );
  const [amountValueMax, setAmountValueMax] = useState(
    existing?.amount_value_max != null ? String(existing.amount_value_max) : ""
  );
  const [checkDayOfMonth, setCheckDayOfMonth] = useState(
    String(existing?.check_day_of_month ?? 28)
  );
  const [notifyDiscord, setNotifyDiscord] = useState(!!existing?.notify_discord);
  const [notifyEmail, setNotifyEmail] = useState(!!existing?.notify_email);
  const [emailTo, setEmailTo] = useState(existing?.email_to || "");
  const [notifyTask, setNotifyTask] = useState(!!existing?.notify_task);
  const [isActive, setIsActive] = useState(existing?.is_active !== false);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    listBanks()
      .then(setBanks)
      .catch(() => {});
  }, []);

  const onSave = async () => {
    const keywordList = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!name.trim()) {
      Alert.alert("Missing name", "Give this rule a name.");
      return;
    }
    if (keywordList.length === 0 && amountOperator === "none") {
      Alert.alert("Missing condition", "Set a keyword or an amount condition.");
      return;
    }
    if (amountOperator !== "none" && !amountValue) {
      Alert.alert("Missing amount", "Enter an amount for the selected condition.");
      return;
    }
    if (!notifyDiscord && !notifyEmail && !notifyTask) {
      Alert.alert("Pick a channel", "Enable at least one notification channel.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        trigger_type: triggerType,
        keywords: keywordList,
        record_type: recordType,
        bank_id: bankId,
        amount_operator: amountOperator,
        amount_value: amountOperator !== "none" ? parseFloat(amountValue) : undefined,
        amount_value_max: amountOperator === "between" ? parseFloat(amountValueMax) : undefined,
        check_day_of_month: triggerType === "absence" ? parseInt(checkDayOfMonth, 10) : undefined,
        notify_discord: notifyDiscord,
        notify_email: notifyEmail,
        email_to: notifyEmail ? emailTo.trim() : undefined,
        notify_task: notifyTask,
        is_active: isActive,
      };
      if (existing) {
        await updateNotificationRule(existing.id, payload);
      } else {
        await createNotificationRule(payload);
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
    Alert.alert("Delete rule?", `Remove "${existing.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteNotificationRule(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const onTest = async () => {
    if (!existing) return;
    setTesting(true);
    try {
      await testNotificationRule(existing.id);
      Alert.alert("Sent", "Test notification fired on all enabled channels.");
    } catch {
      Alert.alert("Couldn't test", "Please try again.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Rent reminder"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Trigger</Text>
      <View style={styles.chipRow}>
        {(["match", "absence"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, triggerType === t && styles.chipActive]}
            onPress={() => setTriggerType(t)}
          >
            <Text style={[styles.chipText, triggerType === t && styles.chipTextActive]}>
              {t === "match" ? "New transaction matches" : "Expected transaction missing"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Keywords (comma-separated, optional)</Text>
      <TextInput
        style={styles.input}
        value={keywords}
        onChangeText={setKeywords}
        placeholder="e.g. rent, landlord"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Record type</Text>
      <View style={styles.chipRow}>
        {RECORD_TYPES.map((rt) => (
          <TouchableOpacity
            key={rt}
            style={[styles.chip, recordType === rt && styles.chipActive]}
            onPress={() => setRecordType(rt)}
          >
            <Text style={[styles.chipText, recordType === rt && styles.chipTextActive]}>{rt}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {banks.length > 0 && (
        <>
          <Text style={styles.label}>Account (optional)</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, bankId === null && styles.chipActive]}
              onPress={() => setBankId(null)}
            >
              <Text style={[styles.chipText, bankId === null && styles.chipTextActive]}>Any</Text>
            </TouchableOpacity>
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
        </>
      )}

      <Text style={styles.label}>Amount condition</Text>
      <View style={styles.chipRow}>
        {AMOUNT_OPERATORS.map((op) => (
          <TouchableOpacity
            key={op}
            style={[styles.chip, amountOperator === op && styles.chipActive]}
            onPress={() => setAmountOperator(op)}
          >
            <Text style={[styles.chipText, amountOperator === op && styles.chipTextActive]}>{op}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {amountOperator !== "none" && (
        <TextInput
          style={styles.input}
          value={amountValue}
          onChangeText={setAmountValue}
          keyboardType="decimal-pad"
          placeholder={amountOperator === "between" ? "Min amount" : "Amount"}
          placeholderTextColor={colors.textSecondary}
        />
      )}
      {amountOperator === "between" && (
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          value={amountValueMax}
          onChangeText={setAmountValueMax}
          keyboardType="decimal-pad"
          placeholder="Max amount"
          placeholderTextColor={colors.textSecondary}
        />
      )}

      {triggerType === "absence" && (
        <>
          <Text style={styles.label}>Check by day of month (1-28)</Text>
          <TextInput
            style={styles.input}
            value={checkDayOfMonth}
            onChangeText={setCheckDayOfMonth}
            keyboardType="number-pad"
            placeholderTextColor={colors.textSecondary}
          />
        </>
      )}

      <Text style={[styles.label, { marginTop: 20 }]}>Notify via</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>Discord</Text>
        <Switch value={notifyDiscord} onValueChange={setNotifyDiscord} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.label}>Email</Text>
        <Switch value={notifyEmail} onValueChange={setNotifyEmail} />
      </View>
      {notifyEmail && (
        <TextInput
          style={styles.input}
          value={emailTo}
          onChangeText={setEmailTo}
          placeholder="you@example.com"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      )}
      <View style={styles.switchRow}>
        <Text style={styles.label}>Google Task</Text>
        <Switch value={notifyTask} onValueChange={setNotifyTask} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.label}>Active</Text>
        <Switch value={isActive} onValueChange={setIsActive} />
      </View>

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.smallButtonOutline} onPress={onTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Send Test</Text>}
        </TouchableOpacity>
      )}

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Rule</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 16, marginBottom: 6 },
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
    chipText: { color: c.text, fontSize: 13 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    switchRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
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
    smallButtonOutline: {
      marginTop: 14,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    deleteButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
