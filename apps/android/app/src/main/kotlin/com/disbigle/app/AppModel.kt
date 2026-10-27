package com.disbigle.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.disbigle.kit.Account
import com.disbigle.kit.ApiException
import com.disbigle.kit.Client
import com.disbigle.kit.Instance
import com.disbigle.kit.RegisteredApp
import com.disbigle.kit.SignIn
import com.disbigle.kit.Status
import com.disbigle.kit.instance
import com.disbigle.kit.me
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** A signed-in account: where it lives and the token the app was given. */
@Serializable
data class StoredSession(val server: String, val token: String, val clientId: String, val clientSecret: String)

/** What the compose screen is for. */
sealed interface ComposeTarget {
  data object New : ComposeTarget
  data class Reply(val status: Status) : ComposeTarget
  data class Edit(val status: Status) : ComposeTarget
}

/** Where a tap on a system notification leads. */
sealed interface PendingRoute {
  data class StatusId(val id: String) : PendingRoute
  data class AccountId(val id: String) : PendingRoute
}

/** The app's state: the session, the account, and what screens share. */
class AppModel(application: Application) : AndroidViewModel(application) {
  var session by mutableStateOf(SessionStore.load(application))
    private set
  var me by mutableStateOf<Account?>(null)
    private set
  var instance by mutableStateOf<Instance?>(null)
    private set
  var composing by mutableStateOf<ComposeTarget?>(null)
  var pendingRoute by mutableStateOf<PendingRoute?>(null)
  /** The last post published or edited from this app, for lists to show at once. */
  var lastSaved by mutableStateOf<Status?>(null)
    private set
  /** A sign-in waiting for the browser to come back with the code (kept on disk: Android may stop the app meanwhile). */
  private var signingIn: SignIn?
    get() = SessionStore.loadPending(getApplication())
    set(value) = SessionStore.savePending(getApplication(), value)

  val preferences = Preferences(application)
  val notifier = Notifier(application)

  /** Posts and people already loaded, so a pushed screen shows them at once. */
  val statuses = mutableMapOf<String, Status>()
  val accounts = mutableMapOf<String, Account>()

  val client: Client? get() = session?.let { Client(it.server, it.token) }

  /** Debug builds: `--es server <url> --es token <token> --es screen <name>` sign in without the browser (screenshots). */
  var debugScreen: String? = null
    private set

  fun debugSignIn(server: String, token: String, screen: String?) {
    session = StoredSession(server, token, "", "").also { SessionStore.save(getApplication(), it) }
    debugScreen = screen
  }

  /** Loads the account and the server limits; signs out if the token was revoked. */
  suspend fun refresh() {
    val client = client ?: return
    try {
      me = client.me().also { accounts[it.id] = it }
      instance = runCatching { client.instance() }.getOrNull()
    } catch (_: ApiException.Unauthorized) {
      forget()
    } catch (_: Exception) {
      // Offline or server down: keep the session, the lists show the error.
    }
  }

  /** First half of the sign-in: registers the app and returns the page to open in the browser. */
  suspend fun startSignIn(input: String): String {
    val server = SignIn.serverUrl(input) ?: throw IllegalArgumentException(getApplication<Application>().getString(R.string.bad_server_address))
    val signIn = SignIn.start(server)
    signingIn = signIn
    return signIn.authorizeUrl
  }

  /** Second half: the browser came back to `disbigle://oauth`. */
  suspend fun finishSignIn(callback: String) {
    val signIn = signingIn ?: throw SignIn.Failure.BadCallback()
    val token = signIn.exchange(signIn.code(callback))
    signingIn = null
    val stored = StoredSession(signIn.server, token.accessToken, signIn.app.clientId, signIn.app.clientSecret)
    SessionStore.save(getApplication(), stored)
    session = stored
    refresh()
  }

  val waitingForBrowser: Boolean get() = signingIn != null

  fun signOut() {
    val current = session
    forget()
    if (current != null && current.clientId.isNotEmpty()) {
      viewModelScope.launch {
        runCatching { SignIn.revoke(current.token, current.server, RegisteredApp(current.clientId, current.clientSecret)) }
      }
    }
  }

  /** Opens what a tapped notification is about. */
  fun open(statusId: String?, accountId: String?) {
    pendingRoute = when {
      statusId != null -> PendingRoute.StatusId(statusId)
      accountId != null -> PendingRoute.AccountId(accountId)
      else -> null
    }
  }

  fun saved(status: Status) {
    statuses[status.id] = status
    lastSaved = status
  }

  private fun forget() {
    notifier.signedOut()
    SessionStore.delete(getApplication())
    session = null
    me = null
    instance = null
    statuses.clear()
    accounts.clear()
  }
}

/** The session in the app's private storage (excluded from backups, see the manifest). */
object SessionStore {
  private fun prefs(context: Context) = context.getSharedPreferences("session", Context.MODE_PRIVATE)

  fun load(context: Context): StoredSession? =
    prefs(context).getString("session", null)?.let { runCatching { Client.json.decodeFromString(StoredSession.serializer(), it) }.getOrNull() }

  fun save(context: Context, session: StoredSession) {
    prefs(context).edit().putString("session", Client.json.encodeToString(StoredSession.serializer(), session)).apply()
  }

  fun delete(context: Context) {
    prefs(context).edit().clear().apply()
  }

  @Serializable
  private data class Pending(val server: String, val clientId: String, val clientSecret: String, val verifier: String, val state: String)

  fun loadPending(context: Context): SignIn? =
    prefs(context).getString("pending", null)
      ?.let { runCatching { Client.json.decodeFromString(Pending.serializer(), it) }.getOrNull() }
      ?.let { SignIn(it.server, RegisteredApp(it.clientId, it.clientSecret), it.verifier, it.state) }

  fun savePending(context: Context, signIn: SignIn?) {
    val value = signIn?.let { Client.json.encodeToString(Pending.serializer(), Pending(it.server, it.app.clientId, it.app.clientSecret, it.verifier, it.state)) }
    prefs(context).edit().putString("pending", value).apply()
  }
}
