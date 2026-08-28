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

import { listVehicles, getExpiringPolicies } from "../../api/vehicles";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { ExpiringPolicy, Vehicle } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "Vehicles">;

function expiryColor(days: number | null, c: ThemeColors): string {
  if (days == null) return c.textSecondary;
  if (days <= 15) return c.danger;
  if (days <= 45) return c.warning;
  return c.primary;
}

export default function VehiclesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [expiring, setExpiring] = useState<ExpiringPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [vs, exp] = await Promise.all([listVehicles(), getExpiringPolicies(45)]);
      setVehicles(vs);
      setExpiring(exp);
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
        data={vehicles}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          expiring.length > 0 ? (
            <View style={styles.expiringBanner}>
              <Text style={styles.expiringText}>
                {expiring.length} polic{expiring.length === 1 ? "y" : "ies"} expiring soon:{" "}
                {expiring
                  .map((p) => `${p.vehicle_nickname || p.vehicle_registration_number} (${(p.days_until_expiry ?? 0) < 0 ? "expired" : `${p.days_until_expiry}d`})`)
                  .join(", ")}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.empty}>No vehicles added yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("VehicleForm", { vehicle: item })}>
            <Text style={styles.name}>{item.nickname || item.registration_number}</Text>
            <Text style={styles.meta}>
              {item.registration_number} · {[item.make, item.model].filter(Boolean).join(" ") || item.vehicle_type}
            </Text>
            {item.current_policy ? (
              <View style={styles.policyRow}>
                <Text style={styles.meta}>{item.current_policy.provider || "Insurance"} · {formatCurrency(item.current_policy.premium_amount || 0)}</Text>
                <Text style={{ color: expiryColor(item.current_policy.days_until_expiry, colors), fontSize: 12, fontWeight: "700" }}>
                  {(item.current_policy.days_until_expiry ?? 0) < 0 ? "Expired" : `${item.current_policy.days_until_expiry}d left`}
                </Text>
              </View>
            ) : (
              <Text style={[styles.meta, { marginTop: 6 }]}>No insurance policy recorded.</Text>
            )}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("VehicleForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Vehicle</Text>
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
    expiringBanner: { backgroundColor: c.chipBg, borderRadius: 10, padding: 12, marginBottom: 12 },
    expiringText: { color: c.warning, fontSize: 12, fontWeight: "600" },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    name: { fontSize: 15, fontWeight: "700", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    policyRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
