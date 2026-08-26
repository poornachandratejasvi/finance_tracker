import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { api } from "../../api/client";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { getSmsCredentials, isSmsAutoDetectSupported, querySmsInbox } from "../../utils/smsNative";
import { NativeSmsMessage } from "../../../modules/financetracker-native/src/FinancetrackerNative.types";
import { formatDate } from "../../utils/format";

// Browses the phone's EXISTING SMS inbox (unlike the always-on background
// receiver, which only reacts to NEW incoming SMS) so a user can search for
// and manually import older bank messages -- e.g. ones that arrived before
// SMS Auto-Detect was enabled. Each selected message is sent through the
// exact same /api/ingest/sms endpoint (bank-matching + AI fallback + dedup),
// just triggered manually instead of automatically.
export default function SmsImportScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<NativeSmsMessage[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Record<string, "ok" | "skip" | "error">>({});

  const configured = useMemo(() => {
    const creds = getSmsCredentials();
    return !!(creds.serverUrl && creds.apiKey);
  }, []);

  const load = useCallback((query: string) => {
    try {
      setMessages(querySmsInbox(0, query, 200));
    } catch {
      setMessages([]);
      Alert.alert("Couldn't read SMS", "Make sure SMS permission is granted in your phone's system settings.");
    }
  }, []);

  useEffect(() => { load(""); }, [load]);

  const onSearch = (text: string) => {
    setSearch(text);
    load(text);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onImport = async () => {
    const creds = getSmsCredentials();
    if (!creds.apiKey || !messages) return;
    setImporting(true);
    const newResults: Record<string, "ok" | "skip" | "error"> = {};
    for (const id of selected) {
      const msg = messages.find((m) => m.id === id);
      if (!msg) continue;
      try {
        await api.post(
          "/api/ingest/sms",
          { text: msg.body, sender: msg.sender },
          { headers: { "X-API-Key": creds.apiKey } }
        );
        newResults[id] = "ok";
      } catch (err: any) {
        newResults[id] = err?.response?.status === 422 ? "skip" : "error";
      }
    }
    setResults(newResults);
    setImporting(false);
    const ok = Object.values(newResults).filter((r) => r === "ok").length;
    const skip = Object.values(newResults).filter((r) => r === "skip").length;
    const error = Object.values(newResults).filter((r) => r === "error").length;
    Alert.alert(
      "Import finished",
      `${ok} imported${skip ? `, ${skip} skipped (no amount found)` : ""}${error ? `, ${error} failed` : ""}.`
    );
    setSelected(new Set());
  };

  if (!isSmsAutoDetectSupported()) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Importing from SMS is Android-only — iOS has no way to read the SMS inbox.</Text>
      </View>
    );
  }

  if (!configured) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>
          Enable SMS Auto-Detect first (Settings → SMS Auto-Detect) — this screen reuses that same
          token to import selected messages.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={onSearch}
        placeholder="Search by sender or text (e.g. HDFCBK, debited)"
        placeholderTextColor={colors.textSecondary}
      />
      {messages === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No matching messages.</Text>}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            const result = results[item.id];
            return (
              <TouchableOpacity style={styles.row} onPress={() => toggle(item.id)}>
                <View style={[styles.checkbox, isSelected && styles.checkboxChecked]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sender}>{item.sender}</Text>
                  <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                  <Text style={styles.date}>{formatDate(new Date(item.date).toISOString())}</Text>
                </View>
                {result && (
                  <Text style={[styles.resultTag, { color: result === "ok" ? colors.primary : result === "skip" ? colors.textSecondary : colors.danger }]}>
                    {result === "ok" ? "✓" : result === "skip" ? "—" : "✕"}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
      {selected.size > 0 && (
        <TouchableOpacity style={styles.importButton} onPress={onImport} disabled={importing}>
          {importing ? <ActivityIndicator color="#fff" /> : <Text style={styles.importButtonText}>Import Selected ({selected.size})</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background, padding: 24 },
    hint: { fontSize: 13, color: c.textSecondary, textAlign: "center", lineHeight: 19 },
    search: {
      margin: 16,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    },
    list: { padding: 16, paddingTop: 8, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    checkbox: {
      width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: c.border, marginTop: 2,
    },
    checkboxChecked: { backgroundColor: c.primary, borderColor: c.primary },
    sender: { fontSize: 13, fontWeight: "700", color: c.text },
    body: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
    date: { fontSize: 11, color: c.textSecondary, marginTop: 4 },
    resultTag: { fontSize: 16, fontWeight: "700", marginTop: 4 },
    importButton: {
      margin: 16,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    importButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
