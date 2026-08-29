import React from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemeColors, useTheme } from "../context/ThemeContext";

export interface SelectOption {
  key: string | number;
  label: string;
  color?: string;
}

// A slide-up modal list picker -- used for Account/Category selection on the
// Add/Edit Transaction screens, matching how the reference app taps a row to
// open a picker instead of an inline chip scroller.
export default function SelectModal({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
  allowClear,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedKey?: string | number | null;
  onSelect: (key: string | number | null) => void;
  onClose: () => void;
  allowClear?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {allowClear && (
              <TouchableOpacity
                style={styles.option}
                onPress={() => {
                  onSelect(null);
                  onClose();
                }}
              >
                <Text style={[styles.optionText, { color: colors.textSecondary, fontStyle: "italic" }]}>
                  Auto-detect
                </Text>
                {selectedKey == null && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            )}
            {options.map((o) => (
              <TouchableOpacity
                key={String(o.key)}
                style={styles.option}
                onPress={() => {
                  onSelect(o.key);
                  onClose();
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  {o.color && <View style={[styles.dot, { backgroundColor: o.color }]} />}
                  <Text
                    style={[styles.optionText, o.key === selectedKey && { color: colors.primary, fontWeight: "700" }]}
                    numberOfLines={1}
                  >
                    {o.label}
                  </Text>
                </View>
                {o.key === selectedKey && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
            {options.length === 0 && <Text style={styles.empty}>No options yet.</Text>}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    card: { backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 28 },
    title: { fontSize: 16, fontWeight: "700", color: c.text, marginBottom: 10 },
    list: { maxHeight: 420 },
    option: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    optionText: { fontSize: 15, color: c.text },
    dot: { width: 10, height: 10, borderRadius: 5 },
    empty: { color: c.textSecondary, textAlign: "center", paddingVertical: 20 },
    cancelButton: { marginTop: 16, alignItems: "center", paddingVertical: 4 },
    cancelText: { color: c.textSecondary, fontWeight: "600", fontSize: 14 },
  });
