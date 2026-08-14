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

  const saveModel = async (provider: "claude" | "gemini" | "ollama", model: string) => {
    if (!config) return;
    setConfig({ ...config, [provider]: { ...config[provider], model } });
    try {
      await updateAIConfig({ [provider]: { model } } as any);
    } catch {
      // silent; user can retry by re-typing
    }
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
        Enabled providers are tried in order; the first that succeeds is used.
      </Text>

      {PROVIDERS.map(({ key, label }) => {
        const enabled = config.providers.includes(key);
        const keySet = key === "claude" ? config.claude_key_set : key === "gemini" ? config.gemini_key_set : true;
        return (
          <View key={key} style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.cardTitle}>{label}</Text>
              <Switch value={enabled} onValueChange={() => toggleProvider(key)} />
            </View>

            <Text style={styles.label}>Model</Text>
            <TextInput
              style={styles.input}
              value={config[key].model}
              onChangeText={(v) => saveModel(key, v)}
            />

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
