import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { scanReceipt } from "../api/receipts";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../navigation/RootNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Take/pick a receipt photo, send it to the server for OCR + AI extraction,
// then hand the (editable) draft off to Add Transaction rather than creating
// anything directly -- an OCR/AI guess should always get a human glance before
// it becomes a real transaction.
export default function ScanReceiptScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);

  const handleResult = async (uri: string) => {
    setBusy(true);
    try {
      const result = await scanReceipt(uri);
      if (!result.success) {
        Alert.alert("Couldn't read receipt", result.message || "Try a clearer photo, or enter it manually.", [
          { text: "Enter manually", onPress: () => navigation.navigate("Add") },
          { text: "Try again", style: "cancel" },
        ]);
        return;
      }
      navigation.navigate("Add", {
        prefill: {
          amount: result.amount,
          description: result.description,
          transaction_date: result.transaction_date,
          category: result.category,
          items: result.items,
          tax: result.tax,
          tip: result.tip,
        },
      });
    } catch (err: any) {
      if (!err?.response) {
        Alert.alert("You're offline", "Receipt scanning needs an internet connection (OCR runs on the server).");
      } else {
        Alert.alert("Couldn't scan receipt", "Please try again or enter the transaction manually.");
      }
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Enable camera access in Settings to scan a receipt.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (!result.canceled && result.assets?.[0]) {
      await handleResult(result.assets[0].uri);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo library permission needed", "Enable photo access in Settings to pick a receipt image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets?.[0]) {
      await handleResult(result.assets[0].uri);
    }
  };

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Reading receipt…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>🧾</Text>
      <Text style={styles.hint}>
        Take a photo of a receipt or pick one from your gallery. We'll try to read the amount,
        merchant, and date automatically -- you'll still get to review it before it's saved.
      </Text>
      <TouchableOpacity style={styles.button} onPress={takePhoto}>
        <Text style={styles.buttonText}>Take Photo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={pickFromLibrary}>
        <Text style={[styles.buttonText, { color: colors.primary }]}>Choose from Gallery</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background, padding: 20, justifyContent: "center" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    hint: { color: c.textSecondary, textAlign: "center", marginBottom: 28, lineHeight: 20 },
    button: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
    buttonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.primary },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });
