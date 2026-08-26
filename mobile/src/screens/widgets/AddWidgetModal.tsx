import React from "react";
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";

import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { DashboardWidgetType } from "../../types";
import { WIDGET_CATALOG } from "./widgetCatalog";

export default function AddWidgetModal({
  visible, onClose, onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (type: DashboardWidgetType) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Add a widget</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {(Object.keys(WIDGET_CATALOG) as DashboardWidgetType[]).map((type) => {
              const meta = WIDGET_CATALOG[type];
              return (
                <TouchableOpacity key={type} style={styles.row} onPress={() => onAdd(type)}>
                  <Text style={styles.rowTitle}>{meta.label}</Text>
                  <Text style={styles.rowDesc}>{meta.description}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 20 },
    title: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 12 },
    row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowTitle: { fontSize: 14, fontWeight: "600", color: c.text },
    rowDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    closeButton: { alignSelf: "flex-end", marginTop: 16 },
    closeText: { color: c.textSecondary, fontWeight: "600" },
  });
