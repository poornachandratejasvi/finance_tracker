import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
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
import { FormGroup, FormSectionHeader } from "../../components/FormGroup";
import { PickerRow, ToggleRow } from "../../components/PickerRow";
import SelectModal from "../../components/SelectModal";
import TextPromptModal from "../../components/TextPromptModal";

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
  const [keywords, setKeywords] = useState<string[]>(existing?.keywords || []);
  const [keywordInput, setKeywordInput] = useState("");
  const [recordType, setRecordType] = useState<RecordType>(
    existing?.record_type && existing.record_type !== "transfer" ? existing.record_type : "any"
  );
  const [category, setCategory] = useState(existing?.category || "");
  const [labelIds, setLabelIds] = useState<number[]>(existing?.label_ids || []);
  const [isActive, setIsActive] = useState(existing?.is_active !== false);
  const [notifyDiscord, setNotifyDiscord] = useState(!!existing?.notify_discord);
  const [labels, setLabels] = useState<Label[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [recordTypeModalOpen, setRecordTypeModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState(category);

  useEffect(() => {
    listLabels()
      .then(setLabels)
      .catch(() => {});
  }, []);

  const toggleLabel = (id: number) => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    if (!keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
      setKeywords((prev) => [...prev, kw]);
    }
    setKeywordInput("");
  };

  const removeKeyword = (kw: string) => setKeywords((prev) => prev.filter((k) => k !== kw));

  const onSave = async () => {
    const keywordList = [...keywords, ...(keywordInput.trim() ? [keywordInput.trim()] : [])];
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
      <Text style={styles.label}>What Automatic Rule are you creating?</Text>
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

      <FormSectionHeader title="General" />
      <FormGroup>
        <PickerRow icon="text-outline" label="Rule name" rightElement={
          <TextInput
            style={styles.inlineInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Swiggy orders"
            placeholderTextColor={colors.textSecondary}
          />
        } />
      </FormGroup>

      <FormSectionHeader title="Matching criteria" />
      <View style={styles.keywordCard}>
        <View style={styles.labelWrap}>
          {keywords.map((kw) => (
            <TouchableOpacity key={kw} style={styles.keywordChip} onPress={() => removeKeyword(kw)}>
              <Text style={styles.keywordChipText}>{kw} ✕</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.keywordInputRow}>
          <TextInput
            style={[styles.input, styles.keywordInput]}
            value={keywordInput}
            onChangeText={setKeywordInput}
            placeholder="Add a keyword (e.g. swiggy)"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            onSubmitEditing={addKeyword}
          />
          <TouchableOpacity style={styles.addKeywordButton} onPress={addKeyword}>
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!isTransferRule && (
        <>
          <FormSectionHeader title="Assign action" />
          <FormGroup>
            <PickerRow
              icon="funnel-outline"
              label="Applies to"
              value={recordType}
              onPress={() => setRecordTypeModalOpen(true)}
            />
            <PickerRow
              icon="pricetag-outline"
              label="Category"
              value={category || null}
              placeholder="Optional"
              onPress={() => {
                setCategoryDraft(category);
                setCategoryModalOpen(true);
              }}
            />
          </FormGroup>

          {labels.length > 0 && (
            <>
              <FormSectionHeader title="Labels" />
              <View style={styles.labelWrap}>
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

      <FormSectionHeader title="Automation" />
      <FormGroup>
        <ToggleRow icon="checkmark-circle-outline" label="Active" value={isActive} onValueChange={setIsActive} />
        <ToggleRow icon="notifications-outline" label="Notify on Discord" value={notifyDiscord} onValueChange={setNotifyDiscord} />
      </FormGroup>

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Rule</Text>
        </TouchableOpacity>
      )}

      <SelectModal
        visible={recordTypeModalOpen}
        title="Applies to"
        options={RECORD_TYPES.map((rt) => ({ key: rt, label: rt.charAt(0).toUpperCase() + rt.slice(1) }))}
        selectedKey={recordType}
        onSelect={(k) => setRecordType(k as RecordType)}
        onClose={() => setRecordTypeModalOpen(false)}
      />
      <TextPromptModal
        visible={categoryModalOpen}
        title="Category"
        value={categoryDraft}
        onChangeValue={setCategoryDraft}
        onSave={() => setCategory(categoryDraft.trim())}
        onClose={() => setCategoryModalOpen(false)}
        placeholder="e.g. Food & Dining"
      />
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
    inlineInput: { flex: 1, color: c.text, fontSize: 14, textAlign: "right" },
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
    keywordCard: { backgroundColor: c.card, borderRadius: 12, padding: 14 },
    labelWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    keywordChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: c.chipBg, marginBottom: 4 },
    keywordChipText: { color: c.text, fontSize: 13, fontWeight: "600" },
    keywordInputRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    keywordInput: { flex: 1 },
    addKeywordButton: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingHorizontal: 18,
      justifyContent: "center",
      alignItems: "center",
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
