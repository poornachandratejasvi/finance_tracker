import React, { useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { globalSearch, SearchResponse, SearchResultItem } from "../api/search";
import { ThemeColors, useTheme } from "../context/ThemeContext";

const SECTIONS: { key: keyof SearchResponse; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "transactions", label: "Transactions", icon: "receipt-outline" },
  { key: "banks", label: "Accounts", icon: "business-outline" },
  { key: "categories", label: "Categories", icon: "pricetags-outline" },
  { key: "labels", label: "Labels", icon: "bookmark-outline" },
  { key: "templates", label: "Templates", icon: "document-text-outline" },
  { key: "reward_points", label: "Reward Points", icon: "gift-outline" },
];

function destinationFor(item: SearchResultItem): { screen: string; params?: any } {
  switch (item.type) {
    case "transaction":
      return { screen: "Transactions" };
    case "bank":
      return { screen: "Banks" };
    case "category":
      return { screen: "Transactions" };
    case "label":
      return { screen: "Transactions" };
    case "template":
      return { screen: "Settings" };
    case "reward_point":
      return { screen: "Banks", params: { screen: "RewardPoints" } };
    default:
      return { screen: "Dashboard" };
  }
}

export default function SearchScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation<any>();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      globalSearch(query.trim())
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const handleSelect = (item: SearchResultItem) => {
    const dest = destinationFor(item);
    navigation.navigate("Tabs", dest);
  };

  const hasAnyResults = results && SECTIONS.some((s) => (results[s.key] || []).length > 0);

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          autoFocus
          style={styles.input}
          placeholder="Search transactions, accounts, categories…"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
        />
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {query.trim().length > 0 && !loading && !hasAnyResults && (
        <Text style={styles.empty}>No results for "{query}".</Text>
      )}

      <ScrollView contentContainerStyle={styles.results}>
        {results &&
          SECTIONS.map((section) => {
            const items = results[section.key] || [];
            if (items.length === 0) return null;
            return (
              <View key={section.key} style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name={section.icon} size={14} color={colors.textSecondary} />
                  <Text style={styles.sectionTitle}>{section.label}</Text>
                </View>
                {items.map((item) => (
                  <TouchableOpacity
                    key={`${item.type}-${item.id}`}
                    style={styles.row}
                    onPress={() => handleSelect(item)}
                  >
                    <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                    {!!item.subtitle && (
                      <Text style={styles.rowSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background, padding: 16 },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.inputBg,
      borderWidth: 1,
      borderColor: c.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    input: { flex: 1, color: c.text, fontSize: 16, paddingVertical: 12 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 24 },
    results: { paddingTop: 12, paddingBottom: 48 },
    section: { marginBottom: 16 },
    sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
    sectionTitle: { fontSize: 12, fontWeight: "700", color: c.textSecondary },
    row: {
      backgroundColor: c.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 6,
    },
    rowTitle: { fontSize: 14, fontWeight: "600", color: c.text },
    rowSubtitle: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
