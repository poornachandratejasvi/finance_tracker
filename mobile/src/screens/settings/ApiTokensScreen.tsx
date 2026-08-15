import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { createApiToken, listApiTokens, revokeApiToken } from "../../api/apiTokens";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { ApiToken } from "../../types";
import { formatDate } from "../../utils/format";

export default function ApiTokensScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await listApiTokens());
    } catch {
      // keep prior list; pull-to-refresh can retry
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

  const onCreate = async () => {
    setCreating(true);
    try {
      const result = await createApiToken(newTokenName.trim() || "API Token");
      setNameModalVisible(false);
      setNewTokenName("");
      setRevealedToken(result.token);
      await load();
    } catch {
      Alert.alert("Couldn't create token", "Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = (token: ApiToken) => {
    Alert.alert("Revoke token?", `"${token.name || "Unnamed"}" will stop working immediately.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: async () => {
          try {
            await revokeApiToken(token.id);
            await load();
          } catch {
            Alert.alert("Couldn't revoke", "Please try again.");
          }
        },
      },
    ]);
  };

  const copyToken = async () => {
    if (!revealedToken) return;
    await Clipboard.setStringAsync(revealedToken);
    Alert.alert("Copied", "Token copied to clipboard.");
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
      <Text style={styles.hint}>
        Long-lived tokens for external clients (iOS Shortcuts, webhooks, scripts) using the
        X-API-Key ingestion path. Same mechanism the Add Transaction Siri Shortcut uses.
      </Text>
      <FlatList
        data={tokens}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No API tokens yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{item.name || "Unnamed"}</Text>
              <Text style={styles.meta}>
                {item.token_prefix}… · {item.last_used_at ? `used ${formatDate(item.last_used_at)}` : "never used"}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onRevoke(item)}>
              <Text style={styles.revoke}>Revoke</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => setNameModalVisible(true)}>
        <Text style={styles.addButtonText}>+ Create Token</Text>
      </TouchableOpacity>

      <Modal visible={nameModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this token</Text>
            <TextInput
              style={styles.input}
              value={newTokenName}
              onChangeText={setNewTokenName}
              placeholder="e.g. iPhone Shortcut"
              placeholderTextColor={colors.textSecondary}
              autoFocus={Platform.OS !== "web"}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setNameModalVisible(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreate} onPress={onCreate} disabled={creating}>
                {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!revealedToken} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Token created</Text>
            <Text style={styles.hint}>Copy it now — it won't be shown again.</Text>
            <Text selectable style={styles.tokenText}>
              {revealedToken}
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setRevealedToken(null)}>
                <Text style={styles.modalCancel}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreate} onPress={copyToken}>
                <Text style={styles.modalCreateText}>Copy</Text>
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
    hint: { fontSize: 12, color: c.textSecondary, padding: 16, paddingBottom: 0 },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowMain: { flex: 1 },
    name: { fontSize: 15, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    revoke: { color: c.danger, fontWeight: "600" },
    addButton: {
      margin: 16,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    modalCard: { backgroundColor: c.card, borderRadius: 12, padding: 20 },
    modalTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12, color: c.text },
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
    tokenText: {
      fontSize: 13,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      backgroundColor: c.chipBg,
      color: c.text,
      padding: 10,
      borderRadius: 8,
      marginTop: 10,
    },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 18, alignItems: "center" },
    modalCancel: { color: c.textSecondary, fontWeight: "600" },
    modalCreate: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
    modalCreateText: { color: "#fff", fontWeight: "600" },
  });
