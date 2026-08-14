import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  disconnectDrive,
  getBackupHistory,
  getBackupStatus,
  getDriveAuthUrl,
  runBackup,
  updateBackupConfig,
} from "../../api/backup";
import { BackupHistoryEntry, BackupStatus } from "../../types";
import { formatDateTime } from "../../utils/format";

const FREQUENCIES: Array<BackupStatus["config"]["frequency"]> = ["hourly", "daily", "weekly"];

export default function BackupScreen() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [history, setHistory] = useState<BackupHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getBackupStatus(), getBackupHistory()]);
      setStatus(s);
      setHistory(h);
    } catch {
      // keep prior state; pull-to-refresh can retry
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

  const onConnectDrive = async () => {
    setConnecting(true);
    try {
      const { auth_url } = await getDriveAuthUrl();
      await Linking.openURL(auth_url);
      Alert.alert(
        "Continue in browser",
        "Finish connecting Google Drive in the browser that just opened, then come back and pull to refresh."
      );
    } catch {
      Alert.alert("Couldn't start", "Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  const onDisconnectDrive = () => {
    Alert.alert("Disconnect Google Drive?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          try {
            await disconnectDrive();
            await load();
          } catch {
            Alert.alert("Couldn't disconnect", "Please try again.");
          }
        },
      },
    ]);
  };

  const onRunBackup = async () => {
    setRunning(true);
    try {
      await runBackup(status?.config.destination);
      await load();
      Alert.alert("Done", "Backup completed.");
    } catch {
      Alert.alert("Backup failed", "Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const saveConfig = async (patch: Partial<BackupStatus["config"]>) => {
    if (!status) return;
    const nextConfig = { ...status.config, ...patch };
    setStatus({ ...status, config: nextConfig });
    try {
      await updateBackupConfig(patch);
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    }
  };

  if (loading || !status) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.cardTitle}>Automatic backups</Text>
          <Switch value={status.config.enabled} onValueChange={(v) => saveConfig({ enabled: v })} />
        </View>

        <Text style={styles.label}>Frequency</Text>
        <View style={styles.chipRow}>
          {FREQUENCIES.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, status.config.frequency === f && styles.chipActive]}
              onPress={() => saveConfig({ frequency: f })}
            >
              <Text style={[styles.chipText, status.config.frequency === f && styles.chipTextActive]}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Destination</Text>
        <View style={styles.chipRow}>
          {(["local", "drive"] as const).map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.chip, status.config.destination === d && styles.chipActive]}
              onPress={() => saveConfig({ destination: d })}
            >
              <Text style={[styles.chipText, status.config.destination === d && styles.chipTextActive]}>
                {d}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Google Drive</Text>
        <Text style={styles.meta}>{status.drive_connected ? "Connected" : "Not connected"}</Text>
        {status.drive_connected ? (
          <TouchableOpacity style={styles.smallButtonOutline} onPress={onDisconnectDrive}>
            <Text style={[styles.smallButtonOutlineText, { color: "#b3261e" }]}>Disconnect</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.smallButtonOutline} onPress={onConnectDrive} disabled={connecting}>
            {connecting ? <ActivityIndicator size="small" /> : <Text style={styles.smallButtonOutlineText}>Connect</Text>}
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={onRunBackup} disabled={running}>
        {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run Backup Now</Text>}
      </TouchableOpacity>

      <Text style={styles.section}>History</Text>
      {history.length === 0 && <Text style={styles.empty}>No backups yet.</Text>}
      {history.map((h) => (
        <View key={h.filename} style={styles.historyRow}>
          <View style={styles.rowMain}>
            <Text style={styles.name} numberOfLines={1}>{h.filename}</Text>
            <Text style={styles.meta}>{formatDateTime(h.created_at)} · {h.destination}</Text>
          </View>
          <Text style={styles.meta}>{(h.size / 1024).toFixed(0)} KB</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: "#f7f7f7", borderRadius: 12, padding: 14, marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  section: { fontSize: 15, fontWeight: "700", marginTop: 8, marginBottom: 10 },
  label: { fontSize: 13, fontWeight: "600", color: "#333", marginTop: 12, marginBottom: 6 },
  meta: { fontSize: 12, color: "#777", marginTop: 4 },
  empty: { color: "#888", textAlign: "center", marginTop: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#1b6b4c" },
  chipText: { color: "#333", fontSize: 13, textTransform: "capitalize" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  button: {
    marginTop: 4,
    backgroundColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  smallButtonOutline: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  smallButtonOutlineText: { color: "#1b6b4c", fontWeight: "600", fontSize: 13 },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  rowMain: { flex: 1, paddingRight: 8 },
  name: { fontSize: 13, fontWeight: "600" },
});
