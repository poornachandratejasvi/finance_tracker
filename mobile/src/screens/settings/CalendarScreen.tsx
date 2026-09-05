import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getCalendar } from "../../api/calendar";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { CalendarItem } from "../../types";
import { formatCurrency, formatDate } from "../../utils/format";

// Same category set + colors as the web Calendar page's CATEGORIES/TYPE_META,
// just Ionicons instead of MUI icons.
const TYPE_META: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  package: { color: "#4e79a7", icon: "cube-outline" },
  subscription: { color: "#59a14f", icon: "receipt-outline" },
  bill: { color: "#e15759", icon: "cash-outline" },
  custom: { color: "#af7aa1", icon: "notifications-outline" },
  credit_card_statement: { color: "#76b7b2", icon: "document-text-outline" },
  credit_card_due: { color: "#f28e2b", icon: "card-outline" },
  credit_card_fee: { color: "#f28e2b", icon: "card-outline" },
  vehicle_insurance: { color: "#edc948", icon: "car-outline" },
  vehicle_puc: { color: "#b07aa1", icon: "car-outline" },
  autopay_mandate: { color: "#9c755f", icon: "repeat-outline" },
  insurance_expiry: { color: "#e6a532", icon: "medkit-outline" },
  warranty_expiry: { color: "#79706e", icon: "shield-outline" },
  amc_expiry: { color: "#79706e", icon: "shield-outline" },
  iou_due: { color: "#bab0ac", icon: "people-outline" },
  reward_points_expiry: { color: "#59a14f", icon: "gift-outline" },
  planned_item_due: { color: "#4e79a7", icon: "checkmark-done-circle-outline" },
};

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "package", label: "Deliveries" },
  { key: "credit_card", label: "Credit Cards" },
  { key: "subscription", label: "Subscriptions" },
  { key: "vehicle", label: "Vehicles" },
  { key: "autopay_mandate", label: "Autopay" },
  { key: "insurance_expiry", label: "Insurance" },
  { key: "warranty", label: "Warranties" },
  { key: "iou_due", label: "IOUs" },
  { key: "reward_points_expiry", label: "Reward Points" },
  { key: "planned_item_due", label: "Planned Expenses" },
];

function matchesCategory(item: CalendarItem, key: string): boolean {
  if (key === "all") return true;
  if (key === "credit_card") return item.type === "credit_card_statement" || item.type === "credit_card_due" || item.type === "credit_card_fee";
  if (key === "vehicle") return item.type === "vehicle_insurance" || item.type === "vehicle_puc";
  if (key === "warranty") return item.type === "warranty_expiry" || item.type === "amc_expiry";
  return item.type === key;
}

function metaFor(type: string) {
  return TYPE_META[type] || { color: "#4e79a7", icon: "ellipse-outline" as const };
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await getCalendar(60, 30));
    } catch {
      // keep prior list; pull-to-refresh can retry
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sections = useMemo(() => {
    const filtered = items.filter((i) => matchesCategory(i, category));
    const byDay = new Map<string, CalendarItem[]>();
    for (const item of filtered) {
      const day = (item.date || "").slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(item);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, data]) => ({ title: day, data }));
  }, [items, category]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.filterBar}>
        <ChipRow options={CATEGORIES.map((c) => c.key)} selected={category} onSelect={setCategory} labelFor={(k) => CATEGORIES.find((c) => c.key === k)?.label || k} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item, idx) => `${item.type}-${item.id}-${idx}`}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing upcoming in this category.</Text>}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{formatDate(section.title)}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const meta = metaFor(item.type);
          return (
            <View style={styles.row}>
              <View style={[styles.iconCircle, { backgroundColor: `${meta.color}26` }]}>
                <Ionicons name={meta.icon} size={16} color={meta.color} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.itemSubtitle} numberOfLines={1}>
                  {item.subtitle || ""}{item.is_overdue ? " · Overdue" : ""}
                </Text>
              </View>
              {item.amount != null && <Text style={styles.itemAmount}>{formatCurrency(item.amount)}</Text>}
            </View>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    filterBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: c.background },
    list: { padding: 16, paddingTop: 4, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    sectionHeader: { backgroundColor: c.background, paddingVertical: 8 },
    sectionHeaderText: { fontSize: 12, fontWeight: "700", color: c.textSecondary, textTransform: "uppercase" },
    row: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: 10, padding: 12, marginBottom: 8 },
    iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    itemTitle: { fontSize: 14, fontWeight: "600", color: c.text },
    itemSubtitle: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    itemAmount: { fontSize: 13, fontWeight: "700", color: c.text, marginLeft: 8 },
  });
