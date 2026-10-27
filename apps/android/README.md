# Disbigle for Android

Native app (Kotlin, Jetpack Compose, Android 9+) on the Mastodon-compatible API of a Disbigle server, with OAuth + PKCE (`disbigle://oauth`).

- `kit/`: the API without UI (models, client, sign-in, post HTML, notification rules). Plain Kotlin/JVM: `./gradlew :kit:test`; with `DISBIGLE_TEST_SERVER=http://localhost:3300` it also runs the whole flow against a seeded development server.
- `app/`: the app. `./gradlew :app:assembleDebug`.
- Languages: English, Italian, Spanish (`app/src/main/res/values*/strings.xml`).
- Notifications are local: WorkManager looks for new notifications about every 15 minutes and shows the chosen kinds; the server's read marker keeps the count in step with the web and the other apps.

Release builds are signed with the key in the environment (`DISBIGLE_KEYSTORE`, `DISBIGLE_KEYSTORE_PASSWORD`); CI publishes them to the `android-latest` release (`.github/workflows/android.yml`). Every update must use the same key.

Debug builds accept `--es server <url> --es token <token> [--es screen home|notifications|messages|search|me|compose|settings…] [--ez check true]`, for screenshots and checks without the browser sign-in (`apps/ios/scripts/dev-token.sh` prints a token; `adb reverse tcp:3300 tcp:3300` lets the emulator reach a local server).
