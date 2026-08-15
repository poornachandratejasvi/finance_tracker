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

import { createCurrency, deleteCurrency, updateCurrency } from "../../api/currencies";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "CurrencyForm">;

export default function CurrencyFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.currency;

  const [code, setCode] = useState(existing?.code || "");
  const [symbol, setSymbol] = useState(existing?.symbol || "");
  const [name, setName] = useState(existing?.name || "");
  const [rateToBase, setRateToBase] = useState(String(existing?.rate_to_base ?? "1"));
  const [isBase, setIsBase] = useState(!!existing?.is_base);
  const [submitting, setSubmitting] = useState(false);

  const onSave = async () => {
    if (!code.trim()) {
      Alert.alert("Missing code", "Enter a currency code, e.g. USD.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        symbol: symbol.trim() || undefined,
        name: name.trim() || undefined,
        rate_to_base: parseFloat(rateToBase) || 1,
        is_base: isBase,
      };
      if (existing) {
        await updateCurrency(existing.id, payload);
      } else {
        await createCurrency(payload);
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
    if (existing.is_base) {
      Alert.alert("Can't delete", "The base currency can't be deleted — set another as base first.");
      return;
    }
    Alert.alert("Delete currency?", `Remove "${existing.code}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCurrency(existing.id);
            navigation.goBack();
          } catch (err: any) {
            Alert.alert("Couldn't delete", err?.response?.data?.detail || "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Code</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="USD"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="characters"
        maxLength={3}
      />

      <Text style={styles.label}>Symbol</Text>
      <TextInput
        style={styles.input}
        value={symbol}
        onChangeText={setSymbol}
        placeholder="$"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Name (optional)</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="US Dollar"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.label}>Rate to base currency</Text>
      <TextInput
        style={styles.input}
        value={rateToBase}
        onChangeText={setRateToBase}
        keyboardType="decimal-pad"
      />

      <View style={styles.switchRow}>
        <Text style={styles.label}>Set as base currency</Text>
        <Switch value={isBase} onValueChange={setIsBase} />
      </View>

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Currency</Text>
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
    deleteButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
    deleteButtonText: { color: c.danger, fontWeight: "600" },
  });
