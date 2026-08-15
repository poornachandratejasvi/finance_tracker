import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  createWatcher,
  deleteWatcher,
  detectRecurringWatchers,
  getDiscordWebhook,
  getNotifyUrls,
  getScheduleConfig,
  listWatchers,
  runWatchersNow,
  saveDiscordWebhook,
  saveNotifyUrls,
  saveScheduleConfig,
  testDiscordWebhook,
  testNotifyUrls,
  updateWatcher,
} from "../../api/automation";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { ScheduleConfig, Watcher, WatcherFrequency, WatcherSuggestion } from "../../types";

const FREQUENCIES: Array<ScheduleConfig["frequency"]> = ["hourly", "every4h", "daily", "weekly"];
const WATCHER_FREQUENCIES: WatcherFrequency[] = ["daily", "weekly", "monthly", "yearly"];
const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export default function AutomationScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [suggestions, setSuggestions] = useState<WatcherSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [notifyUrlsText, setNotifyUrlsText] = useState("");
  const [savingNotifyUrls, setSavingNotifyUrls] = useState(false);
  const [testingNotifyUrls, setTestingNotifyUrls] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [runningWatchers, setRunningWatchers] = useState(false);

  const [editingWatcher, setEditingWatcher] = useState<Watcher | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [wName, setWName] = useState("");
  const [wKeywords, setWKeywords] = useState("");
  const [wAmount, setWAmount] = useState("");
  const [wFrequency, setWFrequency] = useState<WatcherFrequency>("monthly");
  const [savingWatcher, setSavingWatcher] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sched, discord, notify, watcherList] = await Promise.all([
        getScheduleConfig(),
        getDiscordWebhook(),
        getNotifyUrls(),
        listWatchers(),
      ]);
      setSchedule(sched);
      setWebhookUrl(discord.webhook_url || "");
      setNotifyUrlsText((notify.urls || []).join("\n"));
      setWatchers(watcherList);
    } catch {
      // keep prior state; pull-to-refresh can retry
    }
  }, []);

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

  const saveSchedulePatch = async (patch: Partial<ScheduleConfig>) => {
    if (!schedule) return;
    const next = { ...schedule, ...patch };
    setSchedule(next);
    setSavingSchedule(true);
    try {
      await saveScheduleConfig(patch);
    } catch {
      Alert.alert("Couldn't save schedule", "Please try again.");
    } finally {
      setSavingSchedule(false);
    }
  };

  const onSaveWebhook = async () => {
    setSavingWebhook(true);
    try {
      await saveDiscordWebhook(webhookUrl.trim());
      Alert.alert("Saved", "Discord webhook updated.");
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    } finally {
      setSavingWebhook(false);
    }
  };

  const onTestWebhook = async () => {
    setTestingWebhook(true);
    try {
      const result = await testDiscordWebhook();
      Alert.alert(result.success ? "Sent" : "Failed", result.message || (result.success ? "Test message sent." : "Couldn't send."));
    } catch {
      Alert.alert("Couldn't test", "Please try again.");
    } finally {
      setTestingWebhook(false);
    }
  };

  const onSaveNotifyUrls = async () => {
    setSavingNotifyUrls(true);
    try {
      const urls = notifyUrlsText.split("\n").map((u) => u.trim()).filter(Boolean);
      await saveNotifyUrls(urls);
      Alert.alert("Saved", "Notification services updated.");
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    } finally {
      setSavingNotifyUrls(false);
    }
  };

  const onTestNotifyUrls = async () => {
    setTestingNotifyUrls(true);
    try {
      const result = await testNotifyUrls();
      Alert.alert(result.success ? "Sent" : "Failed", result.message || (result.success ? "Test message sent." : "Couldn't send."));
    } catch {
      Alert.alert("Couldn't test", "Please try again.");
    } finally {
      setTestingNotifyUrls(false);
    }
  };

  const openAddWatcher = () => {
    setEditingWatcher(null);
    setWName("");
    setWKeywords("");
    setWAmount("");
    setWFrequency("monthly");
    setModalVisible(true);
  };

  const openEditWatcher = (w: Watcher) => {
    setEditingWatcher(w);
    setWName(w.name);
    setWKeywords(w.match_keywords.join(", "));
    setWAmount(w.match_amount != null ? String(w.match_amount) : "");
    setWFrequency(w.frequency);
    setModalVisible(true);
  };

  const openSuggestion = (s: WatcherSuggestion) => {
    setEditingWatcher(null);
    setWName(s.suggested_keywords[0] || s.bank_name || "Recurring transaction");
    setWKeywords(s.suggested_keywords.join(", "));
    setWAmount(s.match_amount != null ? String(s.match_amount) : "");
    setWFrequency("monthly");
    setModalVisible(true);
  };

  const onSaveWatcher = async () => {
    const keywords = wKeywords.split(",").map((k) => k.trim()).filter(Boolean);
    if (!wName.trim() || keywords.length === 0) {
      Alert.alert("Missing fields", "Give it a name and at least one keyword.");
      return;
    }
    setSavingWatcher(true);
    try {
      const payload = {
        name: wName.trim(),
        match_keywords: keywords,
        match_amount: wAmount ? parseFloat(wAmount) : undefined,
        frequency: wFrequency,
      };
      if (editingWatcher) {
        await updateWatcher(editingWatcher.id, payload);
      } else {
        await createWatcher(payload);
      }
      setModalVisible(false);
      await load();
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    } finally {
      setSavingWatcher(false);
    }
  };

  const onDeleteWatcher = () => {
    if (!editingWatcher) return;
    Alert.alert("Delete watcher?", `Remove "${editingWatcher.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteWatcher(editingWatcher.id);
            setModalVisible(false);
            await load();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  const onDetectRecurring = async () => {
    setDetecting(true);
    try {
      setSuggestions(await detectRecurringWatchers());
    } catch {
      Alert.alert("Couldn't detect", "Please try again.");
    } finally {
      setDetecting(false);
    }
  };

  const onRunWatchersNow = async () => {
    setRunningWatchers(true);
    try {
      await runWatchersNow();
      await load();
      Alert.alert("Done", "Reminders created for this period's active watchers.");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't run", typeof detail === "string" ? detail : "Google Tasks may not be connected yet.");
    } finally {
      setRunningWatchers(false);
    }
  };

  if (loading || !schedule) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.sectionTitle}>Scheduled Sync</Text>
          <Switch value={schedule.enabled} onValueChange={(v) => saveSchedulePatch({ enabled: v })} />
        </View>
        <Text style={styles.label}>Frequency</Text>
        <View style={styles.chipRow}>
          {FREQUENCIES.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, schedule.frequency === f && styles.chipActive]}
              onPress={() => saveSchedulePatch({ frequency: f })}
            >
              <Text style={[styles.chipText, schedule.frequency === f && styles.chipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {(schedule.frequency === "daily" || schedule.frequency === "weekly") && (
          <>
            <Text style={styles.label}>Hour of day (0-23, UTC)</Text>
            <TextInput
              style={styles.input}
              value={String(schedule.hour)}
              onChangeText={(v) => saveSchedulePatch({ hour: Math.max(0, Math.min(23, parseInt(v, 10) || 0)) })}
              keyboardType="number-pad"
            />
          </>
        )}
        {schedule.frequency === "weekly" && (
          <>
            <Text style={styles.label}>Day of week</Text>
            <View style={styles.chipRow}>
              {DAYS.map((d) => (
                <TouchableOpacity
                  key={d.value}
                  style={[styles.chip, schedule.day_of_week === d.value && styles.chipActive]}
                  onPress={() => saveSchedulePatch({ day_of_week: d.value })}
                >
                  <Text style={[styles.chipText, schedule.day_of_week === d.value && styles.chipTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <View style={styles.switchRow}>
          <Text style={styles.label}>Notify on completion</Text>
          <Switch
            value={schedule.notify_on_completion}
            onValueChange={(v) => saveSchedulePatch({ notify_on_completion: v })}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.label}>Auto-generate CSVs</Text>
          <Switch
            value={schedule.auto_generate_csv}
            onValueChange={(v) => saveSchedulePatch({ auto_generate_csv: v })}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.label}>Email CSV after sync</Text>
          <Switch
            value={schedule.csv_email_on_sync}
            onValueChange={(v) => saveSchedulePatch({ csv_email_on_sync: v })}
          />
        </View>
        {savingSchedule && <ActivityIndicator style={{ marginTop: 8 }} color={colors.primary} />}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Discord Webhook</Text>
        <TextInput
          style={styles.input}
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          placeholder="https://discord.com/api/webhooks/..."
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.smallButtonOutline, styles.flexButton]} onPress={onSaveWebhook} disabled={savingWebhook}>
            {savingWebhook ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Save</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButtonOutline, styles.flexButton]} onPress={onTestWebhook} disabled={testingWebhook}>
            {testingWebhook ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Test</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Other Notification Services</Text>
        <Text style={styles.hint}>
          Powered by Apprise — add one service URL per line (Telegram, Slack, email, ntfy, Pushover, and 100+
          others). Sent alongside the Discord webhook above.
        </Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={notifyUrlsText}
          onChangeText={setNotifyUrlsText}
          placeholder={"tgram://bottoken/ChatID\nmailto://user:pass@gmail.com\nntfy://topic"}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          multiline
          textAlignVertical="top"
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.smallButtonOutline, styles.flexButton]} onPress={onSaveNotifyUrls} disabled={savingNotifyUrls}>
            {savingNotifyUrls ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Save</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButtonOutline, styles.flexButton]} onPress={onTestNotifyUrls} disabled={testingNotifyUrls}>
            {testingNotifyUrls ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Test</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Reminders (Watchers)</Text>
        {watchers.length === 0 && <Text style={styles.empty}>No watchers yet.</Text>}
        {watchers.map((w) => (
          <TouchableOpacity key={w.id} style={styles.watcherRow} onPress={() => openEditWatcher(w)}>
            <View style={styles.rowMain}>
              <Text style={styles.watcherName}>{w.name}</Text>
              <Text style={styles.meta}>
                {w.match_keywords.join(", ")} · {w.frequency} {w.current_period ? `· ${w.current_period}` : ""}
              </Text>
            </View>
            {!w.is_active && <Text style={styles.inactive}>off</Text>}
            {w.is_active && w.cleared_at && <Text style={styles.cleared}>cleared</Text>}
          </TouchableOpacity>
        ))}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.smallButtonOutline, styles.flexButton]} onPress={openAddWatcher}>
            <Text style={styles.smallButtonOutlineText}>+ Add Watcher</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButtonOutline, styles.flexButton]} onPress={onDetectRecurring} disabled={detecting}>
            {detecting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Detect</Text>}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.smallButtonOutline} onPress={onRunWatchersNow} disabled={runningWatchers}>
          {runningWatchers ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallButtonOutlineText}>Run Watchers Now</Text>}
        </TouchableOpacity>

        {suggestions.length > 0 && (
          <View style={styles.suggestionsBox}>
            <Text style={styles.label}>Suggestions</Text>
            {suggestions.map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggestionRow} onPress={() => openSuggestion(s)}>
                <Text style={styles.meta} numberOfLines={1}>
                  {s.suggested_keywords.join(", ")} {s.bank_name ? `(${s.bank_name})` : ""}
                </Text>
                <Text style={styles.actionLink}>+ Add</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingWatcher ? "Edit Watcher" : "New Watcher"}</Text>
            <TextInput
              style={styles.input}
              value={wName}
              onChangeText={setWName}
              placeholder="Name"
              placeholderTextColor={colors.textSecondary}
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={wKeywords}
              onChangeText={setWKeywords}
              placeholder="Keywords, comma-separated"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={wAmount}
              onChangeText={setWAmount}
              placeholder="Amount (optional)"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
            <View style={[styles.chipRow, { marginTop: 8 }]}>
              {WATCHER_FREQUENCIES.map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.chip, wFrequency === f && styles.chipActive]}
                  onPress={() => setWFrequency(f)}
                >
                  <Text style={[styles.chipText, wFrequency === f && styles.chipTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              {editingWatcher && (
                <TouchableOpacity onPress={onDeleteWatcher} style={{ marginRight: "auto" }}>
                  <Text style={{ color: colors.danger, fontWeight: "600" }}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreate} onPress={onSaveWatcher} disabled={savingWatcher}>
                {savingWatcher ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 14 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 12, marginBottom: 6 },
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
    multilineInput: { minHeight: 80, marginBottom: 8 },
    hint: { fontSize: 12, color: c.textSecondary, marginBottom: 10, lineHeight: 17 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 12, textTransform: "capitalize" },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
    buttonRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    flexButton: { flex: 1 },
    smallButtonOutline: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 8 },
    watcherRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowMain: { flex: 1, paddingRight: 8 },
    watcherName: { fontSize: 14, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    inactive: { fontSize: 11, color: c.textSecondary, fontWeight: "600" },
    cleared: { fontSize: 11, color: c.primary, fontWeight: "600" },
    suggestionsBox: { marginTop: 12 },
    suggestionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    actionLink: { color: c.primary, fontWeight: "600", fontSize: 12 },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    modalCard: { backgroundColor: c.card, borderRadius: 12, padding: 20 },
    modalTitle: { fontSize: 15, fontWeight: "700", marginBottom: 12, color: c.text },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 18, alignItems: "center" },
    modalCancel: { color: c.textSecondary, fontWeight: "600" },
    modalCreate: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
    modalCreateText: { color: "#fff", fontWeight: "600" },
  });
