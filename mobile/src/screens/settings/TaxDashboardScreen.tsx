import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";

import { getTaxDashboard } from "../../api/tax";
import { deletePayslip, listPayslips, uploadPayslip } from "../../api/payslips";
import { updatePreferences } from "../../api/users";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Payslip, TaxDashboard, TaxSection } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "TaxDashboard">;

function currentFinancialYear(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function fyOptions(): string[] {
  const [startYear] = currentFinancialYear().split("-").map(Number);
  return [startYear - 1, startYear, startYear + 1].map((y) => `${y}-${String(y + 1).slice(2)}`);
}

export default function TaxDashboardScreen(_props: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [fy, setFy] = useState(currentFinancialYear());
  const [seniorCitizen, setSeniorCitizen] = useState(false);
  const [data, setData] = useState<TaxDashboard | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [rent, setRent] = useState("");
  const [metro, setMetro] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dash, ps] = await Promise.all([getTaxDashboard(fy, seniorCitizen), listPayslips().catch(() => [])]);
      setData(dash);
      setPayslips(ps);
      if (dash.hra_exemption) {
        setRent(String(dash.hra_exemption.monthly_rent || ""));
        setMetro(!!dash.hra_exemption.city_metro);
      }
    } catch {
      // keep prior state; pull-to-refresh can retry
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy, seniorCitizen]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

  const saveRentPrefs = async () => {
    setSavingPrefs(true);
    try {
      await updatePreferences({ monthly_rent: rent === "" ? 0 : parseFloat(rent), city_metro: metro });
      await load();
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    } finally {
      setSavingPrefs(false);
    }
  };

  const uploadPayslips = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: true, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    const failures: string[] = [];
    for (const asset of result.assets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await uploadPayslip(asset.uri, asset.name);
      } catch (err: any) {
        failures.push(`${asset.name}: ${err?.response?.data?.detail || "failed to parse"}`);
      }
    }
    setUploading(false);
    await load();
    if (failures.length) Alert.alert("Some payslips failed", failures.join("\n"));
  };

  const removePayslip = (p: Payslip) => {
    Alert.alert("Delete payslip?", p.month, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePayslip(p.id);
            await load();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <ChipRow options={fyOptions()} selected={fy} onSelect={setFy} />
      </View>
      <View style={styles.seniorRow}>
        <Text style={styles.seniorLabel}>Senior citizen (80D ₹50k limit)</Text>
        <Switch value={seniorCitizen} onValueChange={setSeniorCitizen} trackColor={{ true: colors.primary }} />
      </View>

      {data && (
        <>
          <TaxSectionCard title="80C" section={data.sections["80c"]} colors={colors} />
          <TaxSectionCard title="80D (Health Insurance)" section={data.sections["80d"]} colors={colors} />
          <TaxSectionCard title="80CCD(1B) — NPS" section={data.sections["80ccd_1b"]} colors={colors} />
        </>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>HRA Exemption</Text>
        <Text style={styles.meta}>Rent and city aren't on a payslip — set them here once.</Text>
        <Text style={styles.label}>Monthly Rent</Text>
        <TextInput style={styles.input} value={rent} onChangeText={setRent} keyboardType="decimal-pad" />
        <View style={styles.metroRow}>
          <Text style={styles.label}>Metro city (50% vs 40% of Basic)</Text>
          <Switch value={metro} onValueChange={setMetro} trackColor={{ true: colors.primary }} />
        </View>
        <TouchableOpacity style={styles.saveButton} onPress={saveRentPrefs} disabled={savingPrefs}>
          <Text style={styles.saveButtonText}>{savingPrefs ? "Saving…" : "Save"}</Text>
        </TouchableOpacity>
        {data?.hra_exemption?.configured ? (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.exemptionValue}>{formatCurrency(data.hra_exemption.exemption)} exempt</Text>
            <Text style={styles.meta}>
              Basic {formatCurrency(data.hra_exemption.basic_total || 0)} · HRA {formatCurrency(data.hra_exemption.hra_received_total || 0)} ·
              {" "}from {data.hra_exemption.months_on_file || 0} payslip(s)
            </Text>
          </View>
        ) : (
          <Text style={styles.meta}>Set a rent above and upload at least one payslip to see this.</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.rowTop}>
          <Text style={styles.sectionTitle}>Payslips</Text>
          <TouchableOpacity style={styles.uploadButton} onPress={uploadPayslips} disabled={uploading}>
            <Ionicons name="cloud-upload-outline" size={14} color="#fff" />
            <Text style={styles.uploadButtonText}>{uploading ? "Uploading…" : "Upload"}</Text>
          </TouchableOpacity>
        </View>
        {payslips.length === 0 ? (
          <Text style={styles.meta}>No payslips uploaded yet.</Text>
        ) : (
          payslips.map((p) => (
            <View key={p.id} style={styles.payslipRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payslipMonth}>{p.month} — {formatCurrency(p.net_pay || 0)} net</Text>
                <Text style={styles.meta}>
                  Basic {formatCurrency(p.basic || 0)} · HRA {formatCurrency(p.hra_received || 0)} · PF {formatCurrency(p.provident_fund || 0)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removePayslip(p)} style={{ padding: 6 }}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function TaxSectionCard({ title, section, colors }: { title: string; section: TaxSection; colors: ThemeColors }) {
  const styles = makeStyles(colors);
  const pct = section.limit ? Math.min(100, (section.utilized / section.limit) * 100) : 0;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.bigValue}>{formatCurrency(section.utilized)}</Text>
      <Text style={styles.meta}>of {formatCurrency(section.limit)} limit — {formatCurrency(section.remaining)} remaining</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
      </View>
      {section.breakdown.length > 0 ? (
        section.breakdown.map((b, i) => (
          <View key={i} style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{b.label}</Text>
            <Text style={styles.breakdownAmount}>{formatCurrency(b.amount)}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.meta}>Nothing tracked yet for this section.</Text>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48 },
    headerRow: { marginBottom: 8 },
    seniorRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    seniorLabel: { fontSize: 13, color: c.text, flex: 1, marginRight: 8 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 16 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 4 },
    bigValue: { fontSize: 22, fontWeight: "800", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.chipBg, overflow: "hidden", marginVertical: 10 },
    progressFill: { height: 8, borderRadius: 4 },
    breakdownRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
    breakdownLabel: { fontSize: 13, color: c.text, flex: 1 },
    breakdownAmount: { fontSize: 13, color: c.textSecondary },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 10, marginBottom: 6 },
    input: {
      borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.text,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    },
    metroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
    saveButton: { marginTop: 14, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
    saveButtonText: { color: "#fff", fontWeight: "600" },
    exemptionValue: { fontSize: 18, fontWeight: "800", color: c.primary },
    uploadButton: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
    uploadButtonText: { color: "#fff", fontSize: 12, fontWeight: "600" },
    payslipRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    payslipMonth: { fontSize: 14, fontWeight: "600", color: c.text },
  });
