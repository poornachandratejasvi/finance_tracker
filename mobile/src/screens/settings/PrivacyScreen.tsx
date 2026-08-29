import React from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";

import { clearAllLocalData } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useAppLock } from "../../context/AppLockContext";
import { ThemeColors, useTheme } from "../../context/ThemeContext";

export default function PrivacyScreen() {
  const { logout } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { supported, enabled, setEnabled } = useAppLock();
  const [toggling, setToggling] = React.useState(false);

  const onToggleLock = async (value: boolean) => {
    setToggling(true);
    try {
      await setEnabled(value);
    } finally {
      setToggling(false);
    }
  };

  const onRemoveLocalData = () => {
    Alert.alert(
      "Remove local data?",
      "This signs you out and forgets the saved server address and access tokens on this device. Your server-side data is unaffected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await clearAllLocalData();
            await logout();
          },
        },
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Biometric App Lock</Text>
          <Text style={styles.rowSubtitle}>
            {supported
              ? "Require Face ID / Fingerprint to open the app or return to it from the background."
              : "No biometrics/passcode enrolled on this device — set one up in your device Settings to use this."}
          </Text>
        </View>
        {toggling ? (
          <ActivityIndicator />
        ) : (
          <Switch value={enabled} onValueChange={onToggleLock} disabled={!supported} />
        )}
      </View>

      <Text style={styles.body}>
        Your financial data stays on your self-hosted server. You can clear everything cached
        on this device at any time. Removing local data signs you out and wipes the saved
        server address and access tokens from this device — your server-side data is
        unaffected.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onRemoveLocalData}>
        <Text style={styles.buttonText}>Remove Local Data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: 12,
      marginBottom: 20,
      gap: 12,
    },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: "600", color: c.text, marginBottom: 4 },
    rowSubtitle: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    body: { fontSize: 14, color: c.text, lineHeight: 20, marginBottom: 20 },
    button: {
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonText: { color: c.danger, fontSize: 15, fontWeight: "600" },
  });
