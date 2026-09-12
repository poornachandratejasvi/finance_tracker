import React, { useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, withDelay } from "react-native-reanimated";

interface Props {
  pct: number; // 0-100
  color: string;
  height?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

// Shared by every flat "progress bar" style row across Dashboard widgets,
// Analytics, and Budgets -- animates from 0 to its target width instead of
// popping in at full width, which was the single biggest "feels static"
// contributor since these bars are everywhere (category breakdowns, budget
// status, top merchants, income/expense splits).
export default function AnimatedBarFill({ pct, color, height = 6, delay = 0, style }: Props) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withDelay(delay, withTiming(Math.max(0, Math.min(100, pct)), { duration: 650 }));
  }, [pct, delay, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
    backgroundColor: color,
  }));

  return (
    <Animated.View
      style={[{ height, borderRadius: height / 2 }, animatedStyle, style]}
    />
  );
}
