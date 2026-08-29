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

import { createAutoRule, deleteAutoRule, updateAutoRule } from "../../api/autoRules";
import { listLabels } from "../../api/labels";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Label, RecordType } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "AutoRuleForm">;

const RECORD_TYPES: RecordType[] = ["any", "debit", "credit"];

export default function AutoRuleFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.rule;

  // Two distinct rule types (matching the reference app): an Income/Expense
  // Rule assigns a category + labels on match; a Transfer Rule just marks
  // matching records as a transfer (category is forced to "Transfer"
  // server-side) -- category/labels are irrelevant for it, so they're hidden.
  const [isTransferRule, setIsTransferRule] = useState(existing?.record_type === "transfer");
  const [name, setName] = useState(existing?.name || "");
  const [keywords, setKeywords] = useState((existing?.keywords || []).join(", "));
  const [recordType, setRecordType] = useState<RecordType>(
    existing?.record_type && existing.record_type !== "transfer" ? existing.record_type : "any"
  );
  const [category, setCategory] = useState(existing?.category || "");
  const [labelIds, setLabelIds] = useState<number[]>(existing?.label_ids || []);
  const [isActive, setIsActive] = useState(existing?.is_active !== false);
  const [notifyDiscord, setNotifyDiscord] = useState(!!existing?.notify_discord);
  const [labels, setLabels] = useState<Label[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listLabels()
      .then(setLabels)
      .catch(() => {});
  }, []);

  const toggleLabel = (id: number) => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };

  const onSave = async () => {
    const keywordList = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!name.trim()) {
      Alert.alert("Missing name", "Give this rule a name.");
      return;
    }
    if (keywordList.length === 0) {
      Alert.alert("Missing keywords", "Add at least one keyword.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        keywords: keywordList,
        record_type: isTransferRule ? "transfer" as RecordType : recordType,
        category: isTransferRule ? undefined : category.trim() || undefined,
        label_ids: isTransferRule ? [] : labelIds,
        is_active: isActive,
        notify_discord: notifyDiscord,
      };
      if (existing) {
        await updateAutoRule(existing.id, payload);
      } else {
        await createAutoRule(payload);
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
            await deleteAutoRule(existing.id);
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
      <Text style={styles.label}>Rule type</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity
          style={[styles.typeOption, !isTransferRule && styles.typeOptionActive]}
          onPress={() => setIsTransferRule(false)}
        >
          <Text style={[styles.typeOptionTitle, !isTransferRule && styles.chipTextActive]}>Income/Expense Rule</Text>
          <Text style={[styles.typeOptionSubtitle, !isTransferRule && styles.chipTextActive]}>Add categories and labels</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeOption, isTransferRule && styles.typeOptionActive]}
          onPress={() => setIsTransferRule(true)}
        >
          <Text style={[styles.typeOptionTitle, isTransferRule && styles.chipTextActive]}>Transfer Rule</Text>
          <Text style={[styles.typeOptionSubtitle, isTransferRule && styles.chipTextActive]}>Mark record as transfer</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Swiggy orders"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Keywords (comma-separated)</Text>
      <TextInput
        style={styles.input}
        value={keywords}
        onChangeText={setKeywords}
        placeholder="swiggy, zomato"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
      />

      {!isTransferRule && (
        <>
          <Text style={styles.label}>Applies to</Text>
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

          <Text style={styles.label}>Category (optional)</Text>
          <TextInput
            style={styles.input}
            value={category}
            onChangeText={setCategory}
            placeholder="Food & Dining"
            placeholderTextColor={colors.textSecondary}
          />

          {labels.length > 0 && (
            <>
              <Text style={styles.label}>Labels</Text>
              <View style={styles.chipRow}>
                {labels.map((l) => (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.chip, labelIds.includes(l.id) && { backgroundColor: l.color }]}
                    onPress={() => toggleLabel(l.id)}
                  >
                    <Text style={[styles.chipText, labelIds.includes(l.id) && styles.chipTextActive]}>
                      {l.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>Active</Text>
        <Switch value={isActive} onValueChange={setIsActive} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.label}>Notify on Discord</Text>
        <Switch value={notifyDiscord} onValueChange={setNotifyDiscord} />
      </View>

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

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
    typeOption: {
      flex: 1,
      minWidth: "45%",
      padding: 12,
      borderRadius: 10,
      backgroundColor: c.chipBg,
    },
    typeOptionActive: { backgroundColor: c.primary },
    typeOptionTitle: { fontSize: 14, fontWeight: "700", color: c.text },
    typeOptionSubtitle: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13, textTransform: "capitalize" },
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
    deleteButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
