import React, { useEffect, useState } from "react";
import Constants from "expo-constants";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

import { api } from "../../api/client";
import { ThemeColors, useTheme } from "../../context/ThemeContext";

export default function AboutScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/api/settings/system-info")
      .then(({ data }) => setBackendVersion(data.app_version))
      .catch(() => {});
  }, []);

  const appVersion = Constants.expoConfig?.version || "unknown";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.appName}>Finance Tracker</Text>
      <Text style={styles.row}>App version: {appVersion}</Text>
      {backendVersion && <Text style={styles.row}>Server version: {backendVersion}</Text>}

      <TouchableOpacity
        style={styles.link}
        onPress={() => Linking.openURL("https://github.com/poornachandratejasvi/finance_tracker")}
      >
        <Text style={styles.linkText}>View source on GitHub</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.link}
        onPress={() =>
          Linking.openURL(
            "https://github.com/poornachandratejasvi/finance_tracker/pkgs/container/finance_tracker-backend"
          )
        }
      >
        <Text style={styles.linkText}>Browse release versions</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    appName: { fontSize: 20, fontWeight: "700", marginBottom: 16, color: c.text },
    row: { fontSize: 14, color: c.text, marginBottom: 8 },
    link: { marginTop: 12 },
    linkText: { fontSize: 14, color: c.primary, fontWeight: "600" },
  });
