import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemeColors, useTheme } from "../context/ThemeContext";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "backspace"],
];

// A custom on-screen keypad for amount entry, replacing the OS keyboard --
// matches the reference app's Add Record screen, which docks its own numeric
// pad rather than focusing a text field.
export default function NumericKeypad({
  onDigit,
  onDecimal,
  onBackspace,
  onClear,
}: {
  onDigit: (d: string) => void;
  onDecimal: () => void;
  onBackspace: () => void;
  onClear?: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.pad}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) => (
            <TouchableOpacity
              key={key}
              style={styles.key}
              activeOpacity={0.5}
              onPress={() => {
                if (key === ".") onDecimal();
                else if (key === "backspace") onBackspace();
                else onDigit(key);
              }}
              onLongPress={key === "backspace" ? onClear : undefined}
            >
              {key === "backspace" ? (
                <Ionicons name="backspace-outline" size={22} color={colors.text} />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pad: { gap: 4 },
    row: { flexDirection: "row" },
    key: {
      flex: 1,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
    },
    keyText: { fontSize: 24, fontWeight: "500", color: c.text },
  });
