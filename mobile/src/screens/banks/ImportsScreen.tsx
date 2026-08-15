import React, { useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { listBanks } from "../../api/banks";
import { commitImport, ImportMapping, ImportPreview, previewImportFile } from "../../api/imports";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { Bank } from "../../types";

interface FieldDef {
  key: keyof ImportMapping;
  label: string;
  required: boolean;
}

const FIELD_DEFS: FieldDef[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "type", label: "Type (debit/credit)", required: false },
  { key: "category", label: "Category", required: false },
  { key: "notes", label: "Notes", required: false },
];

export default function ImportsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<keyof ImportMapping, string | null>>>({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    listBanks()
      .then((list) => {
        setBanks(list);
        if (list.length > 0) setBankId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const onPickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setFileName(asset.name);
    setPreview(null);
    setMapping({});
    setLoading(true);
    try {
      const data = await previewImportFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
      setPreview(data);
      setMapping(data.suggested_mapping || {});
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't read that file", typeof detail === "string" ? detail : "Please try a different file.");
    } finally {
      setLoading(false);
    }
  };

  const onCancel = () => {
    setPreview(null);
    setMapping({});
    setFileName("");
  };

  const onImport = async () => {
    if (!preview || !bankId || !mapping.date || !mapping.description || !mapping.amount) return;
    setImporting(true);
    try {
      const result = await commitImport({
        bank_id: bankId,
        columns: preview.columns,
        rows: preview.rows,
        mapping: {
          date: mapping.date,
          description: mapping.description,
          amount: mapping.amount,
          type: mapping.type || undefined,
          category: mapping.category || undefined,
          notes: mapping.notes || undefined,
        },
        skip_duplicates: skipDuplicates,
      });
      const parts = [`Imported ${result.created} transaction${result.created === 1 ? "" : "s"}`];
      if (result.skipped_duplicates > 0) parts.push(`skipped ${result.skipped_duplicates} duplicate(s)`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} row(s) had errors`);
      Alert.alert("Import complete", parts.join(", ") + ".");
      if (result.created > 0) onCancel();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't import", typeof detail === "string" ? detail : "Please check your column mapping.");
    } finally {
      setImporting(false);
    }
  };

  const canImport = !!(preview && bankId && mapping.date && mapping.description && mapping.amount);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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

      <TouchableOpacity style={styles.pickButton} onPress={onPickFile}>
        <Text style={styles.pickButtonText}>{fileName || "Choose CSV or Excel file"}</Text>
      </TouchableOpacity>

      {loading && <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} />}

      {preview && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Map columns · {preview.total_rows} row{preview.total_rows === 1 ? "" : "s"} found
          </Text>

          {FIELD_DEFS.map((f) => (
            <View key={f.key} style={styles.mappingBlock}>
              <Text style={styles.mappingLabel}>
                {f.label}
                {f.required ? " *" : ""}
              </Text>
              <View style={styles.chipRow}>
                {!f.required && (
                  <TouchableOpacity
                    style={[styles.chip, !mapping[f.key] && styles.chipActive]}
                    onPress={() => setMapping((m) => ({ ...m, [f.key]: null }))}
                  >
                    <Text style={[styles.chipText, !mapping[f.key] && styles.chipTextActive]}>none</Text>
                  </TouchableOpacity>
                )}
                {preview.columns.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, mapping[f.key] === c && styles.chipActive]}
                    onPress={() => setMapping((m) => ({ ...m, [f.key]: c }))}
                  >
                    <Text style={[styles.chipText, mapping[f.key] === c && styles.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}

          <View style={styles.switchRow}>
            <Text style={styles.mappingLabel}>Skip rows matching an existing transaction</Text>
            <Switch value={skipDuplicates} onValueChange={setSkipDuplicates} />
          </View>

          <ScrollView horizontal style={styles.previewScroll}>
            <View>
              <View style={styles.previewRow}>
                {preview.columns.map((c) => (
                  <Text key={c} style={[styles.previewCell, styles.previewHeaderCell]}>
                    {c}
                  </Text>
                ))}
              </View>
              {preview.rows.slice(0, 5).map((row, i) => (
                <View key={i} style={styles.previewRow}>
                  {row.map((cell, j) => (
                    <Text key={j} style={styles.previewCell} numberOfLines={1}>
                      {cell}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, (!canImport || importing) && styles.buttonDisabled]}
              onPress={onImport}
              disabled={!canImport || importing}
            >
              {importing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Import</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginBottom: 6 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 12 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    pickButton: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: c.inputBorder,
      borderStyle: "dashed",
      borderRadius: 10,
      paddingVertical: 20,
      alignItems: "center",
      backgroundColor: c.card,
    },
    pickButtonText: { color: c.primary, fontWeight: "600", fontSize: 14 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 16 },
    sectionTitle: { fontSize: 14, fontWeight: "700", color: c.text, marginBottom: 12 },
    mappingBlock: { marginBottom: 14 },
    mappingLabel: { fontSize: 12, fontWeight: "600", color: c.text, marginBottom: 6 },
    switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    previewScroll: { marginBottom: 16, borderRadius: 8, backgroundColor: c.inputBg },
    previewRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    previewCell: { width: 110, padding: 8, fontSize: 11, color: c.text },
    previewHeaderCell: { fontWeight: "700", color: c.textSecondary },
    actionsRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 20 },
    cancelText: { color: c.textSecondary, fontWeight: "600" },
    button: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontWeight: "600" },
  });
