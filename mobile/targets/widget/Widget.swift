import WidgetKit
import SwiftUI
import ActivityKit
import FinancetrackerNative

private let appGroup = "group.com.poornachandratejasvi.financetracker"

// MARK: - Home screen widget (reads a snapshot the main app writes via
// ExtensionStorage on each Dashboard load -- see iosWidgetSync.ts. WidgetKit
// extensions are sandboxed from the main app's own network/auth state, so a
// shared-storage snapshot (not a live API call) is the standard approach.)

struct BalanceEntry: TimelineEntry {
    let date: Date
    let savingsTotal: Double?
    let spendThisMonth: Double?
}

struct BalanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> BalanceEntry {
        BalanceEntry(date: Date(), savingsTotal: 125000, spendThisMonth: 18500)
    }

    func getSnapshot(in context: Context, completion: @escaping (BalanceEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BalanceEntry>) -> Void) {
        let entry = currentEntry()
        // Refresh every 30 minutes -- matches the Android widget's
        // updatePeriodMillis and WidgetKit's own practical minimum cadence.
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }

    private func currentEntry() -> BalanceEntry {
        let defaults = UserDefaults(suiteName: appGroup)
        // Written via ExtensionStorage.set() from iosWidgetSync.ts, which
        // routes any JS `number` through the native module's setInt (a Swift
        // Int) -- .doubleValue reads that back correctly regardless of the
        // underlying NSNumber's original storage type.
        let savings = (defaults?.object(forKey: "savingsTotal") as? NSNumber)?.doubleValue
        let spend = (defaults?.object(forKey: "spendThisMonth") as? NSNumber)?.doubleValue
        return BalanceEntry(date: Date(), savingsTotal: savings, spendThisMonth: spend)
    }
}

struct BalanceWidgetEntryView: View {
    var entry: BalanceEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Finance Tracker")
                .font(.caption2)
                .foregroundColor(.secondary)
            if let savings = entry.savingsTotal {
                Text(formatted(savings))
                    .font(.title2)
                    .fontWeight(.heavy)
                Text("Total balance")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                if let spend = entry.spendThisMonth {
                    Text("Spent this month: \(formatted(spend))")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.green)
                        .padding(.top, 4)
                }
            } else {
                Text("Open the app to sign in")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private func formatted(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        let number = formatter.string(from: NSNumber(value: value)) ?? "\(Int(value))"
        return "₹\(number)"
    }
}

struct BalanceWidget: Widget {
    let kind: String = "BalanceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BalanceProvider()) { entry in
            BalanceWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Balance")
        .description("Your total balance and this month's spend.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Live Activity / Dynamic Island ("Track today's spending")
// TodaySpendAttributes lives in the FinancetrackerNative pod (imported
// above), not as a plain shared source file -- see that file's comment for
// why ActivityKit needs the identical compiled type in both this extension
// and the main app (FinancetrackerNativeModule.swift, same pod).

struct TodaySpendLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TodaySpendAttributes.self) { context in
            // Lock Screen / banner presentation.
            HStack {
                VStack(alignment: .leading) {
                    Text("Today's spending")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("\(context.state.currencySymbol)\(Int(context.state.spentToday))")
                        .font(.title3)
                        .fontWeight(.bold)
                }
                Spacer()
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.8))
            .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("Today")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.currencySymbol)\(Int(context.state.spentToday))")
                        .font(.headline)
                        .fontWeight(.bold)
                }
            } compactLeading: {
                Text("💸")
            } compactTrailing: {
                Text("\(context.state.currencySymbol)\(Int(context.state.spentToday))")
                    .font(.caption2)
                    .fontWeight(.semibold)
            } minimal: {
                Text("💸")
            }
        }
    }
}

@main
struct FinanceTrackerWidgetBundle: WidgetBundle {
    var body: some Widget {
        BalanceWidget()
        TodaySpendLiveActivity()
    }
}
