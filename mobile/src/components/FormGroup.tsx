import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ThemeColors, useTheme } from "../context/ThemeContext";

// Matches the reference app's grouped-list form style (Add Record, Automatic
// Rules, Account config): an uppercase section header followed by a rounded
// card containing its rows, each separated by a hairline divider.
export function FormSectionHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return <Text style={styles.header}>{title}</Text>;
}

export function FormGroup({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {items.map((child, i) => (
        <View key={i} style={i < items.length - 1 ? styles.divider : undefined}>
          {child}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      fontSize: 12,
      fontWeight: "700",
      color: c.textSecondary,
      textTransform: "uppercase",
      marginTop: 20,
      marginBottom: 8,
      marginLeft: 4,
    },
    group: { backgroundColor: c.card, borderRadius: 12, overflow: "hidden" },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  });
