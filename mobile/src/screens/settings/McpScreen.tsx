import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function McpScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        The Model Context Protocol (MCP) server lets AI assistants securely query your finance
        data through a standard tool interface. Point an MCP-compatible client at this instance
        and authenticate with a REST API token to expose your transactions, categories and
        reports as tools.
      </Text>
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Generate a token under REST API (Settings → REST API), then configure your MCP client
          to use it as the X-API-Key credential.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  body: { fontSize: 14, color: "#444", lineHeight: 20, marginBottom: 16 },
  infoBox: { backgroundColor: "#eef6f2", borderRadius: 10, padding: 14 },
  infoText: { fontSize: 13, color: "#1b6b4c" },
});
