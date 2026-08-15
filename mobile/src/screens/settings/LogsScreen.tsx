import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getBackendLogs, getSystemInfo } from "../../api/logs";
import { ThemeColors, useTheme } from "../../context/ThemeContext";

export default function LogsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [system, setSystem] = useState<{ cpu_percent: number; memory_percent: number; disk_percent: number } | null>(
    null
  );
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const info = await getSystemInfo();
      if ("cpu_percent" in info) setSystem(info);
      const logResult = await getBackendLogs(200);
      setLogs(logResult.logs || "");
    } catch {
      // leave as-is; pull-to-refresh can retry
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
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {system && (
        <View style={styles.statsRow}>
          <Stat label="CPU" value={`${system.cpu_percent}%`} />
          <Stat label="Memory" value={`${system.memory_percent}%`} />
          <Stat label="Disk" value={`${system.disk_percent}%`} />
        </View>
      )}
      <Text style={styles.section}>Backend logs (last 200 lines)</Text>
      <View style={styles.logBox}>
        <Text style={styles.logText} selectable>
          {logs || "No logs available."}
        </Text>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    statsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
    stat: { flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 12, alignItems: "center" },
    statValue: { fontSize: 18, fontWeight: "700", color: c.text },
    statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    section: { fontSize: 14, fontWeight: "700", marginBottom: 8, color: c.text },
    logBox: { backgroundColor: "#1e1e1e", borderRadius: 10, padding: 12 },
    logText: { color: "#d4d4d4", fontSize: 11, fontFamily: "monospace" },
  });
