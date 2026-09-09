import { registerRootComponent } from "expo";
import { Platform } from "react-native";

import App from "./App";

registerRootComponent(App);

// Android home-screen widget's headless update task -- iOS widgets/Live
// Activities are handled entirely natively (WidgetKit/ActivityKit), no JS
// task needed there.
if (Platform.OS === "android") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerWidgetTaskHandler } = require("react-native-android-widget");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { widgetTaskHandler } = require("./src/widgets/widgetTaskHandler");
  registerWidgetTaskHandler(widgetTaskHandler);
}
