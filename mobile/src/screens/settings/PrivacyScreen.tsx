import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

import { clearAllLocalData } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { ThemeColors, useTheme } from "../../context/ThemeContext";

export default function PrivacyScreen() {
  const { logout } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const onRemoveLocalData = () => {
    Alert.alert(
      "Remove local data?",
      "This signs you out and forgets the saved server address and access tokens on this device. Your server-side data is unaffected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await clearAllLocalData();
            await logout();
          },
        },
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        Your financial data stays on your self-hosted server. You can clear everything cached
        on this device at any time. Removing local data signs you out and wipes the saved
        server address and access tokens from this device — your server-side data is
        unaffected.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onRemoveLocalData}>
        <Text style={styles.buttonText}>Remove Local Data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    body: { fontSize: 14, color: c.text, lineHeight: 20, marginBottom: 20 },
    button: {
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonText: { color: c.danger, fontSize: 15, fontWeight: "600" },
  });
