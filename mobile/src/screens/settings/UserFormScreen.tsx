import React, { useState } from "react";
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

import { createUser, deleteUser, leaveHousehold, updateUser } from "../../api/adminUsers";
import { useAuth } from "../../context/AuthContext";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "UserForm">;

const ROLES: Array<"USER" | "ADMIN" | "VIEWER"> = ["USER", "ADMIN", "VIEWER"];

export default function UserFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.user;
  const { user: currentUser } = useAuth();

  const [username, setUsername] = useState(existing?.username || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [fullName, setFullName] = useState(existing?.full_name || "");
  const [role, setRole] = useState(existing?.role || "USER");
  const [isActive, setIsActive] = useState(existing?.is_active !== false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!existing && (!username.trim() || !email.trim() || !password)) {
      Alert.alert("Missing fields", "Username, email, and password are all required.");
      return;
    }
    setSubmitting(true);
    try {
      if (existing) {
        await updateUser(existing.id, {
          email: email.trim(),
          full_name: fullName.trim() || undefined,
          role,
          is_active: isActive,
          password: password || undefined,
        });
      } else {
        await createUser({
          username: username.trim(),
          email: email.trim(),
          password,
          full_name: fullName.trim() || undefined,
          role,
        });
      }
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
    if (currentUser && existing.id === currentUser.id) {
      Alert.alert("Can't delete", "You can't delete your own account.");
      return;
    }
    Alert.alert("Delete user?", `Remove "${existing.username}"? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteUser(existing.id);
            navigation.goBack();
          } catch (err: any) {
            Alert.alert("Couldn't delete", err?.response?.data?.detail || "Please try again.");
          }
        },
      },
    ]);
  };

  const onLeaveHousehold = () => {
    if (!existing) return;
    Alert.alert("Leave household?", "This moves them to a fresh, private household.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        onPress: async () => {
          try {
            await leaveHousehold(existing.id);
            Alert.alert("Done", "User moved to a private household.");
          } catch {
            Alert.alert("Couldn't complete", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {!existing && (
        <>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholderTextColor={colors.textSecondary}
          />
        </>
      )}

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Full name</Text>
      <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholderTextColor={colors.textSecondary} />

      <Text style={styles.label}>Role</Text>
      <View style={styles.chipRow}>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.chip, role === r && styles.chipActive]}
            onPress={() => setRole(r)}
          >
            <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{existing ? "New password (optional)" : "Password"}</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholderTextColor={colors.textSecondary}
      />

      {existing && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>Active</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>
      )}

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.smallButtonOutline} onPress={onLeaveHousehold}>
          <Text style={styles.smallButtonOutlineText}>Leave Household</Text>
        </TouchableOpacity>
      )}

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete User</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 16, marginBottom: 6 },
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
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 13 },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    switchRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 8,
    },
    button: {
      marginTop: 28,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    smallButtonOutline: {
      marginTop: 14,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    smallButtonOutlineText: { color: c.primary, fontWeight: "600", fontSize: 13 },
    deleteButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
