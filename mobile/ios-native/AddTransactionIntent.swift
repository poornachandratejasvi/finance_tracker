import AppIntents
import Foundation

// Native Shortcuts action, distinct from the RN app's own UI: this is what makes
// "Add Transaction" show up directly in the Shortcuts action picker (and as a target for
// iOS's built-in "Transaction" Automation trigger on Apple Pay taps), instead of requiring
// a manual "Get Contents of URL" HTTP action like the plain iOS Shortcut integration does.

// AppEnum gives Type a real native picker (like Category/Account below, kept as free text --
// unlike a fixed two-item enum, a menu of bank/account names would go stale the moment one
// is renamed, and AppIntents has no simple "refresh this list from my server" mechanism
// without a DynamicOptionsProvider doing a live network call during Shortcuts editing).
enum TransactionTypeOption: String, AppEnum {
    case expense
    case income

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Type"
    static var caseDisplayRepresentations: [TransactionTypeOption: DisplayRepresentation] = [
        .expense: "Expense",
        .income: "Income",
    ]
}

struct AddTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Transaction"
    static var description = IntentDescription(
        "Add a transaction to Finance Tracker. Works as a target for the Transaction automation trigger."
    )

    @Parameter(title: "Amount")
    var amount: Double

    @Parameter(title: "Merchant")
    var merchant: String

    @Parameter(title: "Type")
    var type: TransactionTypeOption?

    @Parameter(title: "Category")
    var category: String?

    @Parameter(title: "Account")
    var account: String?

    @Parameter(title: "Date")
    var date: Date?

    @Parameter(title: "Notes")
    var notes: String?

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
            "type": (type ?? .expense).rawValue,
        ]
        if let category = category, !category.isEmpty {
            body["category"] = category
        }
        if let account = account, !account.isEmpty {
            body["account"] = account
        }
        let isoDate = ISO8601DateFormatter().string(from: date ?? Date())
        body["transaction_date"] = isoDate
        if let notes = notes, !notes.isEmpty {
            body["notes"] = notes
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                throw AddTransactionIntentError.requestFailed
            }
            return .result(dialog: "Saved \(merchant) — \(amount)")
        } catch {
            // Server unreachable (or it rejected the request) -- queue it the same
            // way the in-app "Add Transaction" screen does when offline, instead of
            // just failing. The RN app drains this file (mobile/src/offline/
            // syncEngine.ts: drainNativeIntentQueue) into its own sync queue the
            // next time it's foregrounded/reconnects, so it syncs automatically
            // without the user having to retry this Shortcut.
            PendingIntentQueue.append(
                amount: amount, description: merchant, type: (type ?? .expense).rawValue,
                category: category, accountHint: account, transactionDate: isoDate, notes: notes
            )
            return .result(dialog: "Saved offline — \(merchant) will sync when Finance Tracker is next opened online.")
        }
    }
}

/// Shared hand-off file for transactions the Shortcuts/Siri action couldn't submit
/// live (server unreachable). Written here in Swift, read and cleared by the RN
/// app's JS (mobile/src/offline/syncEngine.ts) -- this AppIntent runs in the same
/// app process/sandbox as the RN runtime (no separate Extension target), so the
/// Documents directory is a plain shared filesystem location, not an App Group.
enum PendingIntentQueue {
    private static var fileURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("pending_intent_transactions.json")
    }

    static func append(
        amount: Double, description: String, type: String, category: String?,
        accountHint: String?, transactionDate: String, notes: String?
    ) {
        guard let fileURL = fileURL else { return }
        var entries: [[String: Any]] = []
        if let data = try? Data(contentsOf: fileURL),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            entries = existing
        }
        var entry: [String: Any] = [
            "client_uuid": UUID().uuidString,
            "amount": amount,
            "description": description,
            "type": type,
            "transaction_date": transactionDate,
        ]
        if let category = category, !category.isEmpty { entry["category"] = category }
        if let accountHint = accountHint, !accountHint.isEmpty { entry["account_hint"] = accountHint }
        if let notes = notes, !notes.isEmpty { entry["notes"] = notes }
        entries.append(entry)
        if let data = try? JSONSerialization.data(withJSONObject: entries) {
            try? data.write(to: fileURL, options: .atomic)
        }
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

// One text field. A Shortcuts automation fills Message with the SMS body (and
// Sender when it has one). This action only forwards that text; amount and
// direction are decided on the server.
struct LogSmsIntent: AppIntent {
    static var title: LocalizedStringResource = "Log SMS"
    static var description = IntentDescription(
        "Send a bank SMS to Finance Tracker. Put the message in the text field, or pass it from a Message automation."
    )
    static var openAppWhenRun: Bool { false }

    @Parameter(title: "Message")
    var message: String

    @Parameter(title: "Sender")
    var sender: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$message)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return .result(dialog: "The Message field is empty.")
        }
        guard let url = URL(string: "\(APIConfig.serverURL)/api/ingest/sms") else {
            throw AddTransactionIntentError.invalidServerURL
        }

        var body: [String: Any] = ["text": text]
        if let sender = sender?.trimmingCharacters(in: .whitespacesAndNewlines), !sender.isEmpty {
            body["sender"] = sender
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue(APIConfig.apiKey, forHTTPHeaderField: "X-API-Key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            return .result(dialog: "Couldn't reach Finance Tracker.")
        }

        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if (200...299).contains(code) {
            if json?["ignored"] as? Bool == true {
                return .result(dialog: "Ignored. This SMS is not a transaction.")
            }
            if json?["skipped_duplicate"] as? Bool == true {
                return .result(dialog: "Already recorded.")
            }
            if json?["created"] as? Bool == false, let err = json?["error"] as? String, !err.isEmpty {
                return .result(dialog: "\(String(err.prefix(180)))")
            }
            return .result(dialog: "Saved.")
        }
        if let detail = json?["detail"] as? String, !detail.isEmpty {
            return .result(dialog: "\(String(detail.prefix(180)))")
        }
        return .result(dialog: "Couldn't read this SMS.")
    }
}

struct FinanceTrackerShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogSmsIntent(),
            phrases: [
                "Log an SMS in \(.applicationName)",
                "Log a bank message in \(.applicationName)",
            ],
            shortTitle: "Log SMS",
            systemImageName: "message"
        )
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
