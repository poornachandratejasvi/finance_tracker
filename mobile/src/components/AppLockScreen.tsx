import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ThemeColors, useTheme } from "../context/ThemeContext";
import { useAppLock } from "../context/AppLockContext";

export default function AppLockScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { unlock } = useAppLock();

  useEffect(() => {
    unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.title}>Finance Tracker Locked</Text>
      <Text style={styles.subtitle}>Unlock with Face ID / Fingerprint to continue</Text>
      <TouchableOpacity style={styles.button} onPress={unlock}>
        <Text style={styles.buttonText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background, padding: 24 },
    icon: { fontSize: 48, marginBottom: 16 },
    title: { fontSize: 18, fontWeight: "700", color: c.text, marginBottom: 6 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 24, textAlign: "center" },
    button: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 32 },
    buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
