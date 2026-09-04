import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { listWarranties } from "../../api/warranties";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Warranty } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "Warranties">;

const CATEGORIES = ["all", "electronics", "appliance", "furniture", "other"];

function expiryColor(days: number | null, c: ThemeColors): string {
  if (days == null) return c.textSecondary;
  if (days < 0) return c.danger;
  if (days <= 30) return c.warning;
  return c.primary;
}

export default function WarrantiesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (category: string) => {
    try {
      setWarranties(await listWarranties(category === "all" ? undefined : category));
    } catch {
      // keep prior list; pull-to-refresh can retry
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load(filter);
        setLoading(false);
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, filter])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(filter);
    setRefreshing(false);
  };

  return (
    <View style={styles.flex}>
      <View style={styles.filterBar}>
        <ChipRow options={CATEGORIES} selected={filter} onSelect={setFilter} />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={warranties}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={styles.empty}>No warranties tracked yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("WarrantyForm", { warranty: item })}>
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.item_name}</Text>
                <Text style={styles.typeTag}>{item.category}</Text>
              </View>
              {item.vendor ? <Text style={styles.meta}>{item.vendor}</Text> : null}
              <View style={styles.badgeRow}>
                {item.warranty_expiry && (
                  <Text style={{ color: expiryColor(item.warranty_days_until_expiry, colors), fontSize: 12, fontWeight: "700" }}>
                    Warranty: {(item.warranty_days_until_expiry ?? 0) < 0 ? "Expired" : `${item.warranty_days_until_expiry}d left`}
                  </Text>
                )}
                {item.amc_expiry && (
                  <Text style={{ color: expiryColor(item.amc_days_until_expiry, colors), fontSize: 12, fontWeight: "700" }}>
                    AMC: {(item.amc_days_until_expiry ?? 0) < 0 ? "Expired" : `${item.amc_days_until_expiry}d left`}
                  </Text>
                )}
              </View>
              {item.document_count > 0 && <Text style={styles.docCount}>{item.document_count} document(s)</Text>}
            </TouchableOpacity>
          )}
        />
      )}
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("WarrantyForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Item</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    filterBar: { paddingHorizontal: 16, paddingTop: 12 },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    name: { fontSize: 15, fontWeight: "700", color: c.text },
    typeTag: { fontSize: 11, color: c.primary, fontWeight: "700", textTransform: "uppercase" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    badgeRow: { flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" },
    docCount: { fontSize: 11, color: c.textSecondary, marginTop: 6 },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
