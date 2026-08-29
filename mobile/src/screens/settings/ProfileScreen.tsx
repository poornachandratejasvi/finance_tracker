import React, { useCallback, useEffect, useState } from "react";
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

import { changePassword, getPreferences, updatePreferences, updateProfile } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { UserPreferences } from "../../types";
import { setHideDecimals } from "../../utils/format";

const INTERVALS = ["this_month", "last_month", "this_year", "all_time"];

export default function ProfileScreen() {
  const { user, refreshUser } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [fullName, setFullName] = useState(user?.full_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const loadPrefs = useCallback(async () => {
    try {
      setPrefs(await getPreferences());
    } catch {
      // leave prefs null; screen still usable for profile/password
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setPrefsLoading(true);
        await loadPrefs();
        setPrefsLoading(false);
      })();
    }, [loadPrefs])
  );

  useEffect(() => {
    setFullName(user?.full_name || "");
    setEmail(user?.email || "");
  }, [user]);

  const onSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateProfile({ full_name: fullName.trim(), email: email.trim() });
      await refreshUser();
      Alert.alert("Saved", "Profile updated.");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't save", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert("Missing fields", "Enter your current and new password.");
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert("Password too short", "New password must be at least 8 characters.");
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      Alert.alert("Saved", "Password changed.");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      Alert.alert("Couldn't change password", typeof detail === "string" ? detail : "Please try again.");
    } finally {
      setChangingPassword(false);
    }
  };

  const savePref = async (patch: Partial<UserPreferences>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if ("hide_decimals" in patch) setHideDecimals(!!patch.hide_decimals);
    setSavingPrefs(true);
    try {
      await updatePreferences(patch);
    } catch {
      Alert.alert("Couldn't save preference", "Please try again.");
    } finally {
      setSavingPrefs(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>Profile</Text>
      <Text style={styles.label}>Display name</Text>
      <TextInput
        style={styles.input}
        value={fullName}
        onChangeText={setFullName}
        placeholderTextColor={colors.textSecondary}
      />
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholderTextColor={colors.textSecondary}
      />
      <TouchableOpacity
        style={[styles.button, savingProfile && styles.buttonDisabled]}
        onPress={onSaveProfile}
        disabled={savingProfile}
      >
        {savingProfile ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Profile</Text>}
      </TouchableOpacity>

      <Text style={[styles.section, styles.sectionSpaced]}>Change Password</Text>
      <Text style={styles.label}>Current password</Text>
      <TextInput
        style={styles.input}
        value={currentPassword}
        onChangeText={setCurrentPassword}
        secureTextEntry
        placeholderTextColor={colors.textSecondary}
      />
      <Text style={styles.label}>New password</Text>
      <TextInput
        style={styles.input}
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        placeholderTextColor={colors.textSecondary}
      />
      <TouchableOpacity
        style={[styles.button, changingPassword && styles.buttonDisabled]}
        onPress={onChangePassword}
        disabled={changingPassword}
      >
        {changingPassword ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Change Password</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.section, styles.sectionSpaced]}>Preferences</Text>
      {prefsLoading || !prefs ? (
        <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />
      ) : (
        <>
          <Text style={styles.label}>Default period</Text>
          <View style={styles.chipRow}>
            {INTERVALS.map((iv) => (
              <TouchableOpacity
                key={iv}
                style={[styles.chip, prefs.default_interval === iv && styles.chipActive]}
                onPress={() => savePref({ default_interval: iv })}
              >
                <Text style={[styles.chipText, prefs.default_interval === iv && styles.chipTextActive]}>
                  {iv.replace("_", " ")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>Hide decimals</Text>
            <Switch
              value={prefs.hide_decimals}
              onValueChange={(v) => savePref({ hide_decimals: v })}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.label}>Auto logout</Text>
            <Switch value={prefs.auto_logout} onValueChange={(v) => savePref({ auto_logout: v })} />
          </View>
          {savingPrefs && <ActivityIndicator style={{ marginTop: 8 }} color={colors.primary} />}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    section: { fontSize: 16, fontWeight: "700", color: c.text },
    sectionSpaced: { marginTop: 28 },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 6 },
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
    chipText: { color: c.text, fontSize: 13, textTransform: "capitalize" },
    chipTextActive: { color: "#fff", fontWeight: "600" },
    switchRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
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
  });
