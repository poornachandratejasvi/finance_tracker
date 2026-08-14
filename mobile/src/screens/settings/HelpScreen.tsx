import React, { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

import { getServerUrl } from "../../api/client";

export default function HelpScreen() {
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => {
    getServerUrl().then(setServerUrl);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        Find guides on connecting banks, importing statements, categorising transactions and
        setting up automatic rules in the documentation.
      </Text>
      {serverUrl && (
        <TouchableOpacity onPress={() => Linking.openURL(`${serverUrl}/docs`)}>
          <Text style={styles.link}>Open API documentation</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={() =>
          Linking.openURL("https://github.com/poornachandratejasvi/finance_tracker")
        }
      >
        <Text style={styles.link}>Open project on GitHub</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  body: { fontSize: 14, color: "#444", lineHeight: 20, marginBottom: 20 },
  link: { fontSize: 14, color: "#1b6b4c", fontWeight: "600", marginBottom: 14 },
});
