import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import {
  createInsurancePolicy, deleteInsurancePolicy, deletePolicyDocument,
  listPolicyDocuments, updateInsurancePolicy, uploadPolicyDocument,
} from "../../api/insurance";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { InsurancePolicyType, PolicyDocument, PremiumFrequency } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "InsuranceForm">;

const POLICY_TYPES: InsurancePolicyType[] = ["health", "life", "home", "other"];
const PREMIUM_FREQUENCIES: PremiumFrequency[] = ["monthly", "quarterly", "yearly"];
const DOCUMENT_TYPES = ["policy_doc", "proposal", "claim", "other"];

export default function InsuranceFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.policy;

  const [policyType, setPolicyType] = useState<InsurancePolicyType>(existing?.policy_type || "health");
  const [provider, setProvider] = useState(existing?.provider || "");
  const [policyNumber, setPolicyNumber] = useState(existing?.policy_number || "");
  const [insuredName, setInsuredName] = useState(existing?.insured_name || "");
  const [premium, setPremium] = useState(existing?.premium_amount ? String(existing.premium_amount) : "");
  const [premiumFrequency, setPremiumFrequency] = useState<PremiumFrequency>(existing?.premium_frequency || "yearly");
  const [coverage, setCoverage] = useState(existing?.coverage_amount ? String(existing.coverage_amount) : "");
  const [issuedDate, setIssuedDate] = useState(existing?.issued_date || "");
  const [expiryDate, setExpiryDate] = useState(existing?.expiry_date || "");
  const [notes, setNotes] = useState(existing?.notes || "");

  const [submitting, setSubmitting] = useState(false);
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [uploadType, setUploadType] = useState("policy_doc");
  const [uploading, setUploading] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!existing) return;
    try {
      setDocuments(await listPolicyDocuments(existing.id));
    } catch {
      // best-effort
    }
  }, [existing]);

  useFocusEffect(useCallback(() => { loadDocuments(); }, [loadDocuments]));

  const onSave = async () => {
    setSubmitting(true);
    try {
      const payload = {
        policy_type: policyType,
        provider: provider.trim() || null,
        policy_number: policyNumber.trim() || null,
        insured_name: insuredName.trim() || null,
        premium_amount: premium.trim() ? parseFloat(premium) : null,
        premium_frequency: premiumFrequency,
        coverage_amount: coverage.trim() ? parseFloat(coverage) : null,
        issued_date: issuedDate.trim() || null,
        expiry_date: expiryDate.trim() || null,
        notes: notes.trim() || null,
      };
      if (existing) await updateInsurancePolicy(existing.id, payload);
      else await createInsurancePolicy(payload);
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
    Alert.alert("Delete policy?", `Remove this ${existing.policy_type} policy?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteInsurancePolicy(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const addDocument = async (fromCamera: boolean) => {
    if (!existing) {
      Alert.alert("Save first", "Save the policy before attaching documents.");
      return;
    }
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Enable access in Settings to attach a document.");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      await uploadPolicyDocument(existing.id, uploadType, uploadType, result.assets[0].uri);
      await loadDocuments();
    } catch {
      Alert.alert("Couldn't upload", "Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const removeDocument = (doc: PolicyDocument) => {
    if (!existing) return;
    Alert.alert("Remove document?", doc.title || "This document", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePolicyDocument(existing.id, doc.id);
            await loadDocuments();
          } catch {
            Alert.alert("Couldn't remove", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.label}>Type</Text>
      <ChipRow options={POLICY_TYPES} selected={policyType} onSelect={(v) => setPolicyType(v as InsurancePolicyType)} />

      <Text style={styles.label}>Provider</Text>
      <TextInput style={styles.input} value={provider} onChangeText={setProvider} />

      <Text style={styles.label}>Policy Number</Text>
      <TextInput style={styles.input} value={policyNumber} onChangeText={setPolicyNumber} />

      <Text style={styles.label}>Insured (who/what is covered)</Text>
      <TextInput style={styles.input} value={insuredName} onChangeText={setInsuredName} />

      <Text style={styles.label}>Premium Amount</Text>
      <TextInput style={styles.input} value={premium} onChangeText={setPremium} keyboardType="decimal-pad" />

      <Text style={styles.label}>Premium Frequency</Text>
      <ChipRow options={PREMIUM_FREQUENCIES} selected={premiumFrequency} onSelect={(v) => setPremiumFrequency(v as PremiumFrequency)} />

      <Text style={styles.label}>Coverage Amount</Text>
      <TextInput style={styles.input} value={coverage} onChangeText={setCoverage} keyboardType="decimal-pad" />

      <Text style={styles.label}>Issued Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={issuedDate} onChangeText={setIssuedDate} autoCapitalize="none" />

      <Text style={styles.label}>Expiry Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={expiryDate} onChangeText={setExpiryDate} autoCapitalize="none" />

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Policy</Text>
        </TouchableOpacity>
      )}

      {existing && (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Documents</Text>
          <ChipRow options={DOCUMENT_TYPES} selected={uploadType} onSelect={setUploadType} labelFor={(v) => v.replace("_", " ")} />
          <View style={styles.uploadRow}>
            <TouchableOpacity style={styles.scanButton} onPress={() => addDocument(true)} disabled={uploading}>
              <Text style={styles.scanButtonText}>{uploading ? "Uploading…" : "📷 Take Photo"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.scanButton} onPress={() => addDocument(false)} disabled={uploading}>
              <Text style={styles.scanButtonText}>🖼 Gallery</Text>
            </TouchableOpacity>
          </View>
          {documents.length === 0 ? (
            <Text style={styles.empty}>No documents uploaded yet.</Text>
          ) : (
            documents.map((doc) => (
              <View key={doc.id} style={styles.docRow}>
                <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.docTitle}>{doc.title}</Text>
                  <Text style={styles.meta}>{doc.processing ? "Archiving…" : doc.document_type}</Text>
                </View>
                {doc.url && (
                  <TouchableOpacity onPress={() => Linking.openURL(doc.url!)} style={{ padding: 6 }}>
                    <Ionicons name="open-outline" size={18} color={colors.primary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => removeDocument(doc)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: c.text, marginBottom: 8 },
    divider: { height: 1, backgroundColor: c.border, marginTop: 20, marginBottom: 16 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    multiline: { minHeight: 80, textAlignVertical: "top" },
    button: { marginTop: 28, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    deleteButton: { marginTop: 14, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
    uploadRow: { flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 12 },
    scanButton: { flex: 1, backgroundColor: c.chipBg, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
    scanButtonText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    empty: { color: c.textSecondary, marginTop: 8 },
    docRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    docTitle: { fontSize: 14, color: c.text, fontWeight: "600" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
