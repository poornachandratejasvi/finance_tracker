package expo.modules.financetrackernative

import android.content.Context
import android.content.SharedPreferences
import android.provider.Telephony
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Backs two features:
// 1. Runtime-refreshable SMS-forwarding credentials for SmsReceiver.kt
//    (mobile/android-native/SmsReceiver.kt) -- previously baked into the APK
//    at CI build time as a compile-time constant, which could silently go
//    stale (server URL changed, token rotated) with zero visibility to the
//    user. Stored in an Android-Keystore-backed EncryptedSharedPreferences
//    file that any class in this same app process/package can read,
//    including the separately registered SmsReceiver. A one-time migration
//    (see migrateLegacyCredentials below) moves over anything already saved
//    in the original plain-text file from before this upgrade.
// 2. Browsing the phone's EXISTING SMS inbox (querySmsInbox) -- the
//    BroadcastReceiver only ever reacts to NEW incoming SMS in real time and
//    has no way to expose anything back to JS; this is this app's first
//    capability to read the inbox on demand, for the in-app "Import SMS"
//    picker screen.
private const val LEGACY_PREFS_NAME = "ft_sms_config"
private const val SECURE_PREFS_NAME = "ft_sms_config_secure"
private const val KEY_SERVER_URL = "server_url"
private const val KEY_API_KEY = "api_key"

internal fun securePrefs(context: Context): SharedPreferences {
  val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
  return EncryptedSharedPreferences.create(
    context,
    SECURE_PREFS_NAME,
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
  )
}

// Runs on every read so a device that already had SMS Auto-Detect configured
// before this upgrade keeps working with no re-setup needed. No-ops once the
// secure store has a value (the legacy file is cleared right after migrating).
internal fun migrateLegacyCredentials(context: Context, secure: SharedPreferences) {
  if (secure.contains(KEY_API_KEY)) return
  val legacy = context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
  val legacyKey = legacy.getString(KEY_API_KEY, null) ?: return
  secure.edit()
    .putString(KEY_SERVER_URL, legacy.getString(KEY_SERVER_URL, null))
    .putString(KEY_API_KEY, legacyKey)
    .apply()
  legacy.edit().clear().apply()
}

class FinancetrackerNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context not available")

  override fun definition() = ModuleDefinition {
    Name("FinancetrackerNative")

    Function("setSmsCredentials") { serverUrl: String, apiKey: String ->
      securePrefs(context).edit().putString(KEY_SERVER_URL, serverUrl).putString(KEY_API_KEY, apiKey).apply()
    }

    Function("getSmsCredentials") {
      val secure = securePrefs(context)
      migrateLegacyCredentials(context, secure)
      mapOf(
        "serverUrl" to secure.getString(KEY_SERVER_URL, null),
        "apiKey" to secure.getString(KEY_API_KEY, null),
      )
    }

    Function("clearSmsCredentials") {
      securePrefs(context).edit().clear().apply()
      context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
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
