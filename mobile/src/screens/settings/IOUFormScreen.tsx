import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createIOU, deleteIOU, updateIOU } from "../../api/ious";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { IouDirection } from "../../types";
import { todayIsoDate } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "IOUForm">;

export default function IOUFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.iou;

  const [personName, setPersonName] = useState(existing?.person_name || "");
  const [direction, setDirection] = useState<IouDirection>(existing?.direction || "lent");
  const [principalAmount, setPrincipalAmount] = useState(existing ? String(existing.principal_amount) : "");
  const [iouDate, setIouDate] = useState(existing?.iou_date || todayIsoDate());
  const [dueDate, setDueDate] = useState(existing?.due_date || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!personName.trim()) {
      Alert.alert("Missing field", "Enter the person's name.");
      return;
    }
    if (!existing && (!principalAmount.trim() || !iouDate.trim())) {
      Alert.alert("Missing field", "Enter the amount and date.");
      return;
    }
    setSubmitting(true);
    try {
      if (existing) {
        await updateIOU(existing.id, { person_name: personName.trim(), due_date: dueDate.trim() || null, notes: notes.trim() || null });
      } else {
        await createIOU({
          person_name: personName.trim(),
          direction,
          principal_amount: parseFloat(principalAmount),
          iou_date: iouDate.trim(),
          due_date: dueDate.trim() || null,
          notes: notes.trim() || null,
        });
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
    Alert.alert("Delete IOU?", `Remove this record with ${existing.person_name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteIOU(existing.id);
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
      <Text style={styles.label}>Person</Text>
      <TextInput style={styles.input} value={personName} onChangeText={setPersonName} />

      {!existing && (
        <>
          <Text style={styles.label}>Direction</Text>
          <ChipRow
            options={["lent", "borrowed"]}
            selected={direction}
            onSelect={(v) => setDirection(v as IouDirection)}
            labelFor={(v) => (v === "lent" ? "I lent them money" : "I borrowed from them")}
          />

          <Text style={styles.label}>Amount</Text>
          <TextInput style={styles.input} value={principalAmount} onChangeText={setPrincipalAmount} keyboardType="decimal-pad" />

          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={iouDate} onChangeText={setIouDate} autoCapitalize="none" />
        </>
      )}

      <Text style={styles.label}>Due Date (optional, YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} autoCapitalize="none" />

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete IOU</Text>
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
