package com.disbigle.app.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.SettingsApplications
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.disbigle.app.BuildConfig
import com.disbigle.app.R
import com.disbigle.kit.Account
import com.disbigle.kit.AccountAction
import com.disbigle.kit.AccountList
import com.disbigle.kit.Alerts
import com.disbigle.kit.AspectList
import com.disbigle.kit.Notification
import com.disbigle.kit.ProfileDraft
import com.disbigle.kit.Status
import com.disbigle.kit.Visibility
import com.disbigle.kit.accounts
import com.disbigle.kit.act
import com.disbigle.kit.answerFollowRequest
import com.disbigle.kit.aspects
import com.disbigle.kit.bookmarks
import com.disbigle.kit.createAspect
import com.disbigle.kit.credentials
import com.disbigle.kit.deleteAspect
import com.disbigle.kit.favourites
import com.disbigle.kit.members
import com.disbigle.kit.removeMember
import com.disbigle.kit.renameAspect
import com.disbigle.kit.updateProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
private fun Row(title: String, icon: ImageVector, count: Int = 0, external: Boolean = false, onClick: () -> Unit) {
  ListItem(
    headlineContent = { Text(title) },
    leadingContent = { Icon(icon, null) },
    trailingContent = {
      when {
        external -> Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(18.dp))
        count > 0 -> Text(count.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    },
    modifier = Modifier.clickable(onClick = onClick),
  )
}

@Composable
fun SettingsScreen(nav: Nav) {
  val model = LocalApp.current
  val context = LocalContext.current
  var confirmSignOut by remember { mutableStateOf(false) }
  var followRequests by remember { mutableStateOf(0) }
  val server = model.session?.server ?: ""
  LaunchedEffect(Unit) { followRequests = runCatching { model.client?.credentials()?.source?.followRequestsCount }.getOrNull() ?: 0 }

  Screen(stringResource(R.string.settings), nav) { modifier ->
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
      model.me?.let { me ->
        ListItem(
          headlineContent = { Text(me.name) },
          supportingContent = {
            Column {
              Text("@${me.acct}@${server.removePrefix("https://").removePrefix("http://")}")
              Text(stringResource(R.string.edit_profile), color = MaterialTheme.colorScheme.primary)
            }
          },
          leadingContent = { Avatar(me, 52.dp) },
          modifier = Modifier.clickable { nav.settings("profile") },
        )
      }
      SectionTitle(stringResource(R.string.this_device))
      Row(stringResource(R.string.notifications), Icons.Outlined.Notifications) { nav.settings("notifications") }
      Row(stringResource(R.string.posting), Icons.Outlined.Edit) { nav.settings("posting") }
      Row(stringResource(R.string.android_settings), Icons.Outlined.SettingsApplications) {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}")))
      }
      SectionTitle(stringResource(R.string.people))
      Row(stringResource(R.string.follow_requests), Icons.Outlined.PersonAdd, followRequests) { nav.settings("requests") }
      Row(stringResource(R.string.blocked), Icons.Outlined.Block) { nav.settings("blocks") }
      Row(stringResource(R.string.muted), Icons.Outlined.VolumeOff) { nav.settings("mutes") }
      Row(stringResource(R.string.aspects), Icons.Outlined.Groups) { nav.settings("aspects") }
      SectionTitle(stringResource(R.string.saved))
      Row(stringResource(R.string.bookmarks), Icons.Outlined.BookmarkBorder) { nav.settings("bookmarks") }
      Row(stringResource(R.string.liked_posts), Icons.Outlined.FavoriteBorder) { nav.settings("favourites") }
      SectionTitle(stringResource(R.string.security_and_account))
      Row(stringResource(R.string.security), Icons.Outlined.Security, external = true) { openInBrowser(context, "$server/settings/security") }
      Row(stringResource(R.string.apps_with_access), Icons.Outlined.Apps, external = true) { openInBrowser(context, "$server/settings/apps") }
      Row(stringResource(R.string.account_actions), Icons.Outlined.ManageAccounts, external = true) { openInBrowser(context, "$server/settings/account") }
      Text(stringResource(R.string.security_footer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
      SectionTitle(stringResource(R.string.about))
      ListItem(headlineContent = { Text(stringResource(R.string.version)) }, trailingContent = { Text("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})") })
      ListItem(headlineContent = { Text(stringResource(R.string.server)) }, trailingContent = { Text(server.removePrefix("https://")) })
      Row(stringResource(R.string.source_code), Icons.Outlined.Code, external = true) { openInBrowser(context, "https://github.com/faghy/disbigle") }
      Row("disbigle.com", Icons.Outlined.Language, external = true) { openInBrowser(context, "https://disbigle.com") }
      TextButton(onClick = { confirmSignOut = true }, modifier = Modifier.padding(8.dp)) {
        Text(stringResource(R.string.sign_out), color = MaterialTheme.colorScheme.error)
      }
    }
  }
  if (confirmSignOut) {
    AlertDialog(
      onDismissRequest = { confirmSignOut = false },
      title = { Text(stringResource(R.string.sign_out_question)) },
      confirmButton = { TextButton(onClick = { confirmSignOut = false; model.signOut() }) { Text(stringResource(R.string.sign_out), color = MaterialTheme.colorScheme.error) } },
      dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
}

@Composable
private fun SwitchRow(title: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
  ListItem(
    headlineContent = { Text(title) },
    trailingContent = { Switch(checked, onChange, enabled = enabled) },
    modifier = Modifier.clickable(enabled = enabled) { onChange(!checked) },
  )
}

@Composable
fun NotificationSettingsScreen(nav: Nav) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val preferences = model.preferences
  var permitted by remember { mutableStateOf(model.notifier.permitted) }
  var askedAndDenied by remember { mutableStateOf(false) }

  fun turnOn() {
    preferences.notificationsOn = true
    scope.launch {
      // Start from what is there now: older notifications are not news.
      model.notifier.check(model.client, preferences, announce = false)
      model.notifier.schedule(true)
    }
  }
  val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    permitted = granted
    if (granted) turnOn() else askedAndDenied = true
  }

  Screen(stringResource(R.string.notifications), nav) { modifier ->
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
      SwitchRow(stringResource(R.string.notifications_on_device), preferences.notificationsOn && permitted) { on ->
        when {
          !on -> { preferences.notificationsOn = false; model.notifier.schedule(false) }
          permitted -> turnOn()
          Build.VERSION.SDK_INT >= 33 -> permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
      }
      if (askedAndDenied) {
        TextButton(onClick = {
          context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
        }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(stringResource(R.string.allow_in_settings)) }
      }
      Text(stringResource(R.string.notifications_footer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
      if (preferences.notificationsOn && permitted) {
        SectionTitle(stringResource(R.string.notify_me_about))
        for (kind in Alerts.kinds) {
          SwitchRow(kindLabel(kind), kind in preferences.alertKinds) { preferences.setAlertKind(kind, it) }
        }
      }
    }
  }
}

@Composable
private fun kindLabel(kind: Notification.Kind): String = stringResource(
  when (kind) {
    Notification.Kind.MENTION -> R.string.kind_mention
    Notification.Kind.REBLOG -> R.string.kind_reblog
    Notification.Kind.FAVOURITE -> R.string.kind_favourite
    Notification.Kind.FOLLOW -> R.string.kind_follow
    Notification.Kind.FOLLOW_REQUEST -> R.string.kind_follow_request
    Notification.Kind.POLL -> R.string.kind_poll
    Notification.Kind.UPDATE -> R.string.kind_update
    Notification.Kind.STATUS -> R.string.kind_status
    Notification.Kind.UNKNOWN -> R.string.kind_other
  },
)

@Composable
fun PostingSettingsScreen(nav: Nav) {
  val preferences = LocalApp.current.preferences
  Screen(stringResource(R.string.posting), nav) { modifier ->
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
      SectionTitle(stringResource(R.string.default_visibility))
      for ((value, label) in listOf(
        Visibility.PUBLIC to R.string.visibility_public,
        Visibility.UNLISTED to R.string.visibility_unlisted_long,
        Visibility.PRIVATE to R.string.visibility_followers,
      )) {
        ListItem(
          headlineContent = { Text(stringResource(label)) },
          leadingContent = { RadioButton(preferences.defaultVisibility == value, { preferences.defaultVisibility = value }) },
          modifier = Modifier.clickable { preferences.defaultVisibility = value },
        )
      }
      SwitchRow(stringResource(R.string.always_sensitive), preferences.sensitiveMedia) { preferences.sensitiveMedia = it }
      Text(stringResource(R.string.posting_footer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
    }
  }
}

@Composable
fun EditProfileScreen(nav: Nav) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var draft by remember { mutableStateOf<ProfileDraft?>(null) }
  var avatarPreview by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
  var headerPreview by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
  var saving by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(Unit) {
    try {
      draft = model.client?.credentials()?.let(::ProfileDraft)
    } catch (e: Exception) {
      error = context.messageOf(e)
    }
  }
  fun picker(avatar: Boolean) = ActivityResultContracts.PickVisualMedia()
  val pickAvatar = rememberLauncherForActivityResult(picker(true)) { uri ->
    uri ?: return@rememberLauncherForActivityResult
    scope.launch {
      val image = withContext(Dispatchers.IO) { runCatching { readImage(context, uri) }.getOrNull() } ?: return@launch
      avatarPreview = image.first
      draft = draft?.copy(avatar = ProfileDraft.Upload(image.second, "image/jpeg"))
    }
  }
  val pickHeader = rememberLauncherForActivityResult(picker(false)) { uri ->
    uri ?: return@rememberLauncherForActivityResult
    scope.launch {
      val image = withContext(Dispatchers.IO) { runCatching { readImage(context, uri) }.getOrNull() } ?: return@launch
      headerPreview = image.first
      draft = draft?.copy(header = ProfileDraft.Upload(image.second, "image/jpeg"))
    }
  }

  Screen(
    stringResource(R.string.edit_profile), nav,
    actions = {
      if (saving) {
        CircularProgressIndicator(Modifier.size(24.dp).padding(end = 8.dp), strokeWidth = 2.dp)
      } else {
        TextButton(enabled = draft != null, onClick = {
          val current = draft ?: return@TextButton
          saving = true
          scope.launch {
            try {
              model.client?.updateProfile(current)
              model.refresh()
              nav.back()
            } catch (e: Exception) {
              error = context.messageOf(e)
            } finally {
              saving = false
            }
          }
        }) { Text(stringResource(R.string.save)) }
      }
    },
  ) { modifier ->
    val current = draft
    if (current == null) {
      if (error != null) Hint(error!!) else Loading()
      return@Screen
    }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      SectionTitle(stringResource(R.string.pictures))
      Row(Modifier.fillMaxWidth().clickable { pickAvatar.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val preview = avatarPreview
        if (preview != null) {
          Image(preview.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)))
        } else {
          Avatar(model.me, 56.dp)
        }
        Text(stringResource(R.string.change_avatar), color = MaterialTheme.colorScheme.primary)
      }
      Row(Modifier.fillMaxWidth().clickable { pickHeader.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val preview = headerPreview
        val shape = RoundedCornerShape(6.dp)
        when {
          preview != null -> Image(preview.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.width(96.dp).height(32.dp).clip(shape))
          model.me?.headerUrl != null -> coil3.compose.AsyncImage(model.me?.headerUrl, null, contentScale = ContentScale.Crop, modifier = Modifier.width(96.dp).height(32.dp).clip(shape))
          else -> androidx.compose.foundation.layout.Box(Modifier.width(96.dp).height(32.dp).clip(shape).then(Modifier.padding(0.dp)))
        }
        Text(stringResource(R.string.change_header), color = MaterialTheme.colorScheme.primary)
      }
      SectionTitle(stringResource(R.string.name_and_bio))
      OutlinedTextField(current.displayName, { draft = current.copy(displayName = it) }, label = { Text(stringResource(R.string.display_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(current.note, { draft = current.copy(note = it) }, label = { Text(stringResource(R.string.bio)) }, minLines = 3, maxLines = 8, modifier = Modifier.fillMaxWidth())
      SectionTitle(stringResource(R.string.profile_fields))
      current.fields.forEachIndexed { index, field ->
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            OutlinedTextField(field.name, { draft = current.copy(fields = current.fields.toMutableList().also { f -> f[index] = field.copy(name = it) }) }, label = { Text(stringResource(R.string.field_label)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(field.value, { draft = current.copy(fields = current.fields.toMutableList().also { f -> f[index] = field.copy(value = it) }) }, label = { Text(stringResource(R.string.field_content)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
          }
          IconButton(onClick = { draft = current.copy(fields = current.fields.filterIndexed { i, _ -> i != index }) }) { Icon(Icons.Outlined.Delete, stringResource(R.string.remove)) }
        }
      }
      if (current.fields.size < 4) {
        TextButton(onClick = { draft = current.copy(fields = current.fields + Account.Field("", "")) }) { Text(stringResource(R.string.add_field)) }
      }
      Text(stringResource(R.string.fields_footer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      HorizontalDivider()
      SwitchRow(stringResource(R.string.approve_followers), current.locked) { draft = current.copy(locked = it) }
      SwitchRow(stringResource(R.string.suggest_profile), current.discoverable) { draft = current.copy(discoverable = it) }
      SwitchRow(stringResource(R.string.automated_account), current.bot) { draft = current.copy(bot = it) }
      SectionTitle(stringResource(R.string.email_language))
      for ((code, name) in listOf("en" to "English", "it" to "Italiano", "es" to "Español")) {
        ListItem(
          headlineContent = { Text(name) },
          leadingContent = { RadioButton((current.language ?: "en") == code, { draft = current.copy(language = code) }) },
          modifier = Modifier.clickable { draft = current.copy(language = code) },
        )
      }
      error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
  }
}

@Composable
fun AccountListScreen(nav: Nav, list: AccountList) {
  val model = LocalApp.current
  val scope = rememberCoroutineScope()
  val store: ListStore = viewModel()
  val client = model.client
  val accounts = store.list<Account>("accounts:${list.path}", { it.id }) { q -> client!!.accounts(list, q) }
  LaunchedEffect(accounts) { if (!accounts.loaded) accounts.refresh() }
  val title = stringResource(
    when (list) {
      AccountList.BLOCKS -> R.string.blocked
      AccountList.MUTES -> R.string.muted
      AccountList.FOLLOW_REQUESTS -> R.string.follow_requests
    },
  )
  fun remove(account: Account, action: suspend () -> Unit) {
    scope.launch { if (runCatching { action() }.isSuccess) accounts.remove(account.id) }
  }
  Screen(title, nav) { modifier ->
    LazyColumn(modifier.fillMaxSize()) {
      itemsIndexed(accounts.items, key = { _, a -> a.id }) { index, account ->
        LaunchedEffect(index) { accounts.reached(index) }
        AccountRow(account, onClick = { nav.account(account) }) {
          when (list) {
            AccountList.BLOCKS -> OutlinedButton(onClick = { remove(account) { client!!.act(AccountAction.UNBLOCK, account.id) } }) { Text(stringResource(R.string.unblock)) }
            AccountList.MUTES -> OutlinedButton(onClick = { remove(account) { client!!.act(AccountAction.UNMUTE, account.id) } }) { Text(stringResource(R.string.unmute)) }
            AccountList.FOLLOW_REQUESTS -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              FilledTonalIconButton(onClick = { remove(account) { client!!.answerFollowRequest(account.id, true) } }) { Icon(Icons.Filled.Check, stringResource(R.string.accept)) }
              IconButton(onClick = { remove(account) { client!!.answerFollowRequest(account.id, false) } }) { Icon(Icons.Filled.Close, stringResource(R.string.decline)) }
            }
          }
        }
        HorizontalDivider()
      }
      item { ListFooter(accounts.loading, accounts.error, accounts.loaded && accounts.items.isEmpty(), stringResource(R.string.nobody_here)) { accounts.refresh() } }
    }
  }
}

@Composable
fun SavedPostsScreen(nav: Nav, bookmarks: Boolean) {
  val model = LocalApp.current
  val store: ListStore = viewModel()
  val client = model.client
  val list = store.list<Status>(if (bookmarks) "bookmarks" else "favourites", { it.id }) { q ->
    if (bookmarks) client!!.bookmarks(q) else client!!.favourites(q)
  }
  Screen(stringResource(if (bookmarks) R.string.bookmarks else R.string.liked_posts), nav) { modifier ->
    StatusList(list, nav, stringResource(R.string.nothing_saved), modifier)
  }
}

@Composable
fun AspectsScreen(nav: Nav) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val client = model.client
  var aspects by remember { mutableStateOf<List<AspectList>>(emptyList()) }
  var newName by remember { mutableStateOf("") }
  var renaming by remember { mutableStateOf<AspectList?>(null) }
  var renameText by remember { mutableStateOf("") }
  var deleting by remember { mutableStateOf<AspectList?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(Unit) { aspects = runCatching { client?.aspects() }.getOrNull() ?: emptyList() }

  fun attempt(block: suspend () -> Unit) {
    scope.launch {
      try {
        block()
        error = null
      } catch (e: Exception) {
        error = context.messageOf(e)
      }
    }
  }

  Screen(stringResource(R.string.aspects), nav) { modifier ->
    LazyColumn(modifier.fillMaxSize()) {
      items(aspects, key = { it.id }) { aspect ->
        ListItem(
          headlineContent = { Text(aspect.title) },
          leadingContent = { Icon(Icons.Outlined.Groups, null) },
          trailingContent = {
            Row {
              IconButton(onClick = { renameText = aspect.title; renaming = aspect }) { Icon(Icons.Outlined.Edit, stringResource(R.string.rename)) }
              IconButton(onClick = { deleting = aspect }) { Icon(Icons.Outlined.Delete, stringResource(R.string.delete)) }
            }
          },
          modifier = Modifier.clickable { nav.aspect(aspect) },
        )
      }
      item {
        Text(stringResource(R.string.aspects_footer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedTextField(newName, { newName = it }, label = { Text(stringResource(R.string.new_aspect)) }, singleLine = true, modifier = Modifier.weight(1f))
          Button(enabled = newName.isNotBlank(), onClick = {
            attempt {
              aspects = aspects + client!!.createAspect(newName.trim())
              newName = ""
            }
          }) { Text(stringResource(R.string.add)) }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
      }
    }
  }
  renaming?.let { aspect ->
    AlertDialog(
      onDismissRequest = { renaming = null },
      title = { Text(stringResource(R.string.rename_aspect)) },
      text = { OutlinedTextField(renameText, { renameText = it }, singleLine = true) },
      confirmButton = {
        TextButton(onClick = {
          renaming = null
          attempt {
            val renamed = client!!.renameAspect(aspect.id, renameText.trim())
            aspects = aspects.map { if (it.id == aspect.id) renamed else it }
          }
        }) { Text(stringResource(R.string.save)) }
      },
      dismissButton = { TextButton(onClick = { renaming = null }) { Text(stringResource(R.string.cancel)) } },
    )
  }
  deleting?.let { aspect ->
    AlertDialog(
      onDismissRequest = { deleting = null },
      title = { Text(stringResource(R.string.delete_aspect_question, aspect.title)) },
      confirmButton = {
        TextButton(onClick = {
          deleting = null
          attempt {
            client!!.deleteAspect(aspect.id)
            aspects = aspects.filter { it.id != aspect.id }
          }
        }) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
      },
      dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.cancel)) } },
    )
  }
}

@Composable
fun AspectMembersScreen(nav: Nav, aspect: AspectList) {
  val model = LocalApp.current
  val scope = rememberCoroutineScope()
  val client = model.client
  var members by remember { mutableStateOf<List<Account>>(emptyList()) }
  var loading by remember { mutableStateOf(true) }
  LaunchedEffect(aspect.id) {
    members = runCatching { client?.members(aspect.id) }.getOrNull() ?: emptyList()
    loading = false
  }
  Screen(aspect.title, nav) { modifier ->
    LazyColumn(modifier.fillMaxSize()) {
      items(members, key = { it.id }) { account ->
        AccountRow(account, onClick = { nav.account(account) }) {
          TextButton(onClick = {
            scope.launch {
              if (runCatching { client?.removeMember(account.id, aspect.id) }.isSuccess) members = members.filter { it.id != account.id }
            }
          }) { Text(stringResource(R.string.remove), color = MaterialTheme.colorScheme.error) }
        }
        HorizontalDivider()
      }
      if (!loading && members.isEmpty()) item { Hint(stringResource(R.string.aspect_empty)) }
    }
  }
}
