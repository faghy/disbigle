package com.disbigle.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.disbigle.app.R
import com.disbigle.kit.ChatPage
import com.disbigle.kit.PostDraft
import com.disbigle.kit.Status
import com.disbigle.kit.Visibility
import com.disbigle.kit.chat
import com.disbigle.kit.markConversationRead
import com.disbigle.kit.publish
import com.disbigle.kit.withoutLeadingMentions
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** How often an open chat asks for new messages (the apps have no live stream). */
private const val POLL_MS = 8_000L

fun presenceColor(state: String): Color = when (state) {
  "online" -> Color(0xFF10B981)
  "busy" -> Color(0xFFEF4444)
  else -> Color(0xFFFBBF24)
}

@Composable
fun presenceLabel(state: String): String = stringResource(
  when (state) {
    "online" -> R.string.presence_online
    "busy" -> R.string.presence_busy
    else -> R.string.presence_away
  },
)

/** A private conversation as a chat: bubbles, newest at the bottom, refreshed every few seconds. */
@Composable
fun ChatScreen(nav: Nav, id: String) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val client = model.client
  var page by remember(id) { mutableStateOf<ChatPage?>(null) }
  // Older pages loaded with "Older messages", newest first like the API.
  var older by remember(id) { mutableStateOf<List<Status>>(emptyList()) }
  var hasOlder by remember(id) { mutableStateOf(false) }
  var error by remember(id) { mutableStateOf<String?>(null) }
  var text by remember(id) { mutableStateOf("") }
  var sending by remember { mutableStateOf(false) }
  val listState = rememberLazyListState()

  suspend fun refresh() {
    val c = client ?: return
    try {
      val fresh = c.chat(id)
      val newest = fresh.messages.firstOrNull()?.id
      val known = page?.messages?.firstOrNull()?.id
      if (page == null) hasOlder = fresh.messages.size >= 30
      page = fresh
      error = null
      if (newest != null && newest != known) runCatching { c.markConversationRead(id) }
    } catch (e: Exception) {
      if (page == null) error = context.messageOf(e)
    }
  }

  LaunchedEffect(id, client) {
    while (true) {
      refresh()
      delay(POLL_MS)
    }
  }

  val current = page
  val people = current?.accounts.orEmpty()
  val names = people.joinToString(", ") { it.name }.ifEmpty { stringResource(R.string.only_you) }
  // Newest first, as LazyColumn(reverseLayout) shows the first item at the bottom.
  val messages = (current?.messages.orEmpty() + older).distinctBy { it.id }
  val myId = model.me?.id
  val myLast = messages.firstOrNull { it.account.id == myId }
  val seenBy = if (myLast == null) emptyList() else
    current?.seen.orEmpty().filter { it.lastReadId >= myLast.id }.mapNotNull { s -> people.firstOrNull { it.id == s.accountId } }

  fun send() {
    val c = client ?: return
    val body = text.trim()
    if (body.isEmpty() || sending) return
    sending = true
    scope.launch {
      try {
        // Every message names the participants: they are its recipients.
        val to = people.joinToString(" ") { "@${it.acct}" }
        c.publish(
          PostDraft(
            text = if (to.isEmpty()) body else "$to $body",
            visibility = Visibility.DIRECT,
            inReplyToId = messages.firstOrNull()?.id,
          ),
          UUID.randomUUID().toString(),
        )
        text = ""
        refresh()
        listState.animateScrollToItem(0)
      } catch (e: Exception) {
        error = context.messageOf(e)
      } finally {
        sending = false
      }
    }
  }

  Screen(
    names, nav,
    titleContent = {
      Column {
        Text(names, maxLines = 1, style = MaterialTheme.typography.titleMedium)
        val states = people.mapNotNull { p -> current?.presence?.get(p.id)?.let { p to it } }
        if (states.isNotEmpty()) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val (person, state) = states.first()
            Box(Modifier.size(8.dp).clip(CircleShape).background(presenceColor(state)))
            Text(
              (if (people.size > 1) "${person.name}: " else "") + presenceLabel(state),
              style = MaterialTheme.typography.labelMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
    },
  ) { modifier ->
    Column(modifier.fillMaxSize().imePadding()) {
      if (current == null) {
        if (error != null) {
          ListFooter(false, error, false, "") { scope.launch { refresh() } }
        } else {
          Loading()
        }
        return@Column
      }
      LazyColumn(
        Modifier.weight(1f).fillMaxWidth(),
        state = listState,
        reverseLayout = true,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
      ) {
        if (seenBy.isNotEmpty()) {
          item(key = "seen") {
            Text(
              if (people.size == 1) stringResource(R.string.seen) else stringResource(R.string.seen_by, seenBy.joinToString(", ") { it.name }),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.fillMaxWidth().padding(end = 4.dp),
              textAlign = androidx.compose.ui.text.style.TextAlign.End,
            )
          }
        }
        items(messages.size, key = { messages[it].id }) { index ->
          val message = messages[index]
          // The message above (older) by someone else: show the author's name in groups.
          val above = messages.getOrNull(index + 1)
          Bubble(
            message, nav,
            mine = message.account.id == myId,
            showAuthor = people.size > 1 && above?.account?.id != message.account.id,
          )
        }
        if (hasOlder) {
          item(key = "older") {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
              TextButton(onClick = {
                val c = client ?: return@TextButton
                val oldest = messages.lastOrNull()?.id ?: return@TextButton
                scope.launch {
                  runCatching { c.chat(id, oldest) }.onSuccess {
                    older = older + it.messages
                    hasOlder = it.messages.size >= 30
                  }
                }
              }) { Text(stringResource(R.string.older_messages)) }
            }
          }
        }
      }
      error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 12.dp)) }
      Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
          value = text,
          onValueChange = { text = it },
          placeholder = { Text(stringResource(R.string.write_message)) },
          modifier = Modifier.weight(1f),
          maxLines = 5,
          shape = RoundedCornerShape(20.dp),
        )
        IconButton(onClick = ::send, enabled = text.isNotBlank() && !sending) {
          Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.send))
        }
      }
    }
  }
}

@Composable
private fun Bubble(status: Status, nav: Nav, mine: Boolean, showAuthor: Boolean) {
  val context = LocalContext.current
  val bubbleColor = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
  val textColor = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
  val html = remember(status.content) { withoutLeadingMentions(status.content) }
  val text = remember(html, textColor) { richText(html, textColor) { nav.link(status, it, context) } }
  Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
    if (showAuthor && !mine) {
      Text(
        status.account.name, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 2.dp),
      )
    }
    Column(
      Modifier
        .widthIn(max = 300.dp)
        .clip(RoundedCornerShape(18.dp, 18.dp, if (mine) 4.dp else 18.dp, if (mine) 18.dp else 4.dp))
        .background(bubbleColor)
        .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
      if (status.spoilerText.isNotEmpty()) Text(status.spoilerText, color = textColor, fontWeight = FontWeight.SemiBold)
      if (text.isNotEmpty()) Text(text, color = textColor, style = MaterialTheme.typography.bodyLarge)
      if (status.mediaAttachments.isNotEmpty()) MediaGrid(status.mediaAttachments, status.sensitive)
    }
    Text(
      relative(status.created), style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp).clickable { nav.status(status) },
    )
  }
}
