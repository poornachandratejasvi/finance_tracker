import React, { useEffect, useState } from "react";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
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

import { listBanks } from "../../api/banks";
import { emailLatestForBank, generateAllForBank, zipDownloadPath } from "../../api/csvExports";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";
import { Bank } from "../../types";
import { downloadAndShare } from "../../utils/download";

type Props = NativeStackScreenProps<BanksStackParamList, "CsvExports">;

export default function CsvExportsScreen({ route }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState<number | null>(route.params?.bankId ?? null);
  const [emailTo, setEmailTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    listBanks()
      .then((list) => {
        setBanks(list);
        if (bankId == null && list.length > 0) setBankId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const onGenerateAll = async () => {
    if (!bankId) return;
    setGenerating(true);
    try {
      const result = await generateAllForBank(bankId);
      Alert.alert("Started", result.message || `Queued ${result.queued} statement(s).`);
    } catch {
      Alert.alert("Couldn't generate", "Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const onDownloadZip = async () => {
    if (!bankId) return;
    setDownloading(true);
    try {
      const bankName = banks.find((b) => b.id === bankId)?.name || "statements";
      await downloadAndShare(zipDownloadPath(bankId), `${bankName}-csv-exports.zip`);
    } catch {
      Alert.alert("Couldn't download", "Make sure CSVs have been generated first.");
    } finally {
      setDownloading(false);
    }
  };

  const onEmailLatest = async () => {
    if (!bankId) return;
    setEmailing(true);
    try {
      const result = await emailLatestForBank(bankId, emailTo.trim() || undefined);
      Alert.alert("Sent", `Latest statement CSV emailed to ${result.sent_to}.`);
    } catch {
      Alert.alert("Couldn't email", "Please try again.");
    } finally {
      setEmailing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Account</Text>
      <View style={styles.chipRow}>
        {banks.map((b) => (
          <TouchableOpacity
            key={b.id}
            style={[styles.chip, bankId === b.id && styles.chipActive]}
            onPress={() => setBankId(b.id)}
          >
            <Text style={[styles.chipText, bankId === b.id && styles.chipTextActive]}>{b.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.button, (generating || !bankId) && styles.buttonDisabled]}
        onPress={onGenerateAll}
        disabled={generating || !bankId}
      >
        {generating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Generate All CSVs</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.smallButtonOutline, (downloading || !bankId) && styles.buttonDisabled]}
        onPress={onDownloadZip}
        disabled={downloading || !bankId}
      >
        {downloading ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Text style={styles.smallButtonOutlineText}>Download ZIP of All CSVs</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.label, { marginTop: 24 }]}>Email latest statement CSV</Text>
      <TextInput
        style={styles.input}
        value={emailTo}
        onChangeText={setEmailTo}
        placeholder="you@example.com (optional, uses your account email if blank)"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TouchableOpacity
        style={[styles.smallButtonOutline, (emailing || !bankId) && styles.buttonDisabled]}
        onPress={onEmailLatest}
        disabled={emailing || !bankId}
      >
        {emailing ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Text style={styles.smallButtonOutlineText}>Email Latest Statement</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        For a single statement, use the CSV button on its row under Banks → Browse Statement PDFs.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 8, marginBottom: 6 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    button: {
      marginTop: 20,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    smallButtonOutline: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 20, lineHeight: 16 },
  });
