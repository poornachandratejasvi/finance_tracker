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

import { listAutopayMandates } from "../../api/autopayMandates";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { AutopayMandate } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "AutopayMandates">;

function statusColor(status: string, c: ThemeColors): string {
  if (status === "active") return c.primary;
  if (status === "paused") return c.warning;
  return c.textSecondary;
}

export default function AutopayMandatesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [mandates, setMandates] = useState<AutopayMandate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setMandates(await listAutopayMandates());
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        data={mandates}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No autopay mandates tracked yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("AutopayMandateForm", { mandate: item })}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{item.merchant_name}</Text>
              <Text style={{ color: statusColor(item.status, colors), fontSize: 12, fontWeight: "700", textTransform: "capitalize" }}>
                {item.status}
              </Text>
            </View>
            <Text style={styles.meta}>
              {item.max_amount ? formatCurrency(item.max_amount) : "No limit"} · {item.frequency}
              {item.next_debit_date ? ` · Next ${item.next_debit_date}` : ""}
            </Text>
            {item.upi_vpa ? <Text style={styles.meta}>{item.upi_vpa}</Text> : null}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("AutopayMandateForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Mandate</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    name: { fontSize: 15, fontWeight: "700", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
