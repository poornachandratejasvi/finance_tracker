import React, { useState } from "react";
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

import { createLabel, deleteLabel, updateLabel } from "../../api/labels";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "LabelForm">;

const COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];

export default function LabelFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.label;

  const [name, setName] = useState(existing?.name || "");
  const [color, setColor] = useState(existing?.color || COLORS[0]);
  const [keywords, setKeywords] = useState((existing?.auto_keywords || []).join(", "));
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Give this label a name.");
      return;
    }
    setSubmitting(true);
    try {
      const auto_keywords = keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const payload = { name: name.trim(), color, auto_keywords };
      if (existing) {
        await updateLabel(existing.id, payload);
      } else {
        await createLabel(payload);
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
    Alert.alert("Delete label?", `Remove "${existing.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteLabel(existing.id);
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
        placeholder="e.g. Reimbursable"
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

      <Text style={styles.label}>Auto-apply keywords (comma-separated, optional)</Text>
      <TextInput
        style={styles.input}
        value={keywords}
        onChangeText={setKeywords}
        placeholder="e.g. uber, ola"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
      />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Label</Text>
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
    swatch: { width: 32, height: 32, borderRadius: 16 },
    swatchActive: { borderWidth: 3, borderColor: c.text },
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
