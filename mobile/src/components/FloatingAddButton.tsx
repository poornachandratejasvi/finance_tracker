import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_MARGIN } from "../navigation/tabBarMetrics";

type RootNav = NativeStackNavigationProp<RootStackParamList>;

// The floating "+" for quick-add only ever appears on Dashboard in the
// reference app -- Records gets its own header "+" instead, and Statistics/
// More get none at all -- so this is a per-screen component, not a global
// tab-bar overlay (which is what put it on every tab before).
export default function FloatingAddButton() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const rootNavigation: RootNav = navigation.getParent?.() || navigation;
  return (
    <TouchableOpacity
      style={[styles.fab, { backgroundColor: colors.primary }]}
      onPress={() => rootNavigation.navigate("Add")}
      activeOpacity={0.85}
    >
      <Ionicons name="add" size={28} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + 14,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
