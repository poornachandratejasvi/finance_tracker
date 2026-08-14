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

import { listCurrencies } from "../../api/currencies";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Currency } from "../../types";

type Props = NativeStackScreenProps<SettingsStackParamList, "Currencies">;

export default function CurrenciesScreen({ navigation }: Props) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCurrencies(await listCurrencies());
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        data={currencies}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No currencies yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate("CurrencyForm", { currency: item })}
          >
            <Text style={styles.symbol}>{item.symbol}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.name}>
                {item.code} {item.name ? `— ${item.name}` : ""}
              </Text>
              <Text style={styles.meta}>1 base = {item.rate_to_base} {item.code}</Text>
            </View>
            {item.is_base && <Text style={styles.baseTag}>base</Text>}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => navigation.navigate("CurrencyForm", undefined)}
      >
        <Text style={styles.addButtonText}>+ Add Currency</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, flexGrow: 1 },
  empty: { color: "#888", textAlign: "center", marginTop: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  symbol: { fontSize: 18, width: 32 },
  rowMain: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", color: "#222" },
  meta: { fontSize: 12, color: "#777", marginTop: 2 },
  baseTag: { fontSize: 11, color: "#1b6b4c", fontWeight: "700" },
  addButton: {
    margin: 16,
    backgroundColor: "#1b6b4c",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
