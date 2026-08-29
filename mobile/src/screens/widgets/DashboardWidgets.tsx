import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { DashboardWidget, DashboardWidgetType } from "../../types";
import { listDashboardWidgets, addDashboardWidget, deleteDashboardWidget, reorderDashboardWidgets } from "../../api/dashboardWidgets";
import { WIDGET_CATALOG } from "./widgetCatalog";
import AddWidgetModal from "./AddWidgetModal";

// A user-configurable section of dashboard cards, mirroring the web app's
// "Your Widgets" -- add/remove/reorder from WIDGET_CATALOG, persisted via
// /api/dashboard-widgets. Each widget renders itself against an existing
// endpoint; this component only owns layout + CRUD.
export default function DashboardWidgets() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [widgets, setWidgets] = useState<DashboardWidget[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const load = useCallback(() => {
    listDashboardWidgets().then(setWidgets).catch(() => setWidgets([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async (type: DashboardWidgetType) => {
    const meta = WIDGET_CATALOG[type];
    const created = await addDashboardWidget(type, meta?.size || "medium");
    setWidgets((prev) => [...(prev || []), created]);
    setModalVisible(false);
  };

  const handleRemove = async (id: number) => {
    await deleteDashboardWidget(id);
    setWidgets((prev) => (prev || []).filter((w) => w.id !== id));
  };

  const handleWidgetUpdated = (updated: DashboardWidget) => {
    setWidgets((prev) => (prev || []).map((w) => (w.id === updated.id ? updated : w)));
  };

  const move = (index: number, direction: 1 | -1) => {
    if (!widgets) return;
    const target = index + direction;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target], next[index]];
    setWidgets(next);
    reorderDashboardWidgets(next.map((w) => w.id)).catch(() => load());
  };

  if (widgets === null) return null;

  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Widgets</Text>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          {editing && (
            <TouchableOpacity onPress={() => setModalVisible(true)}>
              <Text style={styles.addLink}>+ Add</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setEditing((e) => !e)}>
            <Text style={styles.editLink}>{editing ? "Done" : "Edit"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {widgets.length === 0 ? (
        <TouchableOpacity style={styles.emptyCard} onPress={() => setModalVisible(true)}>
          <Text style={styles.emptyText}>No widgets yet — tap to add your first one.</Text>
        </TouchableOpacity>
      ) : (
        widgets.map((w, i) => {
          const meta = WIDGET_CATALOG[w.widget_type];
          if (!meta) return null;
          const Content = meta.Content;
          return (
            <View key={w.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{meta.label}</Text>
                {editing && (
                  <View style={{ flexDirection: "row", gap: 14 }}>
                    <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0}>
                      <Text style={[styles.controlText, i === 0 && styles.controlDisabled]}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => move(i, 1)} disabled={i === widgets.length - 1}>
                      <Text style={[styles.controlText, i === widgets.length - 1 && styles.controlDisabled]}>↓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRemove(w.id)}>
                      <Text style={[styles.controlText, { color: colors.danger }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              <Content widget={w} onWidgetUpdated={handleWidgetUpdated} />
            </View>
          );
        })
      )}

      <AddWidgetModal visible={modalVisible} onClose={() => setModalVisible(false)} onAdd={handleAdd} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: c.text },
    addLink: { color: c.primary, fontWeight: "600" },
    editLink: { color: c.textSecondary, fontWeight: "600" },
    emptyCard: {
      borderWidth: 1, borderStyle: "dashed", borderColor: c.border, borderRadius: 10,
      padding: 24, alignItems: "center",
    },
    emptyText: { color: c.textSecondary },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    cardTitle: { fontSize: 14, fontWeight: "700", color: c.text },
    controlText: { fontSize: 15, color: c.text, fontWeight: "700" },
    controlDisabled: { opacity: 0.3 },
  });
