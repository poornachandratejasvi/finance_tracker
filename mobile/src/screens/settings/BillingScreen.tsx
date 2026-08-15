import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ThemeColors, useTheme } from "../../context/ThemeContext";

export default function BillingScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    body: { fontSize: 14, color: c.text, lineHeight: 20, marginBottom: 16 },
    successBox: { backgroundColor: c.chipBg, borderRadius: 10, padding: 14 },
    successText: { fontSize: 13, color: c.primary },
  });
