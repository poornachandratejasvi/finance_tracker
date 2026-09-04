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
  createWarranty, deleteWarranty, deleteWarrantyDocument,
  listWarrantyDocuments, updateWarranty, uploadWarrantyDocument,
} from "../../api/warranties";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { PolicyDocument, WarrantyCategory } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "WarrantyForm">;

const CATEGORIES: WarrantyCategory[] = ["electronics", "appliance", "furniture", "other"];
const DOCUMENT_TYPES = ["invoice", "warranty_card", "amc_contract", "other"];

export default function WarrantyFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.warranty;

  const [itemName, setItemName] = useState(existing?.item_name || "");
  const [category, setCategory] = useState<WarrantyCategory>(existing?.category || "electronics");
  const [vendor, setVendor] = useState(existing?.vendor || "");
  const [purchaseDate, setPurchaseDate] = useState(existing?.purchase_date || "");
  const [purchaseAmount, setPurchaseAmount] = useState(existing?.purchase_amount ? String(existing.purchase_amount) : "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(existing?.warranty_expiry || "");
  const [amcExpiry, setAmcExpiry] = useState(existing?.amc_expiry || "");
  const [amcProvider, setAmcProvider] = useState(existing?.amc_provider || "");
  const [notes, setNotes] = useState(existing?.notes || "");

  const [submitting, setSubmitting] = useState(false);
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [uploadType, setUploadType] = useState("invoice");
  const [uploading, setUploading] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!existing) return;
    try {
      setDocuments(await listWarrantyDocuments(existing.id));
    } catch {
      // best-effort
    }
  }, [existing]);

  useFocusEffect(useCallback(() => { loadDocuments(); }, [loadDocuments]));

  const onSave = async () => {
    if (!itemName.trim()) {
      Alert.alert("Missing field", "Enter the item name.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        item_name: itemName.trim(),
        category,
        vendor: vendor.trim() || null,
        purchase_date: purchaseDate.trim() || null,
        purchase_amount: purchaseAmount.trim() ? parseFloat(purchaseAmount) : null,
        warranty_expiry: warrantyExpiry.trim() || null,
        amc_expiry: amcExpiry.trim() || null,
        amc_provider: amcProvider.trim() || null,
        notes: notes.trim() || null,
      };
      if (existing) await updateWarranty(existing.id, payload);
      else await createWarranty(payload);
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
    Alert.alert("Delete warranty?", `Remove "${existing.item_name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteWarranty(existing.id);
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
      Alert.alert("Save first", "Save the item before attaching documents.");
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
      await uploadWarrantyDocument(existing.id, uploadType, uploadType, result.assets[0].uri);
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
            await deleteWarrantyDocument(existing.id, doc.id);
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
      <Text style={styles.label}>Item Name</Text>
      <TextInput style={styles.input} value={itemName} onChangeText={setItemName} />

      <Text style={styles.label}>Category</Text>
      <ChipRow options={CATEGORIES} selected={category} onSelect={(v) => setCategory(v as WarrantyCategory)} />

      <Text style={styles.label}>Vendor</Text>
      <TextInput style={styles.input} value={vendor} onChangeText={setVendor} />

      <Text style={styles.label}>Purchase Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={purchaseDate} onChangeText={setPurchaseDate} autoCapitalize="none" />

      <Text style={styles.label}>Purchase Amount</Text>
      <TextInput style={styles.input} value={purchaseAmount} onChangeText={setPurchaseAmount} keyboardType="decimal-pad" />

      <Text style={styles.label}>Warranty Expiry (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={warrantyExpiry} onChangeText={setWarrantyExpiry} autoCapitalize="none" />

      <Text style={styles.label}>AMC Expiry (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={amcExpiry} onChangeText={setAmcExpiry} autoCapitalize="none" />

      <Text style={styles.label}>AMC Provider</Text>
      <TextInput style={styles.input} value={amcProvider} onChangeText={setAmcProvider} />

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Item</Text>
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
