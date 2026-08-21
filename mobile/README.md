# Finance Tracker — Mobile (Expo / React Native)

A companion iOS/Android app for the Finance Tracker backend: sign in with your existing
account, see the Dashboard, browse Transactions, and add a transaction from your phone.
Built with Expo so it can be developed and tested entirely from Windows/WSL — no Mac or
Xcode required for the development loop.

Auth matches the web app: username/password login against `/api/auth/login`, JWT access
+ refresh tokens stored in the device Keychain (`expo-secure-store`), auto-refreshed on
401 exactly like `frontend/src/services/api.js` does.

## 1. Install dependencies

From this `mobile/` directory (on your WSL machine — Node/npm work fine there, only the
final iOS compile step needs a Mac-hosted service):

```bash
npm install
```

If `npx expo install` ever complains about a version mismatch after SDK updates, let it
rewrite `package.json` versions for you — that command always resolves versions that are
compatible with your installed Expo SDK, which is safer than the versions pinned here.

## 2. Run it on your iPhone — no Mac, no Apple account

1. Install **Expo Go** from the App Store on your iPhone (free).
2. From `mobile/`, run:
   ```bash
   npx expo start
   ```
3. Scan the QR code shown in the terminal with your iPhone's Camera app. Expo Go opens
   and loads the app directly over your LAN — no build, no signing, no cable.
4. On the login screen, enter the backend's **LAN address** (e.g. `http://192.168.1.50:8000`),
   not `localhost` — same rule as the [iOS Shortcut setup](../docs/ios-shortcut.md). Your
   phone and the machine running `docker-compose` need to be on the same network (or the
   backend needs to be reachable over the internet/VPN).
5. Sign in with your normal Finance Tracker username/password.

Any edit you make to the source reloads instantly in Expo Go (Fast Refresh) — this is the
whole development loop, and it's 100% free with no Apple Developer account.

## 3. Getting a real installable .ipa (for LiveContainer)

Expo Go is a sandboxed client — great for development, but it's not *your* app icon on
the home screen. LiveContainer solves this without needing Apple's normal signing chain
at all: you sign LiveContainer itself once (via AltStore/SideStore, free Apple ID), and
every app you load *inside* it — including this one — can be a plain **unsigned** `.ipa`.
So there's no $99/year Apple Developer Program needed anywhere in this pipeline.

Getting that unsigned `.ipa` still needs one real macOS compile step (Xcode only runs on
macOS), so this repo has [.github/workflows/mobile-ipa-unsigned.yml](../.github/workflows/mobile-ipa-unsigned.yml) —
a GitHub Actions workflow that runs on a free macOS runner and does it for you:

1. `npx expo prebuild` — generates the native `ios/` Xcode project from this Expo source
   (ephemeral in CI; `ios/` is never committed).
2. `xcodebuild ... CODE_SIGNING_ALLOWED=NO` — compiles the app with signing disabled.
3. Packages the result into `Payload/App.app` → zipped as a genuinely unsigned `.ipa`.
4. Uploads it as a downloadable build artifact.

**To run it:** push this branch (or merge to `main`) so GitHub sees the workflow file,
then go to the repo's **Actions** tab → **Build Unsigned Mobile IPA** → **Run workflow**.
When it finishes, download the `unsigned-ipa` artifact from the run summary page — that's
your `.ipa`, ready to import into LiveContainer.

It's manual-trigger-only (`workflow_dispatch`) on purpose: macOS runners consume GitHub
Actions minutes at a 10x multiplier, so it never fires on an ordinary push.

## 4. "Add Transaction" Siri Shortcuts action (App Intent)

Beyond the plain screens, the compiled app (not Expo Go — this needs a real build) exposes
a native **App Intent** called "Add Transaction". Once installed, it shows up directly in
the iOS Shortcuts action picker — including as a target for iOS's built-in **Transaction**
Automation trigger (Shortcuts app → Automations → + → Transaction), which fires
automatically on Apple Pay taps and hands over `Amount`/`Merchant` as inputs. Map those to
this intent's `Amount`/`Merchant` parameters and transactions get logged with no manual
step at all — the same idea as Wallet by BudgetBakers' Apple Pay integration.

This intent (`mobile/ios-native/AddTransactionIntent.swift`) doesn't share your logged-in
session with the rest of the app — sharing runtime data between the RN app and native
Swift code needs an iOS "App Group" entitlement, which is normally gated behind a paid
Apple Developer Program provisioning profile (exactly what this unsigned/LiveContainer
setup avoids). Instead, the server URL + a dedicated API token are **baked in at CI build
time** from GitHub Actions secrets, using the same `X-API-Key` ingestion path the
[iOS Shortcut integration](../docs/ios-shortcut.md) already uses.

**One-time setup, before running the IPA build workflow:**

1. Create a dedicated API token: in the app (or via `curl`), `POST /api/api-tokens/` with a
   JWT session — see [docs/ios-shortcut.md § 1](../docs/ios-shortcut.md) for the exact
   command. Give it a name like "iOS App Intent".
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository
   secret**, add:
   - `FINANCE_SERVER_URL` — e.g. `https://finance.yourdomain.com` (no trailing slash)
   - `FINANCE_API_TOKEN` — the token from step 1
3. Run the **Build Unsigned Mobile IPA** workflow as usual (§ 3 above).

Rotating the token later means creating a new one and updating the `FINANCE_API_TOKEN`
secret, then re-running the build — there's no in-app way to change it without a rebuild,
by design (see the tradeoff above). **This same token/secret pair also powers the Android
SMS receiver below** — one token, both platforms.

`mobile/ios-native/APIConfig.swift.template` has the placeholders the CI workflow fills
in; the real `APIConfig.swift` it generates is gitignored and never committed.

Because of this feature, the build now has genuine custom native code to compile (not just
JS/RN), and the deployment target is bumped to iOS 16.4 (App Intents require iOS 16+, and
Expo SDK 57 itself won't go below 16.4) — so **this pipeline is more likely to need one or
two fix-and-retry rounds** than a plain-JS Expo build would, since I can't compile or
validate Swift locally at all (only the config-plugin's file-copying and Xcode-project
wiring were verified locally — the actual Swift content is unverified until a real
macOS build runs).

## 5. Android: release APK + SMS auto-detection

Android needs none of the iOS ceremony above: a **release-type, debug-signed APK** installs
directly via "Install unknown apps" — no LiveContainer-style container app, no
Apple-Developer-Program equivalent. (It's a `release` *build type* — bundles the JS into the
APK so it runs standalone with no Metro dev server — but still signed with Gradle's default
debug keystore, since there's no Play Store distribution to worry about.)
[.github/workflows/mobile-apk-debug.yml](../.github/workflows/mobile-apk-debug.yml) builds one
on a plain `ubuntu-latest` runner (Android tooling needs no macOS), same `workflow_dispatch`
pattern as the iOS workflow — trigger it from the **Actions** tab (workflow is named
**"Build Android APK"**) and download the **`release-apk`** artifact.

It requires the **same** `FINANCE_SERVER_URL` / `FINANCE_API_TOKEN` repository secrets as
the iOS build (§ 4) — set those up once and both platforms are covered.

Android also gets a capability iOS categorically cannot have: Apple never allows reading
SMS content, but Android does, so `mobile/android-native/SmsReceiver.kt` listens for
incoming SMS, and if it looks like a bank transaction alert (regex-matches an amount,
guesses debit/credit from keywords like "credited"/"debited"), POSTs it straight to
`/api/ingest/transaction` — mirroring what the backend's alert-email parsing
(`app/services/alert_email_service.py`) already does for email, but for SMS instead. It
runs even when the app isn't open (a manifest-registered `BroadcastReceiver`, not a
JS-side listener), and uses only `java.net`/`org.json` (Android's standard library) rather
than adding an HTTP client dependency.

This needs the `RECEIVE_SMS`/`READ_SMS` (and `POST_NOTIFICATIONS`, for later use) runtime
permissions, requested once after login (`src/utils/androidPermissions.ts`) — declining
them just means SMS auto-detection never fires, nothing else breaks.

**Unverified beyond static review**: unlike iOS, this environment has no Android
SDK/emulator either, so — same caveat as the App Intent — the config plugin's file-copying
and manifest-merging were verified locally (confirmed via a real `expo prebuild
--platform android` run: both Kotlin files land in the right package directory, and the
manifest gets the right permissions + receiver registration), but the actual Kotlin
compiles for the first time in CI. The SMS regex is also a first-pass heuristic tuned for
common Indian bank SMS phrasing ("Rs. 500 debited...") — expect it to need tuning against
your actual bank's SMS format once you can see real messages come through (or not).

## 6. Project layout

```
mobile/
├── App.tsx                  # providers + navigation root
├── ios-native/               # Swift App Intent source, injected into ios/ at prebuild time
├── android-native/           # Kotlin SMS receiver source, injected into android/ at prebuild time
├── plugins/                  # Expo config plugins wiring the above into their native projects
├── src/
│   ├── api/                 # axios client (auth/refresh) + typed endpoint wrappers
│   ├── context/AuthContext.tsx
│   ├── navigation/RootNavigator.tsx
│   ├── screens/              # Login, Dashboard, Transactions, AddTransaction, Settings/*
│   ├── types.ts               # shared types mirroring the backend Pydantic schemas
│   └── utils/format.ts
```

## 7. Notes

- This app authenticates with the same JWT session endpoints the web frontend uses
  (`/api/auth/login`, `/api/auth/refresh`, `/api/users/me`), not the API-token
  (`X-API-Key`) ingestion path used by the existing iOS Shortcut integration — those two
  are independent ways to reach the server and can both stay in use side by side.
- CORS (`ALLOWED_ORIGINS` in `.env`) only affects browser requests; a native app's HTTP
  requests aren't subject to it, so no backend config change is needed for this app to
  reach the server.
