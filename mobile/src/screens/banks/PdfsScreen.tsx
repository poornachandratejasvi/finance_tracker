import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { csvDownloadPath } from "../../api/csvExports";
import { listPdfs, reprocessPdf, testPdfPassword, updatePdfPassword } from "../../api/pdfs";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";
import { PdfStatement } from "../../types";
import { formatDate } from "../../utils/format";
import { downloadAndShare } from "../../utils/download";

type Props = NativeStackScreenProps<BanksStackParamList, "Pdfs">;

export default function PdfsScreen({ route }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const bankId = route.params?.bankId;

  const [pdfs, setPdfs] = useState<PdfStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<PdfStatement | null>(null);
  const [password, setPassword] = useState("");
  const [applyToBank, setApplyToBank] = useState(true);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await listPdfs({ bank_id: bankId ? String(bankId) : undefined, limit: 100 });
      setPdfs(result.items);
    } catch {
      // keep prior list; pull-to-refresh can retry
    }
  }, [bankId]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onReprocess = async (pdf: PdfStatement) => {
    setBusyId(pdf.id);
    try {
      await reprocessPdf(pdf.id);
      await load();
      Alert.alert("Reprocessed", `${pdf.file_name} was re-parsed.`);
    } catch {
      Alert.alert("Couldn't reprocess", "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const onDownload = async (pdf: PdfStatement) => {
    setBusyId(pdf.id);
    try {
      await downloadAndShare(`/api/pdfs/${pdf.id}/download`, pdf.file_name);
    } catch {
      Alert.alert("Couldn't download", "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const openPasswordModal = (pdf: PdfStatement) => {
    setPasswordTarget(pdf);
    setPassword("");
    setApplyToBank(true);
  };

  const onSubmitPassword = async () => {
    if (!passwordTarget || !password) return;
    setSubmittingPassword(true);
    try {
      const test = await testPdfPassword(passwordTarget.id, password);
      if (!test.success) {
        Alert.alert("Wrong password", test.message || "That password didn't unlock this statement.");
        return;
      }
      await updatePdfPassword(passwordTarget.id, password, applyToBank);
      setPasswordTarget(null);
      await load();
      Alert.alert("Unlocked", "Password saved and statement decrypted.");
    } catch {
      Alert.alert("Couldn't unlock", "Please try again.");
    } finally {
      setSubmittingPassword(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        data={pdfs}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No statements found.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name} numberOfLines={1}>{item.file_name}</Text>
              <Text style={styles.meta}>
                {item.bank_name || "Unknown bank"} · {item.transaction_count} txns ·{" "}
                {item.is_processed ? "processed" : "unprocessed"}
              </Text>
              {item.email_received_date && (
                <Text style={styles.meta}>Received {formatDate(item.email_received_date)}</Text>
              )}
              {item.error_message && <Text style={styles.error}>{item.error_message}</Text>}
            </View>
            {busyId === item.id ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <View style={styles.actions}>
                {item.is_password_protected && !item.decrypted_available && (
                  <TouchableOpacity onPress={() => openPasswordModal(item)}>
                    <Text style={styles.actionLink}>Unlock</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => onReprocess(item)}>
                  <Text style={styles.actionLink}>Reprocess</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onDownload(item)}>
                  <Text style={styles.actionLink}>PDF</Text>
                </TouchableOpacity>
                {item.is_processed && (
                  <TouchableOpacity
                    onPress={() =>
                      downloadAndShare(csvDownloadPath(item.id), `${item.file_name}.csv`).catch(() =>
                        Alert.alert("Couldn't download CSV", "Please try again.")
                      )
                    }
                  >
                    <Text style={styles.actionLink}>CSV</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      />

      <Modal visible={!!passwordTarget} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Unlock {passwordTarget?.file_name}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="PDF password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.checkboxRow} onPress={() => setApplyToBank(!applyToBank)}>
              <View style={[styles.checkbox, applyToBank && styles.checkboxChecked]} />
              <Text style={styles.checkboxLabel}>Remember for this bank's future statements</Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setPasswordTarget(null)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreate}
                onPress={onSubmitPassword}
                disabled={submittingPassword || !password}
              >
                {submittingPassword ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalCreateText}>Unlock</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowMain: { flex: 1, paddingRight: 8 },
    name: { fontSize: 14, fontWeight: "600", color: c.text },
    meta: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    error: { fontSize: 11, color: c.danger, marginTop: 2 },
    actions: { flexDirection: "row", gap: 12 },
    actionLink: { color: c.primary, fontWeight: "600", fontSize: 12 },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    modalCard: { backgroundColor: c.card, borderRadius: 12, padding: 20 },
    modalTitle: { fontSize: 15, fontWeight: "700", marginBottom: 12, color: c.text },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
    },
    checkboxRow: { flexDirection: "row", alignItems: "center", marginTop: 14, gap: 10 },
    checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: c.inputBorder },
    checkboxChecked: { backgroundColor: c.primary, borderColor: c.primary },
    checkboxLabel: { fontSize: 12, color: c.text, flex: 1 },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 18, alignItems: "center" },
    modalCancel: { color: c.textSecondary, fontWeight: "600" },
    modalCreate: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
    modalCreateText: { color: "#fff", fontWeight: "600" },
  });
