import React from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { ThemeColors, useTheme } from "../context/ThemeContext";

// A single-field slide-up prompt -- used for the Date & Time and From Account
// rows on Add/Edit Transaction, matching the same modal chrome as SelectModal
// so tapping any row on these forms feels consistent.
export default function TextPromptModal({
  visible,
  title,
  value,
  onChangeValue,
  onSave,
  onClose,
  placeholder,
  keyboardType = "default",
  autoCapitalize = "sentences",
}: {
  visible: boolean;
  title: string;
  value: string;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  autoCapitalize?: "none" | "sentences";
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={onChangeValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoFocus
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={() => {
                onSave();
                onClose();
              }}
            >
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    card: { backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 28 },
    title: { fontSize: 16, fontWeight: "700", color: c.text, marginBottom: 12 },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
    },
    actions: { flexDirection: "row", gap: 10, marginTop: 16 },
    cancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 8, borderWidth: 1, borderColor: c.inputBorder },
    cancelText: { color: c.text, fontWeight: "600" },
    saveButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 8, backgroundColor: c.primary },
    saveText: { color: "#fff", fontWeight: "700" },
  });
