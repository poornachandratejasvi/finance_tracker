import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { listPackages, refreshPackageNow } from "../../api/packages";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Package } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "Packages">;

function statusColor(status: string, c: ThemeColors): string {
  if (status === "delivered") return c.primary;
  if (status === "out_for_delivery") return c.warning;
  if (status === "unknown") return c.danger;
  return c.textSecondary;
}

export default function PackagesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setPackages(await listPackages());
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

  const trackNow = async (pkg: Package) => {
    setRefreshingId(pkg.id);
    try {
      await refreshPackageNow(pkg.id);
      await load();
    } catch (err: any) {
      Alert.alert("Couldn't refresh", err?.response?.data?.detail || "This carrier may not support live tracking.");
    } finally {
      setRefreshingId(null);
    }
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
        data={packages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No packages tracked yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{item.merchant || item.carrier}</Text>
              <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor(item.status, colors), textTransform: "uppercase" }}>
                {item.status.replace(/_/g, " ")}
              </Text>
            </View>
            <Text style={styles.meta}>{item.carrier}{item.tracking_number ? ` · ${item.tracking_number}` : ""}</Text>
            {item.item_description ? <Text style={styles.meta}>{item.item_description}</Text> : null}
            {item.expected_delivery_date ? <Text style={styles.meta}>Expected: {item.expected_delivery_date.slice(0, 10)}</Text> : null}
            <View style={styles.actionsRow}>
              {item.tracking_url && (
                <TouchableOpacity onPress={() => Linking.openURL(item.tracking_url!)} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>Track</Text>
                </TouchableOpacity>
              )}
              {item.tracking_number && (
                <TouchableOpacity onPress={() => trackNow(item)} style={styles.actionButton} disabled={refreshingId === item.id}>
                  <Text style={styles.actionButtonText}>{refreshingId === item.id ? "Refreshing…" : "Refresh Now"}</Text>
                </TouchableOpacity>
              )}
            </View>
            {item.last_tracker_error ? <Text style={styles.errorText}>{item.last_tracker_error}</Text> : null}
          </View>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("PackageForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add Package</Text>
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
    name: { fontSize: 15, fontWeight: "700", color: c.text, flex: 1 },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    actionsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    actionButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.chipBg },
    actionButtonText: { fontSize: 12, fontWeight: "700", color: c.primary },
    errorText: { fontSize: 11, color: c.warning, marginTop: 6 },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
