package com.disbigle.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Apartment
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.disbigle.app.ComposeTarget
import com.disbigle.app.R
import com.disbigle.kit.AspectList
import com.disbigle.kit.Conversation
import com.disbigle.kit.Notification
import com.disbigle.kit.RichText
import com.disbigle.kit.SearchResults
import com.disbigle.kit.Status
import com.disbigle.kit.StatusContext
import com.disbigle.kit.Timeline
import com.disbigle.kit.aspects
import com.disbigle.kit.context
import com.disbigle.kit.conversations
import com.disbigle.kit.markConversationRead
import com.disbigle.kit.notifications
import com.disbigle.kit.search
import com.disbigle.kit.status
import com.disbigle.kit.timeline
import kotlinx.coroutines.launch

/** A screen with a top bar; `back` shows the arrow to go back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Screen(
  title: String,
  nav: Nav?,
  back: Boolean = true,
  actions: @Composable () -> Unit = {},
  titleContent: (@Composable () -> Unit)? = null,
  floating: @Composable () -> Unit = {},
  content: @Composable (Modifier) -> Unit,
) {
  Scaffold(
    topBar = {
      TopAppBar(
        title = { titleContent?.invoke() ?: Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = {
          if (back && nav != null) {
            IconButton(onClick = { nav.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
          }
        },
        actions = { actions() },
      )
    },
    floatingActionButton = floating,
    contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0),
  ) { padding -> content(Modifier.padding(padding)) }
}

/** Posts in a list, each opening its thread. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatusList(
  list: PagedList<Status>,
  nav: Nav,
  emptyText: String,
  modifier: Modifier = Modifier,
  state: androidx.compose.foundation.lazy.LazyListState = rememberLazyListState(),
  header: LazyListScope.() -> Unit = {},
) {
  LaunchedEffect(list) { if (!list.loaded && !list.loading) list.refresh() }
  PullToRefreshBox(isRefreshing = list.loading && list.items.isNotEmpty(), onRefresh = { list.refresh() }, modifier = modifier.fillMaxSize()) {
    LazyColumn(Modifier.fillMaxSize(), state = state) {
      header()
      itemsIndexed(list.items, key = { _, s -> s.id }) { index, status ->
        LaunchedEffect(index) { list.reached(index) }
        StatusRow(status, nav, onDelete = { list.remove(it) })
        HorizontalDivider()
      }
      item {
        ListFooter(list.loading && list.items.isEmpty() || (list.loading && list.loaded), list.error, list.loaded && list.items.isEmpty(), emptyText) { list.loadMore().also { if (list.items.isEmpty()) list.refresh() } }
      }
    }
  }
}

@Composable
fun TimelineScreen(nav: Nav) {
  val model = LocalApp.current
  val store: ListStore = viewModel()
  var timeline by rememberSaveable(stateSaver = TimelineSaver) { mutableStateOf<Timeline>(Timeline.Home) }
  var aspects by remember { mutableStateOf<List<AspectList>>(emptyList()) }
  var menu by remember { mutableStateOf(false) }
  val client = model.client
  LaunchedEffect(client) { aspects = runCatching { client?.aspects() }.getOrNull() ?: emptyList() }

  fun listFor(t: Timeline): PagedList<Status> = store.list("timeline:$t", { it.id }) { q ->
    client?.timeline(t, q) ?: throw com.disbigle.kit.ApiException.Unauthorized()
  }
  val list = listFor(timeline)
  // A post written here shows at once at the top of the home timeline.
  val listState = rememberSaveable(timeline, saver = androidx.compose.foundation.lazy.LazyListState.Saver) { androidx.compose.foundation.lazy.LazyListState() }
  LaunchedEffect(model.lastSaved) {
    val saved = model.lastSaved ?: return@LaunchedEffect
    val home = listFor(Timeline.Home)
    if (saved.inReplyToId != null) return@LaunchedEffect home.replace(saved)
    // New at the top: scroll there, or the list keeps showing what was first before.
    if (home.items.firstOrNull()?.id != saved.id) home.prepend(saved)
    if (timeline == Timeline.Home) listState.scrollToItem(0)
  }

  val title = when (val t = timeline) {
    Timeline.Home -> stringResource(R.string.tab_home)
    Timeline.Local -> stringResource(R.string.this_server)
    Timeline.Federated -> stringResource(R.string.fediverse)
    is Timeline.Hashtag -> "#${t.name}"
    is Timeline.Aspect -> aspects.firstOrNull { it.id == t.id }?.title ?: stringResource(R.string.aspect)
  }
  Screen(
    title, nav, back = false,
    titleContent = {
      Box {
        Row(Modifier.clip(MaterialTheme.shapes.small).clickable { menu = true }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Icon(Icons.Outlined.ArrowDropDown, stringResource(R.string.choose_timeline))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
          @Composable fun option(t: Timeline, label: String, icon: ImageVector) = DropdownMenuItem(
            text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = { timeline = t; menu = false },
          )
          option(Timeline.Home, stringResource(R.string.tab_home), Icons.Outlined.Home)
          option(Timeline.Local, stringResource(R.string.this_server), Icons.Outlined.Apartment)
          option(Timeline.Federated, stringResource(R.string.fediverse), Icons.Outlined.Public)
          if (aspects.isNotEmpty()) {
            HorizontalDivider()
            Text(stringResource(R.string.aspects), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            for (aspect in aspects) option(Timeline.Aspect(aspect.id), aspect.title, Icons.Outlined.Groups)
          }
        }
      }
    },
    floating = {
      FloatingActionButton(onClick = { model.composing = ComposeTarget.New }) { Icon(Icons.Filled.Edit, stringResource(R.string.new_post)) }
    },
  ) { modifier -> StatusList(list, nav, stringResource(R.string.nothing_here), modifier, listState) }
}

/** Saves the chosen timeline across configuration changes. */
private val TimelineSaver = androidx.compose.runtime.saveable.Saver<Timeline, String>(
  save = { t ->
    when (t) {
      Timeline.Home -> "home"
      Timeline.Local -> "local"
      Timeline.Federated -> "federated"
      is Timeline.Hashtag -> "tag:${t.name}"
      is Timeline.Aspect -> "aspect:${t.id}"
    }
  },
  restore = {
    when {
      it == "local" -> Timeline.Local
      it == "federated" -> Timeline.Federated
      it.startsWith("tag:") -> Timeline.Hashtag(it.removePrefix("tag:"))
      it.startsWith("aspect:") -> Timeline.Aspect(it.removePrefix("aspect:"))
      else -> Timeline.Home
    }
  },
)

@Composable
fun TagScreen(nav: Nav, name: String) {
  val model = LocalApp.current
  val store: ListStore = viewModel()
  val client = model.client
  val list = store.list<Status>("tag:$name", { it.id }) { q -> client!!.timeline(Timeline.Hashtag(name), q) }
  Screen("#$name", nav) { modifier -> StatusList(list, nav, stringResource(R.string.nothing_here), modifier) }
}

/** A post with what it answers and the answers to it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatusScreen(nav: Nav, id: String) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var status by remember { mutableStateOf(model.statuses[id]) }
  var thread by remember { mutableStateOf<StatusContext?>(null) }
  var loading by remember { mutableStateOf(true) }
  var error by remember { mutableStateOf<String?>(null) }
  val listState = rememberLazyListState()

  suspend fun load() {
    val client = model.client ?: return
    loading = true
    try {
      if (status == null) status = client.status(id).also { model.statuses[id] = it }
      thread = client.context(id)
      error = null
    } catch (e: Exception) {
      error = context.messageOf(e)
    } finally {
      loading = false
    }
  }
  LaunchedEffect(id) {
    load()
    // Start at the post, with what it answers above.
    thread?.let { if (it.ancestors.isNotEmpty()) listState.scrollToItem(it.ancestors.size) }
  }
  LaunchedEffect(model.lastSaved) { if (model.lastSaved?.inReplyToId != null) load() }

  Screen(stringResource(R.string.thread), nav) { modifier ->
    PullToRefreshBox(isRefreshing = loading && thread != null, onRefresh = { scope.launch { load() } }, modifier = modifier.fillMaxSize()) {
      LazyColumn(Modifier.fillMaxSize(), state = listState) {
        thread?.let { t ->
          items(t.ancestors, key = { "a" + it.id }) { StatusRow(it, nav); HorizontalDivider() }
        }
        status?.let { s ->
          item(key = s.id) { StatusRow(s, nav, focused = true, onDelete = { nav.back() }); HorizontalDivider() }
        }
        thread?.let { t ->
          items(t.descendants, key = { "d" + it.id }) { reply ->
            StatusRow(reply, nav, modifier = Modifier.padding(start = if (reply.inReplyToId == id) 0.dp else 16.dp), onDelete = { removed ->
              thread = t.copy(descendants = t.descendants.filter { it.id != removed })
            })
            HorizontalDivider()
          }
        }
        if (loading && thread == null || error != null) {
          item { ListFooter(loading, error, false, "") { scope.launch { load() } } }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(nav: Nav) {
  val model = LocalApp.current
  val store: ListStore = viewModel()
  val client = model.client
  val scope = rememberCoroutineScope()
  val list = store.list<Notification>("notifications", { it.id }) { q -> client!!.notifications(q) }
  LaunchedEffect(list) { if (!list.loaded) list.refresh() else if (model.notifier.unread > 0) list.refresh() }
  // Shown here: read everywhere, and no system notification for them later.
  val newest = list.items.firstOrNull()?.id
  LaunchedEffect(newest) { if (newest != null) model.notifier.markAllRead(client, newest) }
  LaunchedEffect(model.notifier.unread) { if (model.notifier.unread > 0 && list.loaded) list.refresh() }

  Screen(stringResource(R.string.tab_notifications), nav, back = false) { modifier ->
    PullToRefreshBox(isRefreshing = list.loading && list.items.isNotEmpty(), onRefresh = { list.refresh() }, modifier = modifier.fillMaxSize()) {
      LazyColumn(Modifier.fillMaxSize()) {
        itemsIndexed(list.items, key = { _, n -> n.id }) { index, notification ->
          LaunchedEffect(index) { list.reached(index) }
          NotificationRow(notification, nav)
          HorizontalDivider()
        }
        item {
          ListFooter(list.loading && list.items.isEmpty(), list.error, list.loaded && list.items.isEmpty(), stringResource(R.string.no_notifications)) {
            scope.launch { list.refresh() }
          }
        }
      }
    }
  }
}

@Composable
fun NotificationRow(notification: Notification, nav: Nav) {
  val name = notification.account.name
  val (icon, summary) = when (notification.type) {
    Notification.Kind.MENTION -> Icons.Outlined.AlternateEmail to stringResource(R.string.n_mention, name)
    Notification.Kind.STATUS -> Icons.Outlined.Notifications to stringResource(R.string.n_status, name)
    Notification.Kind.REBLOG -> Icons.Outlined.Repeat to stringResource(R.string.n_reblog, name)
    Notification.Kind.FOLLOW -> Icons.Outlined.PersonAdd to stringResource(R.string.n_follow, name)
    Notification.Kind.FOLLOW_REQUEST -> Icons.Outlined.Schedule to stringResource(R.string.n_follow_request, name)
    Notification.Kind.FAVOURITE -> Icons.Outlined.Favorite to stringResource(R.string.n_favourite, name)
    Notification.Kind.POLL -> Icons.Outlined.BarChart to stringResource(R.string.n_poll)
    Notification.Kind.UPDATE -> Icons.Outlined.Edit to stringResource(R.string.n_update, name)
    Notification.Kind.UNKNOWN -> Icons.Outlined.Notifications to name
  }
  val status = notification.status
  Column(
    Modifier.fillMaxWidth().clickable { if (status != null) nav.status(status) else nav.account(notification.account) },
  ) {
    Row(
      Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = if (status == null) 12.dp else 4.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
      Avatar(notification.account, 32.dp)
      Text(summary, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
      Text(relative(notification.created), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (status != null) {
      if (notification.type == Notification.Kind.MENTION || notification.type == Notification.Kind.STATUS) {
        StatusRow(status, nav)
      } else {
        Text(
          RichText.plain(status.content), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 90.dp, end = 16.dp, bottom = 12.dp),
        )
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationsScreen(nav: Nav) {
  val model = LocalApp.current
  val store: ListStore = viewModel()
  val client = model.client
  val scope = rememberCoroutineScope()
  val list = store.list<Conversation>("conversations", { it.id }) { q -> client!!.conversations(q) }
  LaunchedEffect(list) { if (!list.loaded) list.refresh() }
  Screen(
    stringResource(R.string.tab_messages), nav, back = false,
    floating = {
      FloatingActionButton(onClick = { model.composing = ComposeTarget.New }) { Icon(Icons.Filled.Edit, stringResource(R.string.new_message)) }
    },
  ) { modifier ->
    PullToRefreshBox(isRefreshing = list.loading && list.items.isNotEmpty(), onRefresh = { list.refresh() }, modifier = modifier.fillMaxSize()) {
      LazyColumn(Modifier.fillMaxSize()) {
        itemsIndexed(list.items, key = { _, c -> c.id }) { index, conversation ->
          LaunchedEffect(index) { list.reached(index) }
          ConversationRow(conversation) {
            val last = conversation.lastStatus ?: return@ConversationRow
            nav.status(last)
            if (conversation.unread) {
              scope.launch { runCatching { client?.markConversationRead(conversation.id) } }
              list.replace(conversation.copy(unread = false))
            }
          }
          HorizontalDivider()
        }
        item {
          ListFooter(list.loading && list.items.isEmpty(), list.error, list.loaded && list.items.isEmpty(), stringResource(R.string.no_messages)) { list.refresh() }
        }
      }
    }
  }
}

@Composable
fun ConversationRow(conversation: Conversation, onClick: () -> Unit) {
  Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp, 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Box {
      Avatar(conversation.accounts.firstOrNull(), 44.dp)
      if (conversation.unread) {
        val label = stringResource(R.string.unread)
        Box(
          Modifier.align(Alignment.TopEnd).size(10.dp).clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .semantics { contentDescription = label },
        )
      }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
          conversation.accounts.joinToString(", ") { it.name }, style = MaterialTheme.typography.titleSmall,
          fontWeight = if (conversation.unread) FontWeight.Bold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        conversation.lastStatus?.let { Text(relative(it.created), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
      conversation.lastStatus?.let {
        Text(RichText.plain(it.content), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}

@Composable
fun SearchScreen(nav: Nav) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var query by rememberSaveable { mutableStateOf("") }
  var results by remember { mutableStateOf<SearchResults?>(null) }
  var searching by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }

  fun search() {
    val text = query.trim()
    val client = model.client ?: return
    if (text.isEmpty()) return
    searching = true
    scope.launch {
      try {
        results = client.search(text)
        error = null
      } catch (e: Exception) {
        results = null
        error = context.messageOf(e)
      } finally {
        searching = false
      }
    }
  }

  Screen(stringResource(R.string.tab_search), nav, back = false) { modifier ->
    LazyColumn(modifier.fillMaxSize()) {
      item {
        OutlinedTextField(
          value = query,
          onValueChange = { query = it; if (it.isEmpty()) results = null },
          placeholder = { Text(stringResource(R.string.search_prompt)) },
          singleLine = true,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
          keyboardActions = KeyboardActions(onSearch = { search() }),
          modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        )
      }
      val found = results
      when {
        found != null -> {
          if (found.accounts.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.people)) }
            items(found.accounts, key = { "p" + it.id }) { AccountRow(it, onClick = { nav.account(it) }) }
          }
          if (found.hashtags.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.hashtags)) }
            items(found.hashtags, key = { "t" + it.name }) { tag ->
              TextButton(onClick = { nav.tag(tag.name) }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("#${tag.name}") }
            }
          }
          if (found.statuses.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.posts)) }
            items(found.statuses, key = { "s" + it.id }) { StatusRow(it, nav); HorizontalDivider() }
          }
          if (found.accounts.isEmpty() && found.hashtags.isEmpty() && found.statuses.isEmpty()) {
            item { Hint(stringResource(R.string.no_results)) }
          }
        }
        searching -> item { ListFooter(true, null, false, "") {} }
        error != null -> item { Hint(error!!) }
        else -> item { Hint(stringResource(R.string.search_hint)) }
      }
    }
  }
}

@Composable
fun SectionTitle(text: String) {
  Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp))
}

@Composable
fun Hint(text: String) {
  Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
}
