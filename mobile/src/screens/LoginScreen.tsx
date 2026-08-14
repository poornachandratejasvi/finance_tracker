import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useAuth } from "../context/AuthContext";
import { getServerUrl } from "../api/client";

export default function LoginScreen() {
  const { login } = useAuth();
  const [serverUrl, setServerUrl] = useState("https://finance.061295.xyz");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await getServerUrl();
      if (saved) setServerUrl(saved);
    })();
  }, []);

  const onSubmit = async () => {
    if (!serverUrl.trim() || !username.trim() || !password) {
      Alert.alert("Missing info", "Server URL, username, and password are all required.");
      return;
    }
    setSubmitting(true);
    try {
      await login(serverUrl, username.trim(), password);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert(
        "Login failed",
        typeof detail === "string" ? detail : "Check the server URL, username, and password."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Finance Tracker</Text>
        <Text style={styles.subtitle}>Sign in to your self-hosted server</Text>

        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="http://192.168.1.50:8000"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          Use the address your phone can reach — a LAN IP or your HTTPS domain, not "localhost".
        </Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#1b6b4c" },
  subtitle: { fontSize: 14, textAlign: "center", color: "#666", marginBottom: 32 },
  label: { fontSize: 13, fontWeight: "600", color: "#333", marginBottom: 4, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  hint: { fontSize: 11, color: "#888", marginTop: 4 },
  button: {
    marginTop: 28,
    backgroundColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
