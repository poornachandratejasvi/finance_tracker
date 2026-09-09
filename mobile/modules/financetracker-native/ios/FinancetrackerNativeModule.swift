import ExpoModulesCore
import ActivityKit
import TodaySpendActivityKit

// iOS side of the shared "FinancetrackerNative" module (see the Android
// Kotlin implementation for the SMS-related functions -- those have no iOS
// equivalent, hence the separate per-platform files). This side controls the
// "Track today's spending" Live Activity / Dynamic Island -- starting,
// updating, and ending it is only possible from the main app process
// (ActivityKit's Activity.request/update/end are not callable from a
// WidgetKit extension), so this is genuinely new native code, not something
// the widget extension target (Widget.swift) can do on its own.
public class FinancetrackerNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FinancetrackerNative")

    Function("isLiveActivitySupported") { () -> Bool in
      if #available(iOS 16.1, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    Function("startTodaySpendActivity") { (spentToday: Double, currencySymbol: String) -> Bool in
      guard #available(iOS 16.1, *) else { return false }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      // Only one at a time -- starting again just no-ops if one is already running.
      if !Activity<TodaySpendAttributes>.activities.isEmpty { return true }
      do {
        let attributes = TodaySpendAttributes()
        let state = TodaySpendAttributes.ContentState(spentToday: spentToday, currencySymbol: currencySymbol)
        _ = try Activity.request(
          attributes: attributes,
          content: .init(state: state, staleDate: nil)
        )
        return true
      } catch {
        return false
      }
    }

    Function("updateTodaySpendActivity") { (spentToday: Double, currencySymbol: String) in
      guard #available(iOS 16.1, *) else { return }
      let state = TodaySpendAttributes.ContentState(spentToday: spentToday, currencySymbol: currencySymbol)
      Task {
        for activity in Activity<TodaySpendAttributes>.activities {
          await activity.update(.init(state: state, staleDate: nil))
        }
      }
    }

    Function("endTodaySpendActivity") { () in
      guard #available(iOS 16.1, *) else { return }
      Task {
        for activity in Activity<TodaySpendAttributes>.activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
    }
  }
}
