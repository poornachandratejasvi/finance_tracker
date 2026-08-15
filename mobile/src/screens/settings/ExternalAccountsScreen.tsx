import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  checkGmailAccountNow,
  disconnectGmailAccount,
  getGmailAuthUrl,
  getGmailStatus,
  syncAlertsNow,
} from "../../api/gmailAccounts";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { GmailAccountStatus } from "../../types";
import { formatDateTime } from "../../utils/format";

export default function ExternalAccountsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const STATUS_COLORS: Record<string, string> = {
    connected: colors.primary,
    error: colors.danger,
    reauth_required: colors.warning,
  };
  const [accounts, setAccounts] = useState<GmailAccountStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { accounts: list } = await getGmailStatus();
      setAccounts(list);
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

  const onConnect = async () => {
    setConnecting(true);
    try {
      const { auth_url } = await getGmailAuthUrl();
      await Linking.openURL(auth_url);
      Alert.alert(
        "Continue in browser",
        "Finish linking in the browser that just opened, then come back here and pull to refresh."
      );
    } catch {
      Alert.alert("Couldn't start linking", "Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  const onCheckNow = async (id: number) => {
    try {
      await checkGmailAccountNow(id);
      await load();
    } catch {
      Alert.alert("Couldn't check", "Please try again.");
    }
  };

  const onSyncAlerts = async () => {
    try {
      const { created } = await syncAlertsNow();
      Alert.alert("Synced", `${created} new alert(s) found.`);
    } catch {
      Alert.alert("Couldn't sync", "Please try again.");
    }
  };

  const onDisconnect = (account: GmailAccountStatus) => {
    Alert.alert("Disconnect account?", account.email, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          try {
            await disconnectGmailAccount(account.id);
            await load();
          } catch {
            Alert.alert("Couldn't disconnect", "Please try again.");
          }
        },
      },
    ]);
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
      <Text style={styles.hint}>
        Linked Gmail accounts are scanned for bank statement PDFs and real-time transaction
        alert emails.
      </Text>

      {accounts.length === 0 && <Text style={styles.empty}>No Gmail accounts linked yet.</Text>}

      {accounts.map((acc) => (
        <View key={acc.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.email}>{acc.email}</Text>
            <Text style={[styles.status, { color: STATUS_COLORS[acc.status] || colors.textSecondary }]}>
              {acc.status.replace("_", " ")}
            </Text>
          </View>
          <Text style={styles.meta}>
            Last synced: {acc.last_synced ? formatDateTime(acc.last_synced) : "never"}
          </Text>
          {acc.last_error && <Text style={styles.error}>{acc.last_error}</Text>}
          <View style={styles.cardActions}>
            <TouchableOpacity onPress={() => onCheckNow(acc.id)}>
              <Text style={styles.actionLink}>Check now</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onDisconnect(acc)}>
              <Text style={[styles.actionLink, styles.danger]}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <TouchableOpacity style={[styles.button, connecting && styles.buttonDisabled]} onPress={onConnect} disabled={connecting}>
        {connecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>+ Link Gmail Account</Text>}
      </TouchableOpacity>

      {accounts.length > 0 && (
        <TouchableOpacity style={styles.smallButtonOutline} onPress={onSyncAlerts}>
          <Text style={styles.smallButtonOutlineText}>Sync Alerts Now</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    hint: { fontSize: 12, color: c.textSecondary, marginBottom: 16 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 20 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    email: { fontSize: 15, fontWeight: "700", flexShrink: 1, color: c.text },
    status: { fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    error: { fontSize: 12, color: c.danger, marginTop: 4 },
    cardActions: { flexDirection: "row", gap: 20, marginTop: 10 },
    actionLink: { color: c.primary, fontWeight: "600", fontSize: 13 },
    danger: { color: c.danger },
    button: {
      marginTop: 8,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    smallButtonOutline: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
  });
