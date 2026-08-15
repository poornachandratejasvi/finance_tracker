import React, { useRef, useState } from "react";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { askAI } from "../../api/ai";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { SettingsStackParamList } from "../../navigation/SettingsNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "AskAi">;

interface Turn {
  id: string;
  question: string;
  answer: string;
  ai: boolean;
}

const EXAMPLES = [
  "How much did I spend on food this month?",
  "What's my biggest expense category?",
  "Am I spending more than last month?",
];

export default function AskAiScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const listRef = useRef<FlatList>(null);

  const ask = async (q: string) => {
    if (!q.trim() || asking) return;
    setQuestion("");
    setAsking(true);
    try {
      const result = await askAI(q.trim());
      setTurns((prev) => [...prev, { id: `${Date.now()}`, question: q.trim(), answer: result.answer, ai: result.ai }]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setTurns((prev) => [
        ...prev,
        { id: `${Date.now()}`, question: q.trim(), answer: "Something went wrong. Please try again.", ai: false },
      ]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {turns.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Ask anything about your finances</Text>
          {EXAMPLES.map((ex) => (
            <TouchableOpacity key={ex} style={styles.exampleChip} onPress={() => ask(ex)}>
              <Text style={styles.exampleText}>{ex}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.turn}>
              <View style={[styles.bubble, styles.questionBubble]}>
                <Text style={styles.questionText}>{item.question}</Text>
              </View>
              <View style={[styles.bubble, styles.answerBubble]}>
                <Text style={styles.answerText}>{item.answer}</Text>
                {!item.ai && (
                  <TouchableOpacity onPress={() => navigation.navigate("AI")}>
                    <Text style={styles.configureLink}>No AI provider configured — set one up</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask a question..."
          placeholderTextColor={colors.textSecondary}
          multiline
          onSubmitEditing={() => ask(question)}
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => ask(question)} disabled={asking || !question.trim()}>
          {asking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendButtonText}>Send</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    emptyContainer: { flex: 1, padding: 24, justifyContent: "center" },
    emptyTitle: { fontSize: 18, fontWeight: "700", color: c.text, marginBottom: 20, textAlign: "center" },
    exampleChip: {
      backgroundColor: c.card,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 10,
    },
    exampleText: { color: c.text, fontSize: 14 },
    list: { padding: 16 },
    turn: { marginBottom: 16 },
    bubble: { borderRadius: 12, padding: 12, marginBottom: 6 },
    questionBubble: { backgroundColor: c.primary, alignSelf: "flex-end", maxWidth: "85%" },
    questionText: { color: "#fff", fontSize: 14 },
    answerBubble: { backgroundColor: c.card, alignSelf: "flex-start", maxWidth: "90%" },
    answerText: { color: c.text, fontSize: 14, lineHeight: 20 },
    configureLink: { color: c.warning, fontSize: 12, fontWeight: "600", marginTop: 8 },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      padding: 12,
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.inputBg,
      color: c.text,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontSize: 15,
      maxHeight: 100,
    },
    sendButton: {
      backgroundColor: c.primary,
      borderRadius: 20,
      paddingHorizontal: 18,
      paddingVertical: 10,
      justifyContent: "center",
    },
    sendButtonText: { color: "#fff", fontWeight: "600" },
  });
