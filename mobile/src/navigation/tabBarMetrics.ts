import { Platform } from "react-native";

// The bottom tab bar is styled as a rounded, inset "floating" card (see
// RootNavigator's AppTabs) instead of a flush full-width bar, to match the
// reference app. It stays in normal layout flow (not position:"absolute") so
// it still reserves its own space and can't hide content on any nested
// screen -- these are just the sizing constants shared with its styling.
export const TAB_BAR_HEIGHT = 62;
export const TAB_BAR_BOTTOM_MARGIN = Platform.OS === "ios" ? 24 : 16;
