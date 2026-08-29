import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { confirmTransaction, deleteTransaction, listTransactions } from "../api/transactions";
import { listCategories } from "../api/categories";
import { listLabels } from "../api/labels";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { Category, Label, Transaction } from "../types";
import { formatCurrency } from "../utils/format";
import { getCachedTransactions, getCachedCategories, getCachedLabels, upsertTransactions, deleteCachedTransaction } from "../offline/db";
import { useOffline } from "../offline/OfflineProvider";
import { RootStackParamList } from "../navigation/RootNavigator";

const PAGE_SIZE = 30;

type RangeKey = "7d" | "30d" | "month" | "all";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All" },
];

function rangeToDates(range: RangeKey): { start_date?: string; end_date?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (range === "7d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { start_date: iso(start) };
  }
  if (range === "30d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { start_date: iso(start) };
  }
  if (range === "month") {
    return { start_date: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  }
  return {};
}

// Groups the (already date-sorted-descending) flat list into day sections.
function groupByDay(items: Transaction[]): { title: string; data: Transaction[] }[] {
  const sections: { title: string; data: Transaction[] }[] = [];
  let currentKey = "";
  for (const item of items) {
    const d = new Date(item.transaction_date.endsWith("Z") ? item.transaction_date : `${item.transaction_date}Z`);
    const key = d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    if (key !== currentKey) {
      sections.push({ title: key, data: [item] });
      currentKey = key;
    } else {
      sections[sections.length - 1].data.push(item);
    }
  }
  return sections;
}

export default function TransactionsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showingCached, setShowingCached] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [range, setRange] = useState<RangeKey>("30d");
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
  const [labelColors, setLabelColors] = useState<Record<string, string>>({});
  const { isOnline } = useOffline();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    (async () => {
      let categories: Category[] = [];
      let labels: Label[] = [];
      try {
        categories = await listCategories();
      } catch {
        categories = await getCachedCategories();
      }
      try {
        labels = await listLabels();
      } catch {
        labels = await getCachedLabels();
      }
      setCategoryColors(Object.fromEntries(categories.map((c) => [c.name, c.color || colors.primary])));
      setLabelColors(Object.fromEntries(labels.map((l) => [l.name, l.color || colors.primary])));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPage = useCallback(
    async (skip: number) => listTransactions({ skip, limit: PAGE_SIZE, search: debouncedSearch || undefined, ...rangeToDates(range) }),
    [debouncedSearch, range]
  );

  const initialLoad = useCallback(async () => {
    setError(null);
    try {
      const data = await loadPage(0);
      setItems(data.items);
      setTotal(data.total);
      setShowingCached(false);
      upsertTransactions(data.items).catch(() => {});
    } catch (err: any) {
      const cached = await getCachedTransactions(PAGE_SIZE * 3);
      if (cached.length) {
        setItems(cached);
        setTotal(cached.length);
        setShowingCached(true);
      } else {
        setError(err?.response?.data?.detail || "Couldn't load transactions.");
      }
    }
  }, [loadPage]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await initialLoad();
      setLoading(false);
    })();
  }, [initialLoad]);

  const onRefresh = async () => {
    setRefreshing(true);
    await initialLoad();
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const data = await loadPage(items.length);
      setItems((prev) => [...prev, ...data.items]);
    } catch {
      // Silently ignore -- pull-to-refresh can recover.
    } finally {
      setLoadingMore(false);
    }
  };

  const onSwipeDelete = (txn: Transaction) => {
    Alert.alert("Delete transaction?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const numericId = typeof txn.id === "number" ? txn.id : null;
          if (!numericId) return;
          try {
            await deleteTransaction(numericId);
            deleteCachedTransaction(txn.id).catch(() => {});
            setItems((prev) => prev.filter((t) => t.id !== txn.id));
            setTotal((prev) => Math.max(0, prev - 1));
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const onSwipeConfirm = async (txn: Transaction) => {
    const numericId = typeof txn.id === "number" ? txn.id : null;
    if (!numericId) return;
    try {
      await confirmTransaction(numericId);
      setItems((prev) => prev.map((t) => (t.id === txn.id ? { ...t, is_confirmed: true } : t)));
    } catch {
      Alert.alert("Couldn't confirm", "Please try again.");
    }
  };

  const sections = useMemo(() => groupByDay(items), [items]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search transactions"
          placeholderTextColor={colors.textSecondary}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rangeRow} contentContainerStyle={styles.rangeRowContent}>
        {RANGES.map((r) => {
          const active = range === r.key;
          return (
            <TouchableOpacity key={r.key} style={[styles.rangeChip, active && styles.rangeChipActive]} onPress={() => setRange(r.key)}>
              <Text style={[styles.rangeChipText, active && styles.rangeChipTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <SectionList
        style={styles.flex}
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          showingCached && !isOnline ? (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>Offline — showing saved data</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReachedThreshold={0.4}
        onEndReached={onLoadMore}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        ListEmptyComponent={
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <Text style={styles.empty}>No transactions found.</Text>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
        renderItem={({ item }) => (
          <TransactionRow
            txn={item}
            categoryColor={item.category ? categoryColors[item.category] : undefined}
            labelColors={labelColors}
            onPress={() => navigation.navigate("EditTransaction", { transaction: item })}
            onDelete={() => onSwipeDelete(item)}
            onConfirm={item.is_confirmed ? undefined : () => onSwipeConfirm(item)}
          />
        )}
      />
    </View>
  );
}

function categoryBadgeLetter(category: string | null): string {
  return category ? category.trim().charAt(0).toUpperCase() : "?";
}

function TransactionRow({
  txn,
  categoryColor,
  labelColors,
  onPress,
  onDelete,
  onConfirm,
}: {
  txn: Transaction;
  categoryColor?: string;
  labelColors: Record<string, string>;
  onPress: () => void;
  onDelete: () => void;
  onConfirm?: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isCredit = txn.transaction_type === "credit";
  const badgeColor = categoryColor || colors.chipBg;

  const renderRightActions = () => (
    <TouchableOpacity style={[styles.swipeAction, { backgroundColor: colors.danger }]} onPress={onDelete}>
      <Text style={styles.swipeActionText}>Delete</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = onConfirm
    ? () => (
        <TouchableOpacity style={[styles.swipeAction, { backgroundColor: colors.primary }]} onPress={onConfirm}>
          <Text style={styles.swipeActionText}>Confirm</Text>
        </TouchableOpacity>
      )
    : undefined;

  return (
    <Swipeable renderRightActions={renderRightActions} renderLeftActions={renderLeftActions} overshootRight={false} overshootLeft={false}>
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.6}>
        <View style={[styles.badge, { backgroundColor: badgeColor }]}>
          <Text style={styles.badgeText}>{categoryBadgeLetter(txn.category)}</Text>
        </View>
        <View style={styles.rowLeft}>
          <Text style={styles.description} numberOfLines={1}>
            {txn.category || txn.description}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {txn.bank_name || "External"} · {txn.description}
          </Text>
          {(txn.labels.length > 0 || !txn.is_confirmed || txn.source === "sms" || txn.is_pending_sync) && (
            <View style={styles.tagRow}>
              {!txn.is_confirmed && <Tag text="Pending" color={colors.warning} />}
              {txn.source === "sms" && <Tag text="via SMS" color={colors.primary} />}
              {txn.is_pending_sync && <Tag text="Sync pending" color={colors.primary} />}
              {txn.labels.map((name) => (
                <Tag key={name} text={name} color={labelColors[name] || colors.primary} />
              ))}
            </View>
          )}
        </View>
        <Text style={[styles.amount, { color: isCredit ? colors.primary : colors.danger }]}>
          {isCredit ? "+" : "-"}
          {formatCurrency(Math.abs(txn.amount), txn.currency_code)}
        </Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.tag, { backgroundColor: color }]}>
      <Text style={styles.tagText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    searchRow: { paddingHorizontal: 16, paddingTop: 12 },
    searchInput: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      fontSize: 15,
    },
    // Fixed height + alignItems:'center' are load-bearing here: without them a
    // horizontal ScrollView's row content can stretch its children to fill all
    // available vertical space instead of sizing to the chip's own content,
    // turning these into full-screen-tall pills instead of a compact chip row.
    rangeRow: { marginTop: 10, marginBottom: 2, height: 40, flexGrow: 0, flexShrink: 0 },
    rangeRowContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
    rangeChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: c.chipBg, marginRight: 8, alignSelf: "center" },
    rangeChipActive: { backgroundColor: c.primary },
    rangeChipText: { color: c.text, fontSize: 13, fontWeight: "600" },
    rangeChipTextActive: { color: "#fff" },
    list: { padding: 16, flexGrow: 1 },
    sectionHeader: { fontSize: 12, fontWeight: "700", color: c.textSecondary, marginTop: 14, marginBottom: 4, textTransform: "uppercase" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.background,
    },
    swipeAction: {
      width: 88,
      alignItems: "center",
      justifyContent: "center",
    },
    swipeActionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
    badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginRight: 12 },
    badgeText: { color: "#fff", fontWeight: "700", fontSize: 15 },
    rowLeft: { flex: 1, paddingRight: 12 },
    description: { fontSize: 15, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    tagText: { fontSize: 10, fontWeight: "700", color: "#fff" },
    offlineBanner: { backgroundColor: c.chipBg, borderRadius: 8, padding: 10, marginBottom: 8 },
    offlineBannerText: { color: c.textSecondary, fontSize: 12, textAlign: "center", fontWeight: "600" },
    amount: { fontSize: 15, fontWeight: "700" },
    error: { color: c.danger, textAlign: "center", marginTop: 40 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
  });
