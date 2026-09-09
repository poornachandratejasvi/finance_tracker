import ActivityKit

// Lives in its own dependency-free pod (see TodaySpendActivityKit.podspec) so
// it's the SAME compiled type for both consumers -- the main app
// (FinancetrackerNativeModule.swift, which depends on this pod, starts/updates/
// ends the Activity) and the widget extension (targets/widget/Widget.swift,
// which links this pod directly -- see targets/widget/pods.rb -- and renders
// it). ActivityKit needs the identical compiled type on both sides, not just
// structurally-identical duplicates.
public struct TodaySpendAttributes: ActivityAttributes {
    public init() {}

    public struct ContentState: Codable, Hashable {
        public var spentToday: Double
        public var currencySymbol: String

        public init(spentToday: Double, currencySymbol: String) {
            self.spentToday = spentToday
            self.currencySymbol = currencySymbol
        }
    }
}
