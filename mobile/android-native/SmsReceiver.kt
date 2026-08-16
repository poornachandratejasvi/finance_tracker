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

// Android can read the SMS inbox directly (iOS can't -- Apple gives no app any access to
// SMS content, hence the Shortcuts-forwarding approach on that platform instead). This
// receiver forwards the raw sender + body to /api/ingest/sms, which does the amount/
// credit-debit parsing AND best-effort bank identification server-side (matching the
// sender/body against the user's own configured banks by account-number-last-4-digits or
// short code -- see ingest.py's _match_bank_from_sms) so the transaction lands on the right
// account instead of an unattributed "External" bucket, the same server-side logic the
// iOS Shortcut path already relies on. Keeping the parsing server-side (not duplicated here
// in Kotlin) means a fix or improvement to the matching only has to happen once.
class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "FinanceTrackerSms"
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
                    send(sender, body)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing SMS", e)
            } finally {
                pendingResult.finish()
            }
        }.start()
    }

    private fun send(sender: String, body: String) {
        val payload = JSONObject()
        payload.put("text", body)
        payload.put("sender", sender)

        try {
            val url = URL("${ApiConfig.SERVER_URL}/api/ingest/sms")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("X-API-Key", ApiConfig.API_KEY)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            OutputStreamWriter(connection.outputStream).use { it.write(payload.toString()) }
            val code = connection.responseCode
            // A 422 here just means this particular SMS had no Rs./INR amount in it
            // (e.g. an OTP or promo text) -- expected and not an error worth alarming on.
            Log.i(TAG, "Ingest response: $code")
            connection.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send SMS to ingest endpoint", e)
        }
    }
}
