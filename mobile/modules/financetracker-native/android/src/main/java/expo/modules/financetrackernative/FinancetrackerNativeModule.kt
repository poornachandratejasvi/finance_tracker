package expo.modules.financetrackernative

import android.content.Context
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Backs two features:
// 1. Runtime-refreshable SMS-forwarding credentials for SmsReceiver.kt
//    (mobile/android-native/SmsReceiver.kt) -- previously baked into the APK
//    at CI build time as a compile-time constant, which could silently go
//    stale (server URL changed, token rotated) with zero visibility to the
//    user. Stored here in a plain SharedPreferences file that any class in
//    this same app process/package can read, including the separately
//    registered SmsReceiver. (Not EncryptedSharedPreferences for now -- this
//    token only grants SMS-ingest access and is regenerable/revocable from
//    the app at any time, same exposure as the old compile-time-baked
//    approach; upgrading the storage is a safe later improvement, not a
//    correctness requirement.)
// 2. Browsing the phone's EXISTING SMS inbox (querySmsInbox) -- the
//    BroadcastReceiver only ever reacts to NEW incoming SMS in real time and
//    has no way to expose anything back to JS; this is this app's first
//    capability to read the inbox on demand, for the in-app "Import SMS"
//    picker screen.
private const val PREFS_NAME = "ft_sms_config"
private const val KEY_SERVER_URL = "server_url"
private const val KEY_API_KEY = "api_key"

class FinancetrackerNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context not available")

  override fun definition() = ModuleDefinition {
    Name("FinancetrackerNative")

    Function("setSmsCredentials") { serverUrl: String, apiKey: String ->
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().putString(KEY_SERVER_URL, serverUrl).putString(KEY_API_KEY, apiKey).apply()
    }

    Function("getSmsCredentials") {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      mapOf(
        "serverUrl" to prefs.getString(KEY_SERVER_URL, null),
        "apiKey" to prefs.getString(KEY_API_KEY, null),
      )
    }

    Function("clearSmsCredentials") {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().clear().apply()
    }

    // sinceMillis: only messages newer than this (0 = no lower bound).
    // searchText: case-insensitive match against sender OR body (empty = no filter).
    // limit: max rows returned, most recent first.
    Function("querySmsInbox") { sinceMillis: Double, searchText: String, limit: Int ->
      val results = mutableListOf<Map<String, Any>>()
      val projection = arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
      val selectionParts = mutableListOf<String>()
      val selectionArgs = mutableListOf<String>()
      if (sinceMillis > 0) {
        selectionParts.add("${Telephony.Sms.DATE} >= ?")
        selectionArgs.add(sinceMillis.toLong().toString())
      }
      if (searchText.isNotBlank()) {
        selectionParts.add("(${Telephony.Sms.BODY} LIKE ? OR ${Telephony.Sms.ADDRESS} LIKE ?)")
        val pattern = "%$searchText%"
        selectionArgs.add(pattern)
        selectionArgs.add(pattern)
      }
      val selection = if (selectionParts.isNotEmpty()) selectionParts.joinToString(" AND ") else null

      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        projection,
        selection,
        if (selectionArgs.isNotEmpty()) selectionArgs.toTypedArray() else null,
        "${Telephony.Sms.DATE} DESC",
      )?.use { cursor ->
        val idCol = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
        val addressCol = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyCol = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateCol = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
        while (cursor.moveToNext() && results.size < limit) {
          results.add(
            mapOf(
              "id" to cursor.getString(idCol).orEmpty(),
              "sender" to (cursor.getString(addressCol) ?: "Unknown"),
              "body" to (cursor.getString(bodyCol) ?: ""),
              "date" to cursor.getLong(dateCol).toDouble(),
            )
          )
        }
      }
      results
    }
  }
}
