import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ThemeColors, useTheme } from "../context/ThemeContext";

export type TxnMode = "expense" | "income" | "transfer";

// The Expense/Income/Transfer pill switcher shared by Add/Edit Transaction --
// a single fully-rounded track with the active segment as a solid pill inside
// it, matching the reference app's segmented control.
export default function TypeSegmentedControl({ mode, onChange }: { mode: TxnMode; onChange: (m: TxnMode) => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const options: { key: TxnMode; label: string }[] = [
    { key: "expense", label: "Expense" },
    { key: "income", label: "Income" },
    { key: "transfer", label: "Transfer" },
  ];
  return (
    <View style={styles.track}>
      {options.map((o) => {
        const active = mode === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(o.key)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      backgroundColor: c.chipBg,
      borderRadius: 22,
      padding: 3,
    },
    segment: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 19,
      alignItems: "center",
    },
    segmentActive: { backgroundColor: c.card, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
    segmentText: { fontSize: 13, fontWeight: "600", color: c.textSecondary },
    segmentTextActive: { color: c.text },
  });
