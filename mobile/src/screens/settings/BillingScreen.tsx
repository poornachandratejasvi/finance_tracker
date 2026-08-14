import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function BillingScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        This is a self-hosted instance — there is no subscription or billing tied to your
        account. All features are available without a paid plan.
      </Text>
      <View style={styles.successBox}>
        <Text style={styles.successText}>You are on the self-hosted plan. Nothing to pay.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  body: { fontSize: 14, color: "#444", lineHeight: 20, marginBottom: 16 },
  successBox: { backgroundColor: "#e8f5e9", borderRadius: 10, padding: 14 },
  successText: { fontSize: 13, color: "#1b6b4c" },
});
