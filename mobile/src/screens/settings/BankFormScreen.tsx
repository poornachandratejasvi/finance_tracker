import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { createBank, deleteBank, updateBank } from "../../api/banks";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { BanksStackParamList } from "../../navigation/BanksNavigator";
import { FormGroup, FormSectionHeader } from "../../components/FormGroup";
import { PickerRow, ToggleRow } from "../../components/PickerRow";
import SelectModal from "../../components/SelectModal";
import TextPromptModal from "../../components/TextPromptModal";

type Props = NativeStackScreenProps<BanksStackParamList, "BankForm">;

const BANK_TYPES = ["savings", "credit", "loan", "investment", "other"];
const COLORS = ["#1b6b4c", "#b3261e", "#0b5fff", "#b8860b", "#7d3fc4", "#008080"];

export default function BankFormScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const existing = route.params?.bank;

  const [name, setName] = useState(existing?.name || "");
  const [bankType, setBankType] = useState(existing?.bank_type || "savings");
  const [currencyCode, setCurrencyCode] = useState(existing?.currency_code || "INR");
  const [color, setColor] = useState(existing?.color || COLORS[0]);
  const [currentBalance, setCurrentBalance] = useState(
    existing?.current_balance != null ? String(existing.current_balance) : ""
  );
  const [smsSenderPattern, setSmsSenderPattern] = useState(existing?.sms_sender_pattern || "");
  const [isArchived, setIsArchived] = useState(!!existing?.is_archived);
  const [interestRate, setInterestRate] = useState(existing?.interest_rate != null ? String(existing.interest_rate) : "");
  const [minimumPayment, setMinimumPayment] = useState(existing?.minimum_payment != null ? String(existing.minimum_payment) : "");
  const [belowEnabled, setBelowEnabled] = useState(!!existing?.balance_below_limit_enabled);
  const [belowThreshold, setBelowThreshold] = useState(
    existing?.balance_below_threshold != null ? String(existing.balance_below_threshold) : ""
  );
  const [aboveEnabled, setAboveEnabled] = useState(!!existing?.balance_above_limit_enabled);
  const [aboveThreshold, setAboveThreshold] = useState(
    existing?.balance_above_threshold != null ? String(existing.balance_above_threshold) : ""
  );
  const [submitting, setSubmitting] = useState(false);

  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState(currentBalance);
  const [belowModalOpen, setBelowModalOpen] = useState(false);
  const [belowDraft, setBelowDraft] = useState(belowThreshold);
  const [aboveModalOpen, setAboveModalOpen] = useState(false);
  const [aboveDraft, setAboveDraft] = useState(aboveThreshold);
  const [interestModalOpen, setInterestModalOpen] = useState(false);
  const [interestDraft, setInterestDraft] = useState(interestRate);
  const [minPaymentModalOpen, setMinPaymentModalOpen] = useState(false);
  const [minPaymentDraft, setMinPaymentDraft] = useState(minimumPayment);
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [smsDraft, setSmsDraft] = useState(smsSenderPattern);

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Give this account a name.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        bank_type: bankType,
        currency_code: currencyCode.trim().toUpperCase() || "INR",
        color,
        current_balance: currentBalance ? parseFloat(currentBalance) : undefined,
        sms_sender_pattern: smsSenderPattern.trim() || undefined,
        is_archived: isArchived,
        interest_rate: interestRate ? parseFloat(interestRate) : undefined,
        minimum_payment: minimumPayment ? parseFloat(minimumPayment) : undefined,
        balance_below_limit_enabled: belowEnabled,
        balance_below_threshold: belowThreshold ? parseFloat(belowThreshold) : undefined,
        balance_above_limit_enabled: aboveEnabled,
        balance_above_threshold: aboveThreshold ? parseFloat(aboveThreshold) : undefined,
      };
      if (existing) {
        await updateBank(existing.id, payload);
      } else {
        await createBank(payload);
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
    Alert.alert("Delete account?", `This removes "${existing.name}" and can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteBank(existing.id);
            navigation.goBack();
          } catch {
            Alert.alert("Couldn't delete", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Account name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. HDFC Savings"
        placeholderTextColor={colors.textSecondary}
      />

      <FormSectionHeader title="General" />
      <FormGroup>
        <PickerRow
          icon="layers-outline"
          label="Type"
          value={bankType}
          onPress={() => setTypeModalOpen(true)}
        />
        <PickerRow
          icon="calculator-outline"
          label="Current balance"
          value={currentBalance ? `${currencyCode} ${currentBalance}` : null}
          placeholder="Optional"
          onPress={() => {
            setBalanceDraft(currentBalance);
            setBalanceModalOpen(true);
          }}
        />
        <PickerRow icon="cash-outline" label="Currency" rightElement={
          <TextInput
            style={styles.inlineInput}
            value={currencyCode}
            onChangeText={(v) => setCurrencyCode(v.toUpperCase())}
            autoCapitalize="characters"
            maxLength={3}
            placeholder="INR"
            placeholderTextColor={colors.textSecondary}
          />
        } />
        <PickerRow
          icon="chatbubbles-outline"
          label="SMS Sender ID"
          value={smsSenderPattern || null}
          placeholder="Optional"
          onPress={() => {
            setSmsDraft(smsSenderPattern);
            setSmsModalOpen(true);
          }}
        />
      </FormGroup>
      {bankType === "investment" && (
        <Text style={styles.hint}>
          Won't show up as a bank balance — this just lets statement emails from this
          sender (e.g. eCAS@cdslstatement.com for a CDSL CAS) get auto-downloaded, so
          their holdings feed the Investments tab instead.
        </Text>
      )}
      <Text style={styles.hint}>
        SMS Sender ID is the alphanumeric ID your bank's alert texts come from (e.g.
        HDFCBK, AD-SBIINB), not a phone number -- lets an incoming SMS auto-match to
        this account.
      </Text>

      <FormSectionHeader title="Color" />
      <View style={styles.chipRow}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
            onPress={() => setColor(c)}
          />
        ))}
      </View>

      {(bankType === "credit" || bankType === "loan") && (
        <>
          <FormSectionHeader title="Debt details" />
          <FormGroup>
            <PickerRow
              icon="trending-up-outline"
              label="Interest rate %/year"
              value={interestRate || null}
              placeholder="Optional"
              onPress={() => {
                setInterestDraft(interestRate);
                setInterestModalOpen(true);
              }}
            />
            <PickerRow
              icon="card-outline"
              label="Minimum payment"
              value={minimumPayment || null}
              placeholder="Estimate as 2% of balance"
              onPress={() => {
                setMinPaymentDraft(minimumPayment);
                setMinPaymentModalOpen(true);
              }}
            />
          </FormGroup>
        </>
      )}

      <FormSectionHeader title="In-app notifications" />
      <FormGroup>
        <ToggleRow icon="arrow-down-circle-outline" label="Balance below limit" value={belowEnabled} onValueChange={setBelowEnabled} />
        {belowEnabled && (
          <PickerRow
            icon="remove-circle-outline"
            label="Minimum balance"
            value={belowThreshold || null}
            placeholder="e.g. 5000"
            onPress={() => {
              setBelowDraft(belowThreshold);
              setBelowModalOpen(true);
            }}
          />
        )}
        <ToggleRow icon="arrow-up-circle-outline" label="Balance above limit" value={aboveEnabled} onValueChange={setAboveEnabled} />
        {aboveEnabled && (
          <PickerRow
            icon="add-circle-outline"
            label="Maximum balance"
            value={aboveThreshold || null}
            placeholder="e.g. 50000"
            onPress={() => {
              setAboveDraft(aboveThreshold);
              setAboveModalOpen(true);
            }}
          />
        )}
        {existing && <ToggleRow icon="archive-outline" label="Archived" value={isArchived} onValueChange={setIsArchived} />}
      </FormGroup>

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSave} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Delete Account</Text>
        </TouchableOpacity>
      )}

      <SelectModal
        visible={typeModalOpen}
        title="Type"
        options={BANK_TYPES.map((t) => ({ key: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        selectedKey={bankType}
        onSelect={(k) => setBankType(k as string)}
        onClose={() => setTypeModalOpen(false)}
      />
      <TextPromptModal
        visible={balanceModalOpen}
        title="Current balance"
        value={balanceDraft}
        onChangeValue={setBalanceDraft}
        onSave={() => setCurrentBalance(balanceDraft.trim())}
        onClose={() => setBalanceModalOpen(false)}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <TextPromptModal
        visible={smsModalOpen}
        title="SMS Sender ID"
        value={smsDraft}
        onChangeValue={setSmsDraft}
        onSave={() => setSmsSenderPattern(smsDraft.trim().toUpperCase())}
        onClose={() => setSmsModalOpen(false)}
        placeholder="HDFCBK"
        autoCapitalize="none"
      />
      <TextPromptModal
        visible={interestModalOpen}
        title="Interest rate %/year"
        value={interestDraft}
        onChangeValue={setInterestDraft}
        onSave={() => setInterestRate(interestDraft.trim())}
        onClose={() => setInterestModalOpen(false)}
        placeholder="e.g. 42"
        keyboardType="decimal-pad"
      />
      <TextPromptModal
        visible={minPaymentModalOpen}
        title="Minimum payment"
        value={minPaymentDraft}
        onChangeValue={setMinPaymentDraft}
        onSave={() => setMinimumPayment(minPaymentDraft.trim())}
        onClose={() => setMinPaymentModalOpen(false)}
        placeholder="Leave blank to estimate"
        keyboardType="decimal-pad"
      />
      <TextPromptModal
        visible={belowModalOpen}
        title="Minimum balance"
        value={belowDraft}
        onChangeValue={setBelowDraft}
        onSave={() => setBelowThreshold(belowDraft.trim())}
        onClose={() => setBelowModalOpen(false)}
        placeholder="e.g. 5000"
        keyboardType="decimal-pad"
      />
      <TextPromptModal
        visible={aboveModalOpen}
        title="Maximum balance"
        value={aboveDraft}
        onChangeValue={setAboveDraft}
        onSave={() => setAboveThreshold(aboveDraft.trim())}
        onClose={() => setAboveModalOpen(false)}
        placeholder="e.g. 50000"
        keyboardType="decimal-pad"
      />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, paddingBottom: 48, backgroundColor: c.background },
    label: { fontSize: 13, fontWeight: "600", color: c.text, marginBottom: 6 },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 6, fontStyle: "italic" },
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
    inlineInput: { color: c.text, fontSize: 14, textAlign: "right", minWidth: 60 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    swatch: { width: 32, height: 32, borderRadius: 16 },
    swatchActive: { borderWidth: 3, borderColor: c.text },
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
