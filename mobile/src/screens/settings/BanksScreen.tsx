import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { listBanks, reorderBanks } from "../../api/banks";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";
import { Bank } from "../../types";
import { formatCurrency, signedAccountBalance } from "../../utils/format";

type Props = NativeStackScreenProps<BanksStackParamList, "Banks">;

export default function BanksScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setBanks(await listBanks());
    } catch {
      // list stays whatever it was; pull-to-refresh can retry
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

  const moveBank = (index: number, direction: 1 | -1) => {
    const target = index + direction;
    if (target < 0 || target >= banks.length) return;
    const next = [...banks];
    [next[index], next[target]] = [next[target], next[index]];
    setBanks(next);
    reorderBanks(next.map((b) => b.id)).catch(() => load());
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
      <FlatList
        data={banks}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No accounts yet.</Text>}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <View style={styles.reorderCol}>
              <TouchableOpacity disabled={index === 0} onPress={() => moveBank(index, -1)} style={styles.reorderButton}>
                <Ionicons name="chevron-up" size={16} color={index === 0 ? colors.border : colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={index === banks.length - 1}
                onPress={() => moveBank(index, 1)}
                style={styles.reorderButton}
              >
                <Ionicons name="chevron-down" size={16} color={index === banks.length - 1 ? colors.border : colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.rowTouchable}
              onPress={() => navigation.navigate("BankForm", { bank: item })}
            >
              <View style={[styles.dot, { backgroundColor: item.color || colors.primary }]} />
              <View style={styles.rowMain}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.bank_type || "other"}</Text>
              </View>
              {item.bank_type === "investment" ? (
                <Text style={styles.meta}>Feeds Investments</Text>
              ) : (
                <Text style={styles.balance}>
                  {formatCurrency(signedAccountBalance(item), item.currency_code)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      />
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => navigation.navigate("BankForm", undefined)}
      >
        <Text style={styles.addButtonText}>+ Add Account</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    reorderCol: { marginRight: 8 },
    reorderButton: { paddingVertical: 2, paddingHorizontal: 4 },
    rowTouchable: { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 12 },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
    rowMain: { flex: 1 },
    name: { fontSize: 15, fontWeight: "600", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 2, textTransform: "capitalize" },
    balance: { fontSize: 14, fontWeight: "600", color: c.text },
    addButton: {
      margin: 16,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
