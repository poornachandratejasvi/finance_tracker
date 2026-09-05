import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { closePlannedItemOccurrence, confirmPlannedItemMatch, getPlannedItemCandidates } from "../../api/plannedItems";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { PlannedItemCandidate } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "PlannedItemMatch">;

export default function PlannedItemMatchScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { item } = route.params;
  const occurrence = item.current_occurrence;

  const [candidates, setCandidates] = useState<PlannedItemCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!occurrence) {
          setLoading(false);
          return;
        }
        setLoading(true);
        try {
          setCandidates(await getPlannedItemCandidates(occurrence.id));
        } catch {
          // keep empty list; user can go back and retry
        } finally {
          setLoading(false);
        }
      })();
    }, [occurrence?.id])
  );

  const pickCandidate = async (transactionId: number) => {
    if (!occurrence) return;
    setBusy(true);
    try {
      await confirmPlannedItemMatch(occurrence.id, transactionId);
      navigation.goBack();
    } catch {
      Alert.alert("Couldn't confirm match", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const closeNoMatch = async () => {
    if (!occurrence) return;
    setBusy(true);
    try {
      await closePlannedItemOccurrence(occurrence.id);
      navigation.goBack();
    } catch {
      Alert.alert("Couldn't close", "Please try again.");
    } finally {
      setBusy(false);
    }
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
      <Text style={styles.title}>Which transaction settles "{item.name}"?</Text>
      <FlatList
        data={candidates}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No matching transaction found automatically near the due date. You can close this cycle without one instead.
          </Text>
        }
        renderItem={({ item: c }) => (
          <TouchableOpacity style={styles.card} onPress={() => pickCandidate(c.id)} disabled={busy}>
            <Text style={styles.description} numberOfLines={1}>{c.description}</Text>
            <Text style={styles.meta}>
              {formatCurrency(c.amount)} · {c.transaction_date ? c.transaction_date.slice(0, 10) : ""}
            </Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.closeButton} onPress={closeNoMatch} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.closeButtonText}>Close without matching</Text>}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    title: { fontSize: 15, fontWeight: "700", color: c.text, padding: 16, paddingBottom: 8 },
    list: { paddingHorizontal: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 10 },
    description: { fontSize: 14, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    closeButton: { margin: 16, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    closeButtonText: { color: c.text, fontSize: 15, fontWeight: "600" },
  });
