import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { api, getServerUrl } from "../../api/client";
import { createApiToken } from "../../api/apiTokens";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { getSmsCredentials, setSmsCredentials, clearSmsCredentials, isSmsAutoDetectSupported } from "../../utils/smsNative";

// Fixes a real bug: SmsReceiver.kt's API token used to be baked into the APK
// at CI build time and could silently go stale (server URL changed, token
// rotated) with zero visibility. This screen lets it be (re)configured at any
// time from within the app, and a "Test" button that actually proves the
// path works end-to-end -- the missing piece that made the old setup
// unverifiable.
export default function SmsAutoDetectScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(() => {
    const creds = getSmsCredentials();
    setConfigured(!!(creds.serverUrl && creds.apiKey));
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      refresh();
      setLoading(false);
    }, [refresh])
  );

  const onToggle = async (value: boolean) => {
    if (!value) {
      clearSmsCredentials();
      refresh();
      return;
    }
    setBusy(true);
    try {
      const serverUrl = await getServerUrl();
      if (!serverUrl) throw new Error("No server URL configured");
      const { token } = await createApiToken("SMS Auto-Detect (Android)");
      setSmsCredentials(serverUrl, token);
      refresh();
      Alert.alert("Enabled", "SMS Auto-Detect is now configured. Use \"Test\" below to confirm it works.");
    } catch {
      Alert.alert("Couldn't enable", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    const creds = getSmsCredentials();
    if (!creds.serverUrl || !creds.apiKey) return;
    setTesting(true);
    try {
      await api.post(
        "/api/ingest/sms",
        { text: "Your account is debited for Rs. 1.00 (Finance Tracker connectivity test)", sender: "TEST" },
        { headers: { "X-API-Key": creds.apiKey } }
      );
      Alert.alert(
        "Test succeeded",
        "A test transaction (Rs. 1.00, sender TEST) was created — check Transactions, then delete it. This confirms the server URL + token are working."
      );
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert(
        "Test failed",
        typeof detail === "string"
          ? detail
          : "Couldn't reach the server with this token. Try disabling and re-enabling to mint a fresh one."
      );
    } finally {
      setTesting(false);
    }
  };

  if (!isSmsAutoDetectSupported()) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>SMS Auto-Detect is Android-only — iOS has no way to read SMS. Use the iOS Shortcut integration in API Access instead.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        Reads incoming bank SMS in the background and auto-creates transactions, matched to a
        bank via its SMS Sender ID (set on the account's Edit screen) or account-number-last-4.
        This toggle mints a token that's stored on-device and can be refreshed here anytime — no
        app rebuild needed if it ever stops working.
      </Text>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Enable SMS Auto-Detect</Text>
          <Text style={styles.rowMeta}>{configured ? "Configured" : "Not configured"}</Text>
        </View>
        {busy ? <ActivityIndicator /> : <Switch value={configured} onValueChange={onToggle} />}
      </View>

      {configured && (
        <TouchableOpacity style={styles.testButton} onPress={onTest} disabled={testing}>
          {testing ? <ActivityIndicator color="#fff" /> : <Text style={styles.testButtonText}>Test SMS Auto-Detect</Text>}
        </TouchableOpacity>
      )}

      <Text style={[styles.hint, { marginTop: 20 }]}>
        Also make sure "Allow SMS" is granted in your phone's system app permissions for Finance
        Tracker (Settings → Apps → Finance Tracker → Permissions) — this app only prompts for it
        once per login and silently does nothing if it was denied.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 40, backgroundColor: c.background, flexGrow: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background, padding: 24 },
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginTop: 16,
    },
    rowTitle: { fontSize: 15, fontWeight: "600", color: c.text },
    rowMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    testButton: {
      marginTop: 14,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    testButtonText: { color: "#fff", fontWeight: "600" },
  });
