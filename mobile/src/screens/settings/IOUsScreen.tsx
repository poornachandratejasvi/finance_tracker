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

import { listIOUs } from "../../api/ious";
import ChipRow from "../../components/ChipRow";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";
import { Iou, IouDirection, IouListResponse } from "../../types";
import { formatCurrency } from "../../utils/format";

type Props = NativeStackScreenProps<SettingsStackParamList, "IOUs">;

export default function IOUsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [data, setData] = useState<IouListResponse>({ items: [], total_owed_to_me: 0, total_i_owe: 0 });
  const [tab, setTab] = useState<IouDirection>("lent");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listIOUs());
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

  const items = data.items.filter((i) => i.direction === tab);

  return (
    <View style={styles.flex}>
      <View style={styles.heroRow}>
        <View style={[styles.heroCard, { backgroundColor: colors.chipBg }]}>
          <Text style={styles.heroLabel}>Owed to me</Text>
          <Text style={[styles.heroValue, { color: colors.primary }]}>{formatCurrency(data.total_owed_to_me)}</Text>
        </View>
        <View style={[styles.heroCard, { backgroundColor: colors.chipBg }]}>
          <Text style={styles.heroLabel}>I owe</Text>
          <Text style={[styles.heroValue, { color: colors.danger }]}>{formatCurrency(data.total_i_owe)}</Text>
        </View>
      </View>

      <View style={styles.filterBar}>
        <ChipRow
          options={["lent", "borrowed"]}
          selected={tab}
          onSelect={(v) => setTab(v as IouDirection)}
          labelFor={(v) => (v === "lent" ? "Owed to me" : "I owe")}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
          renderItem={({ item }) => (
            <IouRow
              item={item}
              colors={colors}
              onPress={() => navigation.navigate("IOUForm", { iou: item })}
              onRecordPayment={() => navigation.navigate("IOUPaymentForm", { iou: item })}
            />
          )}
        />
      )}
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate("IOUForm", undefined)}>
        <Text style={styles.addButtonText}>+ Add IOU</Text>
      </TouchableOpacity>
    </View>
  );
}

function IouRow({
  item, colors, onPress, onRecordPayment,
}: { item: Iou; colors: ThemeColors; onPress: () => void; onRecordPayment: () => void }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={[styles.card, item.status === "settled" && styles.cardSettled]} onPress={onPress}>
      <View style={styles.rowTop}>
        <Text style={styles.name}>{item.person_name}</Text>
        <Text style={{ fontSize: 11, fontWeight: "700", color: item.status === "settled" ? colors.textSecondary : colors.primary, textTransform: "uppercase" }}>
          {item.status}
        </Text>
      </View>
      <Text style={styles.meta}>
        Principal {formatCurrency(item.principal_amount)} on {item.iou_date}
        {item.due_date ? ` · Due ${item.due_date}` : ""}
      </Text>
      <View style={styles.rowBottom}>
        <Text style={styles.outstanding}>Outstanding: {formatCurrency(item.outstanding_amount)}</Text>
        {item.status === "open" && (
          <TouchableOpacity onPress={onRecordPayment} style={styles.paymentButton}>
            <Text style={styles.paymentButtonText}>Record Payment</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    heroRow: { flexDirection: "row", gap: 12, padding: 16, paddingBottom: 0 },
    heroCard: { flex: 1, borderRadius: 12, padding: 14 },
    heroLabel: { fontSize: 11, color: c.textSecondary, textTransform: "uppercase", fontWeight: "700" },
    heroValue: { fontSize: 20, fontWeight: "800", marginTop: 4 },
    filterBar: { paddingHorizontal: 16, paddingTop: 12 },
    list: { padding: 16, flexGrow: 1 },
    empty: { color: c.textSecondary, textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    cardSettled: { opacity: 0.6 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    name: { fontSize: 15, fontWeight: "700", color: c.text },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
    outstanding: { fontSize: 14, fontWeight: "700", color: c.text },
    paymentButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.chipBg },
    paymentButtonText: { fontSize: 12, fontWeight: "700", color: c.primary },
    addButton: { margin: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
    addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  });
