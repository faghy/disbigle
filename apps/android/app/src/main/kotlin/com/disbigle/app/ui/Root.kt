package com.disbigle.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Mail
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.disbigle.app.AppModel
import com.disbigle.app.MainActivity
import com.disbigle.app.PendingRoute
import com.disbigle.app.R
import com.disbigle.kit.Account
import com.disbigle.kit.AccountList
import com.disbigle.kit.AspectList
import com.disbigle.kit.Status
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

@Composable
fun DisbigleRoot(model: AppModel, activity: MainActivity) {
  DisbigleTheme {
    CompositionLocalProvider(LocalApp provides model) {
      val session = model.session
      LaunchedEffect(session?.token) { model.refresh() }
      if (session == null) SignInScreen(activity.signInError.value) else MainScreen(model)
    }
  }
}

/** Moves between screens; remembers posts and people so the next screen shows them at once. */
class Nav(val controller: NavHostController, private val model: AppModel) {
  fun status(status: Status) {
    model.statuses[status.id] = status
    controller.navigate("status/${status.id}")
  }

  fun statusId(id: String) = controller.navigate("status/$id")

  fun account(account: Account) {
    model.accounts[account.id] = account
    controller.navigate("account/${account.id}")
  }

  fun accountId(id: String) = controller.navigate("account/$id")

  fun tag(name: String) = controller.navigate("tag/${android.net.Uri.encode(name)}")

  fun settings(page: String = "") = controller.navigate(if (page.isEmpty()) "settings" else "settings/$page")

  fun aspect(aspect: AspectList) = controller.navigate("settings/aspect/${aspect.id}/${android.net.Uri.encode(aspect.title)}")

  fun back() = controller.popBackStack()

  /** Mentions and hashtags open inside the app, other links in the browser. */
  fun link(status: Status, url: String, context: android.content.Context) {
    status.mentions.firstOrNull { it.url == url }?.let { return accountId(it.id) }
    status.tags.firstOrNull { it.url.equals(url, ignoreCase = true) }?.let { return tag(it.name) }
    openInBrowser(context, url)
  }
}

private data class Tab(val route: String, val label: Int, val icon: ImageVector, val selectedIcon: ImageVector)

private val tabs = listOf(
  Tab("home", R.string.tab_home, Icons.Outlined.Home, Icons.Filled.Home),
  Tab("notifications", R.string.tab_notifications, Icons.Outlined.Notifications, Icons.Filled.Notifications),
  Tab("messages", R.string.tab_messages, Icons.Outlined.Mail, Icons.Filled.Mail),
  Tab("search", R.string.tab_search, Icons.Outlined.Search, Icons.Filled.Search),
  Tab("me", R.string.tab_profile, Icons.Outlined.AccountCircle, Icons.Filled.AccountCircle),
)

@Composable
fun MainScreen(model: AppModel) {
  val controller = rememberNavController()
  val nav = remember(controller) { Nav(controller, model) }
  var selectedTab by rememberSaveable { mutableStateOf("home") }
  val entry by controller.currentBackStackEntryAsState()
  val composing = entry?.destination?.route == "compose"

  fun select(route: String) {
    selectedTab = route
    controller.navigate(route) {
      popUpTo(controller.graph.findStartDestination().id) { saveState = true }
      launchSingleTop = true
      restoreState = true
    }
  }

  // While the app is on screen: the unread count every minute (no system notifications). Only
  // then: a check here marks notifications as seen, so in the background they must stay news.
  val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
  LaunchedEffect(model.session?.token) {
    lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
      while (true) {
        model.notifier.check(model.client, model.preferences, announce = false)
        delay(60_000)
      }
    }
  }
  // A tapped system notification: open what it is about from the notifications tab.
  LaunchedEffect(model.pendingRoute) {
    val route = model.pendingRoute ?: return@LaunchedEffect
    model.pendingRoute = null
    select("notifications")
    when (route) {
      is PendingRoute.StatusId -> nav.statusId(route.id)
      is PendingRoute.AccountId -> nav.accountId(route.id)
    }
  }
  // Writing opens as a screen of its own (over the tabs, without the bottom bar).
  LaunchedEffect(model.composing) {
    if (model.composing != null && !composing) controller.navigate("compose")
  }
  // Debug builds, for screenshots: the screen to open first.
  LaunchedEffect(Unit) {
    when (val screen = model.debugScreen) {
      null, "home" -> {}
      "compose" -> model.composing = com.disbigle.app.ComposeTarget.New
      "settings" -> { select("me"); nav.settings() }
      "settings-notifications" -> { select("me"); nav.settings(); nav.settings("notifications") }
      "settings-profile" -> { select("me"); nav.settings(); nav.settings("profile") }
      else -> select(screen)
    }
  }

  Scaffold(
    // Each screen's top bar handles the status bar; the navigation bar handles the bottom.
    contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0),
    bottomBar = {
      if (!composing) NavigationBar {
        for (tab in tabs) {
          val selected = selectedTab == tab.route
          NavigationBarItem(
            selected = selected,
            onClick = {
              // Tapping the current tab again goes back to its first screen.
              if (selected) controller.popBackStack(tab.route, inclusive = false) else select(tab.route)
            },
            icon = {
              val icon = if (selected) tab.selectedIcon else tab.icon
              if (tab.route == "notifications" && model.notifier.unread > 0) {
                BadgedBox(badge = { Badge { Text(model.notifier.unread.toString()) } }) { Icon(icon, null) }
              } else {
                Icon(icon, null)
              }
            },
            label = { Text(stringResource(tab.label)) },
          )
        }
      }
    },
  ) { padding ->
    NavHost(controller, startDestination = "home", modifier = Modifier.padding(padding)) {
      composable("home") { TimelineScreen(nav) }
      composable("notifications") { NotificationsScreen(nav) }
      composable("messages") { ConversationsScreen(nav) }
      composable("search") { SearchScreen(nav) }
      composable("me") {
        val me = model.me
        if (me != null) ProfileScreen(nav, me.id, isMe = true) else Loading()
      }
      composable("status/{id}") { StatusScreen(nav, it.arguments?.getString("id")!!) }
      composable("account/{id}") {
        val id = it.arguments?.getString("id")!!
        ProfileScreen(nav, id, isMe = id == model.me?.id)
      }
      composable("tag/{name}") { TagScreen(nav, it.arguments?.getString("name")!!) }
      composable("compose") {
        val target = model.composing
        if (target != null) {
          // Closing clears the target; the screen then leaves (once) below.
          ComposeScreen(target, onClose = { model.composing = null })
        } else {
          LaunchedEffect(Unit) {
            if (controller.currentBackStackEntry?.destination?.route == "compose") controller.popBackStack()
          }
        }
      }
      composable("settings") { SettingsScreen(nav) }
      composable("settings/profile") { EditProfileScreen(nav) }
      composable("settings/notifications") { NotificationSettingsScreen(nav) }
      composable("settings/posting") { PostingSettingsScreen(nav) }
      composable("settings/blocks") { AccountListScreen(nav, AccountList.BLOCKS) }
      composable("settings/mutes") { AccountListScreen(nav, AccountList.MUTES) }
      composable("settings/requests") { AccountListScreen(nav, AccountList.FOLLOW_REQUESTS) }
      composable("settings/bookmarks") { SavedPostsScreen(nav, bookmarks = true) }
      composable("settings/favourites") { SavedPostsScreen(nav, bookmarks = false) }
      composable("settings/aspects") { AspectsScreen(nav) }
      composable("settings/aspect/{id}/{title}") {
        AspectMembersScreen(nav, AspectList(it.arguments?.getString("id")!!, it.arguments?.getString("title")!!))
      }
    }
  }
}
