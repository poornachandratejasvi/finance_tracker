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

import { listInsurancePolicies } from "../../api/insurance";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { InsurancePolicy } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "Insurance">;

const TYPES = ["all", "health", "life", "home", "other"];

function expiryColor(days: number | null, c: ThemeColors): string {
  if (days == null) return c.textSecondary;
  if (days < 0) return c.danger;
  if (days <= 30) return c.warning;
  return c.primary;
}

export default function InsuranceScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (type: string) => {
    try {
      setPolicies(await listInsurancePolicies(type === "all" ? undefined : type));
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
        <ChipRow options={TYPES} selected={filter} onSelect={setFilter} />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={policies}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={styles.empty}>No insurance policies tracked yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.is_active && styles.cardInactive]}
              onPress={() => navigation.navigate("InsuranceForm", { policy: item })}
            >
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.provider || item.policy_type}</Text>
                <Text style={styles.typeTag}>{item.policy_type}</Text>
              </View>
              {item.insured_name ? <Text style={styles.meta}>Covers: {item.insured_name}</Text> : null}
              {item.premium_amount ? (
                <Text style={styles.meta}>{formatCurrency(item.premium_amount)} / {item.premium_frequency}</Text>
              ) : null}
              {item.expiry_date ? (
                <Text style={{ color: expiryColor(item.days_until_expiry, colors), fontSize: 12, fontWeight: "700", marginTop: 6 }}>
                  {(item.days_until_expiry ?? 0) < 0 ? `Expired ${item.expiry_date}` : `Expires ${item.expiry_date}`}
                </Text>
              ) : null}
              {item.document_count > 0 && <Text style={styles.docCount}>{item.document_count} document(s)</Text>}
            </TouchableOpacity>
          )}
        />
      )}
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("InsuranceForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Policy</Text>
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
    cardInactive: { opacity: 0.6 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    name: { fontSize: 15, fontWeight: "700", color: c.text },
    typeTag: { fontSize: 11, color: c.primary, fontWeight: "700", textTransform: "uppercase" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    docCount: { fontSize: 11, color: c.textSecondary, marginTop: 6 },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
