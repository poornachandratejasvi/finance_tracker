import React from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemeColors, useTheme } from "../context/ThemeContext";

// One row inside a FormGroup: [icon square] [label] ...flex... [value or
// custom right element] [chevron if tappable] -- the row shape used
// throughout the reference app's forms (Add Record, Automatic Rules, Account
// config).
export function PickerRow({
  icon,
  label,
  value,
  placeholder,
  required,
  onPress,
  rightElement,
  avatarColor,
  avatarLetter,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string | null;
  placeholder?: string;
  required?: boolean;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  // When set, renders a colored circle with a letter instead of the icon --
  // matches the reference's account-name avatar row.
  avatarColor?: string;
  avatarLetter?: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const missing = !!required && !value;
  const Wrapper: any = onPress ? TouchableOpacity : View;

  return (
    <Wrapper style={styles.row} onPress={onPress} activeOpacity={0.6}>
      {avatarColor ? (
        <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
          <Text style={styles.avatarText}>{(avatarLetter || "?").charAt(0).toUpperCase()}</Text>
        </View>
      ) : icon ? (
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={16} color={colors.text} />
        </View>
      ) : null}
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <View style={{ flex: 1 }} />
      {rightElement ? (
        rightElement
      ) : (
        <Text style={[styles.value, missing && styles.valueRequired]} numberOfLines={1}>
          {value || (missing ? "Required" : placeholder || "")}
        </Text>
      )}
      {onPress && !rightElement && (
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} style={{ marginLeft: 6 }} />
      )}
    </Wrapper>
  );
}

// A row whose right side is a toggle switch instead of a value -- e.g.
// "Balance below limit" on Account config.
export function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <PickerRow
      icon={icon}
      label={label}
      rightElement={<Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.primary }} />}
    />
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 13,
      paddingHorizontal: 14,
    },
    iconBox: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: c.chipBg,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    avatarText: { color: "#fff", fontWeight: "700", fontSize: 12 },
    label: { fontSize: 15, color: c.text, flexShrink: 1 },
    value: { fontSize: 14, color: c.textSecondary, maxWidth: 160 },
    valueRequired: { color: c.danger, fontWeight: "600" },
  });
