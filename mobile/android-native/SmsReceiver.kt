package com.poornachandratejasvi.financetracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.regex.Pattern

// Mirrors the backend's alert-email parsing (app/services/alert_email_service.py) but for
// bank transaction SMS instead of email -- iOS has no equivalent since Apple doesn't allow
// reading SMS content at all; this is Android-only. Uses only java.net/org.json (Android's
// standard library) rather than adding an HTTP client dependency, since a debug APK isn't
// R8/ProGuard-stripped and this needs no more than a POST with a couple of headers.
class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "FinanceTrackerSms"
        private val AMOUNT_PATTERN: Pattern = Pattern.compile(
            "(?:Rs\\.?|INR)\\s?([0-9,]+(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE
        )
        private val CREDIT_PATTERN = Regex("credited|received|deposited", RegexOption.IGNORE_CASE)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // Network I/O isn't allowed on the receiver's own (main) thread and must outlive
        // onReceive() returning, hence goAsync() + a background thread rather than a bare
        // Thread with no pendingResult (the process could be killed before the POST lands).
        val pendingResult = goAsync()
        Thread {
            try {
                for (message in messages) {
                    val body = message.messageBody ?: continue
                    val sender = message.originatingAddress ?: "SMS"
                    parseAndSend(sender, body)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing SMS", e)
            } finally {
                pendingResult.finish()
            }
        }.start()
    }

    private fun parseAndSend(sender: String, body: String) {
        val matcher = AMOUNT_PATTERN.matcher(body)
        if (!matcher.find()) return
        val amountStr = matcher.group(1)?.replace(",", "") ?: return
        val amount = amountStr.toDoubleOrNull() ?: return
        if (amount <= 0) return

        val type = if (CREDIT_PATTERN.containsMatchIn(body)) "credit" else "debit"

        val payload = JSONObject()
        payload.put("amount", amount)
        payload.put("description", body.take(140))
        payload.put("type", type)
        payload.put("notes", "Auto-detected from SMS ($sender)")

        try {
            val url = URL("${ApiConfig.SERVER_URL}/api/ingest/transaction")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("X-API-Key", ApiConfig.API_KEY)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            OutputStreamWriter(connection.outputStream).use { it.write(payload.toString()) }
            val code = connection.responseCode
            Log.i(TAG, "Ingest response: $code")
            connection.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send transaction", e)
        }
    }
}
