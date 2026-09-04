import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ThemeColors, useTheme } from "../context/ThemeContext";

// A row of tappable pill chips for a single-select enum field -- same shape
// VehicleFormScreen.tsx originally defined locally; pulled out here since
// several forms now need it (thumb-friendly single-select, no picker modal).
export default function ChipRow({
  options, selected, onSelect, labelFor,
}: {
  options: string[]; selected: string; onSelect: (v: string) => void; labelFor?: (v: string) => string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const active = selected === o;
        return (
          <TouchableOpacity
            key={o}
            onPress={() => onSelect(o)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{labelFor ? labelFor(o) : o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13, textTransform: "capitalize" },
    chipTextActive: { color: "#fff" },
  });
