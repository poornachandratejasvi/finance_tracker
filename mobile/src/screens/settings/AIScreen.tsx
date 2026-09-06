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

import { getAIConfig, testAIProvider, updateAIConfig } from "../../api/ai";
import { AIConfig } from "../../types";

const PROVIDERS: Array<{ key: "claude" | "gemini" | "ollama"; label: string }> = [
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
  { key: "ollama", label: "Ollama (local)" },
];
const providerLabel = (key: string) => PROVIDERS.find((p) => p.key === key)?.label || key;

const FEATURES: Array<keyof AIConfig["features"]> = [
  "categorize",
  "insights",
  "predict",
  "query",
  "anomalies",
  "summary",
];

export default function AIScreen() {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyInputs, setKeyInputs] = useState<{ claude?: string; gemini?: string }>({});
  const [modelInputs, setModelInputs] = useState<{ claude?: string; gemini?: string; ollama?: string }>({});
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConfig(await getAIConfig());
    } catch {
      // leave config null; screen shows nothing until retry via refocus
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

  const toggleProvider = async (key: string) => {
    if (!config) return;
    const providers = config.providers.includes(key)
      ? config.providers.filter((p) => p !== key)
      : [...config.providers, key];
    const next = { ...config, providers };
    setConfig(next);
    try {
      await updateAIConfig({ providers });
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    }
  };

  const moveProvider = async (index: number, dir: -1 | 1) => {
    if (!config) return;
    const target = index + dir;
    if (target < 0 || target >= config.providers.length) return;
    const providers = [...config.providers];
    [providers[index], providers[target]] = [providers[target], providers[index]];
    setConfig({ ...config, providers });
    try {
      await updateAIConfig({ providers });
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    }
  };

  // ---- Per-provider ordered model list (tried in order; if all fail, the
  // server automatically falls back to live-discovered alternates) ----------
  const saveModels = async (provider: "claude" | "gemini" | "ollama", models: string[]) => {
    if (!config) return;
    setConfig({ ...config, [provider]: { ...config[provider], models } });
    try {
      await updateAIConfig({ [provider]: { models } } as any);
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    }
  };

  const moveModel = (provider: "claude" | "gemini" | "ollama", index: number, dir: -1 | 1) => {
    if (!config) return;
    const models = [...config[provider].models];
    const target = index + dir;
    if (target < 0 || target >= models.length) return;
    [models[index], models[target]] = [models[target], models[index]];
    saveModels(provider, models);
  };

  const removeModel = (provider: "claude" | "gemini" | "ollama", index: number) => {
    if (!config) return;
    const models = config[provider].models.filter((_, i) => i !== index);
    saveModels(provider, models);
  };

  const addModel = (provider: "claude" | "gemini" | "ollama") => {
    if (!config) return;
    const value = (modelInputs[provider] || "").trim();
    if (!value) return;
    if (config[provider].models.includes(value)) {
      setModelInputs((prev) => ({ ...prev, [provider]: "" }));
      return;
    }
    saveModels(provider, [...config[provider].models, value]);
    setModelInputs((prev) => ({ ...prev, [provider]: "" }));
  };

  const saveKey = async (provider: "claude" | "gemini") => {
    const key = keyInputs[provider];
    if (!key) return;
    try {
      await updateAIConfig(
        provider === "claude" ? { claude_key: key } : { gemini_key: key }
      );
      setKeyInputs((prev) => ({ ...prev, [provider]: undefined }));
      await load();
      Alert.alert("Saved", `${provider === "claude" ? "Claude" : "Gemini"} API key updated.`);
    } catch {
      Alert.alert("Couldn't save key", "Please try again.");
    }
  };

  const toggleFeature = async (feature: keyof AIConfig["features"]) => {
    if (!config) return;
    const value = !config.features[feature];
    setConfig({ ...config, features: { ...config.features, [feature]: value } });
    try {
      await updateAIConfig({ features: { [feature]: value } });
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    }
  };

  const onTest = async (provider: string) => {
    setTesting(provider);
    try {
      const result = await testAIProvider(provider);
      Alert.alert(result.ok ? "Connected" : "Failed", result.message);
    } catch (err: any) {
      Alert.alert("Test failed", err?.response?.data?.detail || "Please try again.");
    } finally {
      setTesting(null);
    }
  };

  if (loading || !config) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>
        Enabled providers are tried in this order; the first that succeeds is used. Within a
        provider, its models are tried in the order below before falling back automatically.
      </Text>

      {config.providers.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Provider priority</Text>
          {config.providers.map((key, idx) => (
            <View key={key} style={styles.orderRow}>
              <View style={styles.orderBadge}>
                <Text style={styles.orderBadgeText}>{idx + 1}</Text>
              </View>
              <Text style={styles.orderLabel}>{providerLabel(key)}</Text>
              <TouchableOpacity
                style={styles.orderButton}
                disabled={idx === 0}
                onPress={() => moveProvider(idx, -1)}
              >
                <Text style={[styles.orderButtonText, idx === 0 && styles.orderButtonTextDisabled]}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.orderButton}
                disabled={idx === config.providers.length - 1}
                onPress={() => moveProvider(idx, 1)}
              >
                <Text
                  style={[
                    styles.orderButtonText,
                    idx === config.providers.length - 1 && styles.orderButtonTextDisabled,
                  ]}
                >
                  ▼
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {PROVIDERS.map(({ key, label }) => {
        const enabled = config.providers.includes(key);
        const keySet = key === "claude" ? config.claude_key_set : key === "gemini" ? config.gemini_key_set : true;
        const models = config[key].models;
        return (
          <View key={key} style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.cardTitle}>{label}</Text>
              <Switch value={enabled} onValueChange={() => toggleProvider(key)} />
            </View>

            <Text style={styles.label}>Models (tried in order)</Text>
            {models.length === 0 && (
              <Text style={styles.emptyModels}>
                No models added — live-discovered models will be tried automatically.
              </Text>
            )}
            {models.map((m, idx) => (
              <View key={`${m}-${idx}`} style={styles.orderRow}>
                <View style={styles.orderBadge}>
                  <Text style={styles.orderBadgeText}>{idx + 1}</Text>
                </View>
                <Text style={styles.orderLabel} numberOfLines={1}>{m}</Text>
                <TouchableOpacity style={styles.orderButton} disabled={idx === 0} onPress={() => moveModel(key, idx, -1)}>
                  <Text style={[styles.orderButtonText, idx === 0 && styles.orderButtonTextDisabled]}>▲</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.orderButton}
                  disabled={idx === models.length - 1}
                  onPress={() => moveModel(key, idx, 1)}
                >
                  <Text style={[styles.orderButtonText, idx === models.length - 1 && styles.orderButtonTextDisabled]}>▼</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.orderButton} onPress={() => removeModel(key, idx)}>
                  <Text style={styles.removeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.addInput]}
                value={modelInputs[key] || ""}
                onChangeText={(v) => setModelInputs((prev) => ({ ...prev, [key]: v }))}
                placeholder="Add a model name"
                autoCapitalize="none"
                onSubmitEditing={() => addModel(key)}
              />
              <TouchableOpacity style={styles.addButton} onPress={() => addModel(key)}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {(key === "claude" || key === "gemini") && (
              <>
                <Text style={styles.label}>
                  API key {keySet ? "(set — leave blank to keep)" : "(not set)"}
                </Text>
                <TextInput
                  style={styles.input}
                  value={keyInputs[key] || ""}
                  onChangeText={(v) => setKeyInputs((prev) => ({ ...prev, [key]: v }))}
                  secureTextEntry
                  placeholder="Paste API key"
                />
                <TouchableOpacity style={styles.smallButton} onPress={() => saveKey(key)}>
                  <Text style={styles.smallButtonText}>Save Key</Text>
                </TouchableOpacity>
              </>
            )}

            {key === "ollama" && (
              <>
                <Text style={styles.label}>Base URL</Text>
                <TextInput
                  style={styles.input}
                  value={config.ollama.base_url}
                  onChangeText={(v) =>
                    setConfig({ ...config, ollama: { ...config.ollama, base_url: v } })
                  }
                  onEndEditing={() => updateAIConfig({ ollama: { base_url: config.ollama.base_url } })}
                  autoCapitalize="none"
                />
              </>
            )}

            <TouchableOpacity
              style={styles.smallButtonOutline}
              onPress={() => onTest(key)}
              disabled={testing === key}
            >
              {testing === key ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={styles.smallButtonOutlineText}>Test Connection</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      })}

      <Text style={styles.section}>Features</Text>
      <View style={styles.card}>
        {FEATURES.map((f) => (
          <View key={f} style={styles.switchRow}>
            <Text style={styles.label}>{f}</Text>
            <Switch value={config.features[f]} onValueChange={() => toggleFeature(f)} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 16, paddingBottom: 48 },
  hint: { fontSize: 12, color: "#888", marginBottom: 16 },
  section: { fontSize: 15, fontWeight: "700", marginTop: 8, marginBottom: 10 },
  card: { backgroundColor: "#f7f7f7", borderRadius: 12, padding: 14, marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600", color: "#333", marginTop: 10, marginBottom: 6, textTransform: "capitalize" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
  },
  orderBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#1b6b4c",
    alignItems: "center",
    justifyContent: "center",
  },
  orderBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  orderLabel: { flex: 1, fontSize: 13, color: "#333" },
  orderButton: { paddingHorizontal: 6, paddingVertical: 2 },
  orderButtonText: { fontSize: 13, color: "#1b6b4c", fontWeight: "700" },
  orderButtonTextDisabled: { color: "#ccc" },
  removeButtonText: { fontSize: 13, color: "#c0392b", fontWeight: "700" },
  emptyModels: { fontSize: 12, color: "#888", marginTop: 2 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  addInput: { flex: 1 },
  addButton: { backgroundColor: "#1b6b4c", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  addButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  smallButton: {
    marginTop: 10,
    backgroundColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  smallButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  smallButtonOutline: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  smallButtonOutlineText: { color: "#1b6b4c", fontWeight: "600", fontSize: 13 },
});
