import AppIntents
import Foundation

// Native Shortcuts action, distinct from the RN app's own UI: this is what makes
// "Add Transaction" show up directly in the Shortcuts action picker (and as a target for
// iOS's built-in "Transaction" Automation trigger on Apple Pay taps), instead of requiring
// a manual "Get Contents of URL" HTTP action like the plain iOS Shortcut integration does.
struct AddTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Transaction"
    static var description = IntentDescription(
        "Add a transaction to Finance Tracker. Works as a target for the Transaction automation trigger."
    )

    @Parameter(title: "Amount")
    var amount: Double

    @Parameter(title: "Merchant")
    var merchant: String

    @Parameter(title: "Category")
    var category: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let url = URL(string: "\(APIConfig.serverURL)/api/ingest/transaction") else {
            throw AddTransactionIntentError.invalidServerURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(APIConfig.apiKey, forHTTPHeaderField: "X-API-Key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "amount": amount,
            "description": merchant,
        ]
        if let category = category, !category.isEmpty {
            body["category"] = category
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw AddTransactionIntentError.requestFailed
        }

        return .result(dialog: "Saved \(merchant) — \(amount)")
    }
}

enum AddTransactionIntentError: Swift.Error, CustomLocalizedStringResourceConvertible {
    case invalidServerURL
    case requestFailed

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .invalidServerURL:
            return "Finance Tracker server URL is misconfigured in this build."
        case .requestFailed:
            return "Couldn't save the transaction. Check the server is reachable and try again."
        }
    }
}

struct FinanceTrackerShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTransactionIntent(),
            phrases: [
                "Add a transaction in \(.applicationName)",
                "Add an expense in \(.applicationName)",
            ],
            shortTitle: "Add Transaction",
            systemImageName: "creditcard"
        )
    }
}
