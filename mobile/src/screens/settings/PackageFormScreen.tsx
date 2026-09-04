import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createPackage, getPackageCarriers } from "../../api/packages";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Carrier } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "PackageForm">;

export default function PackageFormScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [carrier, setCarrier] = useState("other");
  const [merchant, setMerchant] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [orderId, setOrderId] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getPackageCarriers().then(setCarriers).catch(() => setCarriers([]));
    }, [])
  );

  const onSave = async () => {
    setSubmitting(true);
    try {
      await createPackage({
        carrier,
        merchant: merchant.trim() || null,
        tracking_number: trackingNumber.trim() || null,
        order_id: orderId.trim() || null,
        item_description: itemDescription.trim() || null,
        expected_delivery_date: expectedDate.trim() || null,
      });
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.label}>Carrier</Text>
      <ChipRow
        options={carriers.map((c) => c.key)}
        selected={carrier}
        onSelect={setCarrier}
        labelFor={(key) => carriers.find((c) => c.key === key)?.label || key}
      />

      <Text style={styles.label}>Merchant</Text>
      <TextInput style={styles.input} value={merchant} onChangeText={setMerchant} />

      <Text style={styles.label}>Tracking Number</Text>
      <TextInput style={styles.input} value={trackingNumber} onChangeText={setTrackingNumber} autoCapitalize="characters" />

      <Text style={styles.label}>Order ID</Text>
      <TextInput style={styles.input} value={orderId} onChangeText={setOrderId} />

      <Text style={styles.label}>Item Description</Text>
      <TextInput style={styles.input} value={itemDescription} onChangeText={setItemDescription} />

      <Text style={styles.label}>Expected Delivery Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={expectedDate} onChangeText={setExpectedDate} autoCapitalize="none" />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });
