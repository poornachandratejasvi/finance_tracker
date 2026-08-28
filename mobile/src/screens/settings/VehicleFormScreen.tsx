import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";

import {
  createVehicle, createVehiclePolicy, deleteVehicle, scanVehicleDocument,
  updateVehicle, updateVehiclePolicy,
} from "../../api/vehicles";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "VehicleForm">;

const VEHICLE_TYPES = ["car", "bike", "scooter", "commercial", "other"];
const FUEL_TYPES = ["", "petrol", "diesel", "electric", "cng", "hybrid"];
const POLICY_TYPES = ["comprehensive", "third_party"];

export default function VehicleFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.vehicle;
  const existingPolicy = existing?.current_policy;

  const [registrationNumber, setRegistrationNumber] = useState(existing?.registration_number || "");
  const [nickname, setNickname] = useState(existing?.nickname || "");
  const [vehicleType, setVehicleType] = useState(existing?.vehicle_type || "car");
  const [make, setMake] = useState(existing?.make || "");
  const [model, setModel] = useState(existing?.model || "");
  const [fuelType, setFuelType] = useState(existing?.fuel_type || "");

  const [provider, setProvider] = useState(existingPolicy?.provider || "");
  const [policyNumber, setPolicyNumber] = useState(existingPolicy?.policy_number || "");
  const [policyType, setPolicyType] = useState(existingPolicy?.policy_type || "comprehensive");
  const [premium, setPremium] = useState(existingPolicy?.premium_amount ? String(existingPolicy.premium_amount) : "");
  const [startDate, setStartDate] = useState(existingPolicy?.start_date || "");
  const [expiryDate, setExpiryDate] = useState(existingPolicy?.expiry_date || "");

  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const scan = async (docType: "rc" | "insurance") => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Enable camera access in Settings to scan a document.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;

    setScanning(true);
    try {
      const r = await scanVehicleDocument(docType, result.assets[0].uri);
      if (!r.success) {
        Alert.alert("Couldn't read document", r.message || "Try a clearer photo, or enter it manually.");
        return;
      }
      if (docType === "rc") {
        if (r.registration_number) setRegistrationNumber(r.registration_number);
        if (r.make) setMake(r.make);
        if (r.model) setModel(r.model);
        if (r.fuel_type) setFuelType(r.fuel_type);
      } else {
        if (r.provider) setProvider(r.provider);
        if (r.policy_number) setPolicyNumber(r.policy_number);
        if (r.policy_type) setPolicyType(r.policy_type);
        if (r.premium_amount) setPremium(String(r.premium_amount));
        if (r.start_date) setStartDate(r.start_date);
        if (r.expiry_date) setExpiryDate(r.expiry_date);
      }
    } catch (err: any) {
      if (!err?.response) {
        Alert.alert("You're offline", "Document scanning needs an internet connection (OCR runs on the server).");
      } else {
        Alert.alert("Couldn't scan document", "Please try again.");
      }
    } finally {
      setScanning(false);
    }
  };

  const onSave = async () => {
    if (!registrationNumber.trim()) {
      Alert.alert("Missing field", "Enter the registration number.");
      return;
    }
    setSubmitting(true);
    try {
      const vehiclePayload = {
        registration_number: registrationNumber.trim(),
        nickname: nickname.trim() || null,
        vehicle_type: vehicleType,
        make: make.trim() || null,
        model: model.trim() || null,
        fuel_type: fuelType || null,
      };
      const vehicle = existing ? await updateVehicle(existing.id, vehiclePayload) : await createVehicle(vehiclePayload);

      const hasPolicyInput = provider.trim() || policyNumber.trim() || premium.trim() || startDate.trim() || expiryDate.trim();
      if (hasPolicyInput) {
        const policyPayload = {
          provider: provider.trim() || null,
          policy_number: policyNumber.trim() || null,
          policy_type: policyType,
          premium_amount: premium.trim() ? parseFloat(premium) : null,
          start_date: startDate.trim() || null,
          expiry_date: expiryDate.trim() || null,
        };
        if (existingPolicy) {
          await updateVehiclePolicy(existingPolicy.id, policyPayload);
        } else {
          await createVehiclePolicy(vehicle.id, policyPayload);
        }
      }
      navigation.goBack();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = () => {
    if (!existing) return;
    Alert.alert("Delete vehicle?", `Remove "${existing.nickname || existing.registration_number}" and its policies?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteVehicle(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.scanButton} onPress={() => scan("rc")} disabled={scanning}>
        <Text style={styles.scanButtonText}>{scanning ? "Reading…" : "📷 Scan RC Photo (auto-fill)"}</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Registration Number</Text>
      <TextInput style={styles.input} value={registrationNumber} onChangeText={setRegistrationNumber} autoCapitalize="characters" />

      <Text style={styles.label}>Nickname (optional)</Text>
      <TextInput style={styles.input} value={nickname} onChangeText={setNickname} />

      <Text style={styles.label}>Type</Text>
      <ChipRow options={VEHICLE_TYPES} selected={vehicleType} onSelect={setVehicleType} colors={colors} />

      <Text style={styles.label}>Make</Text>
      <TextInput style={styles.input} value={make} onChangeText={setMake} />

      <Text style={styles.label}>Model</Text>
      <TextInput style={styles.input} value={model} onChangeText={setModel} />

      <Text style={styles.label}>Fuel Type</Text>
      <ChipRow options={FUEL_TYPES} selected={fuelType} onSelect={setFuelType} colors={colors} labelFor={(v) => v || "—"} />

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Insurance Policy</Text>

      <TouchableOpacity style={styles.scanButton} onPress={() => scan("insurance")} disabled={scanning}>
        <Text style={styles.scanButtonText}>{scanning ? "Reading…" : "📷 Scan Insurance Document (auto-fill)"}</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Provider</Text>
      <TextInput style={styles.input} value={provider} onChangeText={setProvider} />

      <Text style={styles.label}>Policy Number</Text>
      <TextInput style={styles.input} value={policyNumber} onChangeText={setPolicyNumber} />

      <Text style={styles.label}>Policy Type</Text>
      <ChipRow options={POLICY_TYPES} selected={policyType} onSelect={setPolicyType} colors={colors} />

      <Text style={styles.label}>Premium Amount</Text>
      <TextInput style={styles.input} value={premium} onChangeText={setPremium} keyboardType="decimal-pad" />

      <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} autoCapitalize="none" />

      <Text style={styles.label}>Expiry Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={expiryDate} onChangeText={setExpiryDate} autoCapitalize="none" />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Vehicle</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function ChipRow({
  options, selected, onSelect, colors, labelFor,
}: {
  options: string[]; selected: string; onSelect: (v: string) => void; colors: ThemeColors; labelFor?: (v: string) => string;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
      {options.map((o) => {
        const active = selected === o;
        return (
          <TouchableOpacity
            key={o}
            onPress={() => onSelect(o)}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
              backgroundColor: active ? colors.primary : colors.chipBg,
            }}
          >
            <Text style={{ color: active ? "#fff" : colors.text, fontSize: 13 }}>{labelFor ? labelFor(o) : o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: c.text, marginBottom: 4 },
    divider: { height: 1, backgroundColor: c.border, marginTop: 20 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    scanButton: { backgroundColor: c.chipBg, borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 12 },
    scanButtonText: { color: c.primary, fontWeight: "600", fontSize: 14 },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    deleteButton: { marginTop: 14, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
