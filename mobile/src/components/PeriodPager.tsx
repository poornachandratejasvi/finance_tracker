import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemeColors, useTheme } from "../context/ThemeContext";
import TextPromptModal from "./TextPromptModal";

export interface ResolvedPeriod {
  start_date: string;
  end_date: string;
  label: string;
  granularity: "day" | "week" | "month";
}

const PRESETS: { key: string; label: string; days: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "12w", label: "12 weeks", days: 84 },
  { key: "6m", label: "6 months", days: 182 },
  { key: "1y", label: "1 year", days: 365 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthStart(offset: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}
function monthLabel(offset: number): string {
  if (offset === 0) return "This month";
  if (offset === -1) return "Last month";
  if (offset === 1) return "Next month";
  return monthStart(offset).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

// The reference app's Statistics screen swipes between three ways to pick a
// period: preset range chips, a month-by-month navigator, and a custom date
// range. Plain horizontal ScrollView with pagingEnabled -- no new dependency
// (react-native-pager-view isn't installed, and this doesn't need it).
export default function PeriodPager({ onChange }: { onChange: (p: ResolvedPeriod) => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [width, setWidth] = useState(Dimensions.get("window").width - 32);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const [presetKey, setPresetKey] = useState("30d");
  const [monthOffset, setMonthOffset] = useState(0);
  const [customStart, setCustomStart] = useState(isoDate(monthStart(-1)));
  const [customEnd, setCustomEnd] = useState(isoDate(new Date()));
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [startDraft, setStartDraft] = useState(customStart);
  const [endDraft, setEndDraft] = useState(customEnd);

  const emit = (mode: number, pk = presetKey, mo = monthOffset, cs = customStart, ce = customEnd) => {
    if (mode === 0) {
      const preset = PRESETS.find((p) => p.key === pk) || PRESETS[1];
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - preset.days);
      onChange({
        start_date: isoDate(start),
        end_date: isoDate(end),
        label: preset.label,
        granularity: preset.days <= 30 ? "day" : preset.days <= 90 ? "week" : "month",
      });
    } else if (mode === 1) {
      onChange({ start_date: isoDate(monthStart(mo)), end_date: isoDate(monthStart(mo + 1)), label: monthLabel(mo), granularity: "day" });
    } else {
      onChange({ start_date: cs, end_date: ce, label: `${cs} — ${ce}`, granularity: "day" });
    }
  };

  useEffect(() => { emit(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) {
      setPage(p);
      emit(p);
    }
  };

  const selectPreset = (key: string) => {
    setPresetKey(key);
    emit(0, key);
  };

  const shiftMonth = (delta: number) => {
    const next = monthOffset + delta;
    setMonthOffset(next);
    emit(1, presetKey, next);
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.pager}
      >
        {/* Page 1: preset ranges */}
        <View style={[styles.page, { width }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
            {PRESETS.map((p) => {
              const active = presetKey === p.key;
              return (
                <TouchableOpacity key={p.key} style={[styles.chip, active && styles.chipActive]} onPress={() => selectPreset(p.key)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Page 2: month navigator */}
        <View style={[styles.page, { width }]}>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.monthArrow}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </TouchableOpacity>
            <View style={styles.monthLabelBox}>
              <Text style={styles.monthLabelText}>{monthLabel(monthOffset)}</Text>
              <Ionicons name="chevron-down" size={14} color="#fff" style={{ marginLeft: 4 }} />
            </View>
            <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.monthArrow}>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Page 3: custom range */}
        <View style={[styles.page, { width }]}>
          <View style={styles.monthNav}>
            <TouchableOpacity
              style={styles.customPill}
              onPress={() => {
                setStartDraft(customStart);
                setStartModalOpen(true);
              }}
            >
              <Text style={styles.monthLabelText} numberOfLines={1}>{customStart}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textSecondary, marginHorizontal: 6 }}>—</Text>
            <TouchableOpacity
              style={styles.customPill}
              onPress={() => {
                setEndDraft(customEnd);
                setEndModalOpen(true);
              }}
            >
              <Text style={styles.monthLabelText} numberOfLines={1}>{customEnd}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
        ))}
      </View>

      <TextPromptModal
        visible={startModalOpen}
        title="Start date"
        value={startDraft}
        onChangeValue={setStartDraft}
        onSave={() => {
          const v = startDraft.trim() || customStart;
          setCustomStart(v);
          emit(2, presetKey, monthOffset, v, customEnd);
        }}
        onClose={() => setStartModalOpen(false)}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
      />
      <TextPromptModal
        visible={endModalOpen}
        title="End date"
        value={endDraft}
        onChangeValue={setEndDraft}
        onSave={() => {
          const v = endDraft.trim() || customEnd;
          setCustomEnd(v);
          emit(2, presetKey, monthOffset, customStart, v);
        }}
        onClose={() => setEndModalOpen(false)}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Fixed height + flexGrow/flexShrink:0 -- same fix as the Records range
    // row: a horizontal ScrollView without these can stretch its page content
    // to fill all available vertical space instead of its own height.
    pager: { height: 48, flexGrow: 0, flexShrink: 0 },
    page: { justifyContent: "center" },
    chipRowContent: { alignItems: "center", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: c.chipBg },
    chipActive: { backgroundColor: c.primary },
    chipText: { color: c.text, fontSize: 12, fontWeight: "600" },
    chipTextActive: { color: "#fff" },
    monthNav: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primary,
      borderRadius: 22,
      height: 40,
      paddingHorizontal: 6,
    },
    monthArrow: { padding: 8 },
    monthLabelBox: { flexDirection: "row", alignItems: "center", flex: 1, justifyContent: "center" },
    monthLabelText: { color: "#fff", fontSize: 13, fontWeight: "700" },
    customPill: { paddingHorizontal: 10, paddingVertical: 6, flexShrink: 1 },
    dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 8, marginBottom: 4 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.border },
    dotActive: { backgroundColor: c.primary },
  });
