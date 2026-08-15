import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { clearStuckSyncs, fetchActiveSyncs, fetchRecentSyncs, startSync } from "../../api/sync";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SyncLog } from "../../types";
import { formatDateTime } from "../../utils/format";

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  success: "Success",
  partial: "Partial",
  failed: "Failed",
};

export default function JobsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [active, setActive] = useState<SyncLog[]>([]);
  const [recent, setRecent] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [act, rec] = await Promise.all([fetchActiveSyncs(), fetchRecentSyncs(15)]);
      setActive(act);
      setRecent(rec);
    } catch {
      // keep prior state; pull-to-refresh can retry
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (active.length > 0) {
      pollRef.current = setInterval(load, 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [active.length, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onStartSync = async () => {
    setStarting(true);
    try {
      await startSync({ sync_type: "incremental" });
      await load();
    } catch {
      Alert.alert("Couldn't start sync", "Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const onClearStuck = async () => {
    try {
      const result = await clearStuckSyncs();
      await load();
      Alert.alert("Cleared", `${result.cleared} stuck job(s) marked failed.`);
    } catch {
      Alert.alert("Couldn't clear", "Please try again.");
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
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, starting && styles.buttonDisabled]} onPress={onStartSync} disabled={starting}>
          {starting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run Sync Now</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallButtonOutline} onPress={onClearStuck}>
          <Text style={styles.smallButtonOutlineText}>Clear Stuck</Text>
        </TouchableOpacity>
      </View>

      {active.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Active</Text>
          {active.map((job) => {
            const pct =
              job.total_emails && job.total_emails > 0
                ? Math.min(100, Math.round(((job.processed_emails || 0) / job.total_emails) * 100))
                : null;
            return (
              <View key={job.sync_log_id} style={styles.jobRow}>
                <View style={styles.jobHeader}>
                  <Text style={styles.jobType}>{job.sync_type || "sync"}</Text>
                  <Text style={styles.jobStatus}>{STATUS_LABELS[job.status] || job.status}</Text>
                </View>
                {job.current_step && <Text style={styles.meta}>{job.current_step}</Text>}
                {pct != null && (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent</Text>
        {recent.length === 0 && <Text style={styles.empty}>No sync history yet.</Text>}
        {recent.map((job) => (
          <View key={job.sync_log_id} style={styles.recentRow}>
            <View style={styles.rowMain}>
              <Text style={styles.jobType}>
                {job.sync_type || "sync"} · {job.gmail_email || "all accounts"}
              </Text>
              <Text style={styles.meta}>
                {job.transactions_added} added · {job.duplicates_found} dupes · {formatDateTime(job.started_at)}
              </Text>
              {job.error_message && <Text style={styles.error}>{job.error_message}</Text>}
            </View>
            <Text
              style={[
                styles.jobStatus,
                { color: job.status === "failed" ? colors.danger : job.status === "success" ? colors.primary : colors.textSecondary },
              ]}
            >
              {STATUS_LABELS[job.status] || job.status}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    buttonRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    button: {
      flex: 1,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
    smallButtonOutline: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.danger, fontWeight: "600", fontSize: 13 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 10 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 8 },
    jobRow: { marginBottom: 12 },
    jobHeader: { flexDirection: "row", justifyContent: "space-between" },
    jobType: { fontSize: 13, fontWeight: "600", color: c.text, textTransform: "capitalize" },
    jobStatus: { fontSize: 12, fontWeight: "700", color: c.textSecondary },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    error: { fontSize: 12, color: c.danger, marginTop: 2 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.chipBg, overflow: "hidden", marginTop: 6 },
    progressFill: { height: 6, borderRadius: 3 },
    recentRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowMain: { flex: 1, paddingRight: 8 },
  });
