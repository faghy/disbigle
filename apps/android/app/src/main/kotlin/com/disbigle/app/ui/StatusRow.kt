package com.disbigle.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.disbigle.app.ComposeTarget
import com.disbigle.app.R
import com.disbigle.kit.MediaAttachment
import com.disbigle.kit.Poll
import com.disbigle.kit.Status
import com.disbigle.kit.StatusAction
import com.disbigle.kit.Visibility
import com.disbigle.kit.act
import com.disbigle.kit.delete
import com.disbigle.kit.status
import com.disbigle.kit.translate
import com.disbigle.kit.vote
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

/** One post in a list: tap to open its thread. */
@Composable
fun StatusRow(
  status: Status,
  nav: Nav,
  onDelete: (String) -> Unit = {},
  /** The post at the top of a thread: larger text, full date, no tap target. */
  focused: Boolean = false,
  modifier: Modifier = Modifier,
) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  // The shown post as changed by actions here (likes, edits), until the list reloads it.
  var updated by remember(status) { mutableStateOf<Status?>(null) }
  val shown = updated ?: status.shown
  val isMine = model.me?.id == shown.account.id
  var revealed by remember { mutableStateOf(false) }
  var confirmDelete by remember { mutableStateOf(false) }
  var actionError by remember { mutableStateOf<String?>(null) }
  val linkColor = MaterialTheme.colorScheme.primary
  // Translation: offered for other people's posts in another language the server can translate.
  val appLocale = LocalConfiguration.current.locales[0]
  val source = shown.baseLanguage
  val canTranslate = !isMine && source != null && source != appLocale.language &&
    model.instance?.translationEnabled == true && model.translationLanguages?.get(source)?.contains(appLocale.language) == true
  val translation = model.translations[shown.id]?.takeIf { canTranslate && model.showingOriginal[shown.id] != true }
  var translating by remember(shown.id) { mutableStateOf(false) }
  var translateError by remember(shown.id) { mutableStateOf<String?>(null) }

  fun translate() {
    if (model.translations.containsKey(shown.id)) {
      model.showingOriginal.remove(shown.id)
      return
    }
    val client = model.client ?: return
    translating = true
    translateError = null
    scope.launch {
      try {
        model.translations[shown.id] = client.translate(shown.id, appLocale.language)
      } catch (e: Exception) {
        translateError = context.getString(R.string.translation_unavailable)
      } finally {
        translating = false
      }
    }
  }

  fun act(action: StatusAction) {
    val client = model.client ?: return
    scope.launch {
      try {
        // A reshare comes back wrapped in the new reblog: keep the original.
        updated = client.act(action, shown.id).shown
      } catch (e: Exception) {
        actionError = context.messageOf(e)
      }
    }
  }

  Column(
    modifier
      .fillMaxWidth()
      .then(if (focused) Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.05f)) else Modifier.clickable { nav.status(shown) })
      .padding(horizontal = 16.dp, vertical = 10.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    if (status.reblog != null) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(start = 32.dp)) {
        Icon(Icons.Outlined.Repeat, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(R.string.reshared_by, status.account.name), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Box(
        Modifier.clip(RoundedCornerShape(12.dp)).clickable { nav.account(shown.account) }
          .semantics { contentDescription = context.getString(R.string.profile_of, shown.account.name) },
      ) { Avatar(shown.account, 44.dp) }
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(shown.account.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
          Text("@${shown.account.acct}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
          Spacer(Modifier.weight(0.01f))
          VisibilityIcon(shown.visibility)
          Text(relative(shown.created), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        if (shown.spoilerText.isNotEmpty()) {
          Text(translation?.spoilerText?.takeIf { it.isNotEmpty() } ?: shown.spoilerText, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
          OutlinedButton(onClick = { revealed = !revealed }) {
            Text(stringResource(if (revealed) R.string.show_less else R.string.show_more))
          }
        }
        if (shown.spoilerText.isEmpty() || revealed) {
          val content = translation?.content ?: shown.content
          val text = remember(content, linkColor) { richText(content, linkColor) { nav.link(shown, it, context) } }
          if (text.isNotEmpty()) {
            Text(text, style = if (focused) MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Normal) else MaterialTheme.typography.bodyLarge)
          }
        }
        if (canTranslate) {
          TranslationLine(
            translating, translation?.let { languageName(it.detectedSourceLanguage.ifEmpty { source!! }, appLocale) }, translateError,
            onTranslate = { translate() }, onShowOriginal = { model.showingOriginal[shown.id] = true },
          )
        }
        if (shown.mediaAttachments.isNotEmpty()) MediaGrid(shown.mediaAttachments, shown.sensitive)
        shown.poll?.let { poll ->
          PollView(poll) {
            scope.launch { model.client?.let { client -> runCatching { client.status(shown.id) }.getOrNull()?.let { updated = it } } }
          }
        }
        if (focused) {
          val date = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(shown.created.toEpochMilli()))
          val edited = shown.edited?.let { " · " + stringResource(R.string.edited_ago, relative(it)) } ?: ""
          Text(date + edited, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
          ActionButton(Icons.AutoMirrored.Outlined.Reply, shown.repliesCount, false, stringResource(R.string.reply)) {
            model.composing = ComposeTarget.Reply(shown)
          }
          ActionButton(
            Icons.Outlined.Repeat, shown.reblogsCount, shown.reblogged == true, stringResource(R.string.reshare),
            enabled = shown.visibility != Visibility.PRIVATE && shown.visibility != Visibility.DIRECT,
          ) { act(if (shown.reblogged == true) StatusAction.UNREBLOG else StatusAction.REBLOG) }
          ActionButton(
            if (shown.favourited == true) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder, shown.favouritesCount,
            shown.favourited == true, stringResource(R.string.like),
          ) { act(if (shown.favourited == true) StatusAction.UNFAVOURITE else StatusAction.FAVOURITE) }
          ActionButton(
            if (shown.bookmarked == true) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, null,
            shown.bookmarked == true, stringResource(R.string.bookmark),
          ) { act(if (shown.bookmarked == true) StatusAction.UNBOOKMARK else StatusAction.BOOKMARK) }
          MoreMenu(shown, isMine, onEdit = { model.composing = ComposeTarget.Edit(shown) }, onDelete = { confirmDelete = true })
        }
      }
    }
  }

  if (confirmDelete) {
    AlertDialog(
      onDismissRequest = { confirmDelete = false },
      title = { Text(stringResource(R.string.delete_post_question)) },
      confirmButton = {
        TextButton(onClick = {
          confirmDelete = false
          val client = model.client ?: return@TextButton
          scope.launch {
            try {
              client.delete(shown.id)
              onDelete(status.id)
            } catch (e: Exception) {
              actionError = context.messageOf(e)
            }
          }
        }) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
      },
      dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
  actionError?.let { message ->
    AlertDialog(
      onDismissRequest = { actionError = null },
      title = { Text(stringResource(R.string.something_went_wrong)) },
      text = { Text(message) },
      confirmButton = { TextButton(onClick = { actionError = null }) { Text(stringResource(R.string.ok)) } },
    )
  }
}

/** "Translate", "Translating…", or where the translation comes from with the way back to the original. */
@Composable
private fun TranslationLine(translating: Boolean, translatedFrom: String?, error: String?, onTranslate: () -> Unit, onShowOriginal: () -> Unit) {
  val muted = MaterialTheme.colorScheme.onSurfaceVariant
  @Composable
  fun Link(label: String, onClick: () -> Unit) = Text(
    label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
    modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClick = onClick).padding(vertical = 4.dp),
  )

  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    when {
      translating -> Text(stringResource(R.string.translating), style = MaterialTheme.typography.labelLarge, color = muted, modifier = Modifier.padding(vertical = 4.dp))
      translatedFrom != null -> {
        Text(stringResource(R.string.translated_from, translatedFrom), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.weight(1f, fill = false))
        Link(stringResource(R.string.show_original), onShowOriginal)
      }
      else -> Link(stringResource(R.string.translate), onTranslate)
    }
  }
  error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
}

/** A language's name in the app's language ("German" for "de"). */
private fun languageName(code: String, locale: Locale): String =
  Locale.forLanguageTag(code).getDisplayLanguage(locale).ifEmpty { code }

@Composable
private fun MoreMenu(status: Status, isMine: Boolean, onEdit: () -> Unit, onDelete: () -> Unit) {
  val context = LocalContext.current
  var open by remember { mutableStateOf(false) }
  Box {
    IconButton(onClick = { open = true }) {
      Icon(Icons.Filled.MoreHoriz, stringResource(R.string.more_actions), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      status.url?.let { url ->
        DropdownMenuItem(
          text = { Text(stringResource(R.string.share)) },
          leadingIcon = { Icon(Icons.Outlined.Share, null) },
          onClick = {
            open = false
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
            context.startActivity(Intent.createChooser(send, null))
          },
        )
        DropdownMenuItem(
          text = { Text(stringResource(R.string.copy_link)) },
          leadingIcon = { Icon(Icons.Outlined.Link, null) },
          onClick = {
            open = false
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("link", url))
          },
        )
      }
      if (isMine) {
        DropdownMenuItem(text = { Text(stringResource(R.string.edit)) }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { open = false; onEdit() })
        DropdownMenuItem(
          text = { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) },
          leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error) },
          onClick = { open = false; onDelete() },
        )
      }
    }
  }
}

@Composable
fun ActionButton(icon: ImageVector, count: Int?, active: Boolean, label: String, enabled: Boolean = true, onClick: () -> Unit) {
  val color = when {
    !enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f)
    active -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }
  Row(
    Modifier.clip(RoundedCornerShape(8.dp))
      .clickable(enabled = enabled, onClick = onClick)
      .semantics { contentDescription = label; selected = active }
      .padding(horizontal = 8.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Icon(icon, null, Modifier.size(20.dp), tint = color)
    if (count != null && count > 0) Text(compact(count), style = MaterialTheme.typography.labelMedium, color = color)
  }
}

@Composable
fun VisibilityIcon(visibility: Visibility) {
  val (icon, label) = when (visibility) {
    Visibility.PUBLIC -> return
    Visibility.UNLISTED -> Icons.Outlined.LockOpen to R.string.visibility_unlisted
    Visibility.PRIVATE -> Icons.Outlined.Lock to R.string.visibility_private_icon
    Visibility.DIRECT -> Icons.Outlined.AlternateEmail to R.string.visibility_direct_icon
  }
  Icon(icon, stringResource(label), Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Up to four attachments; sensitive ones stay hidden until tapped. */
@Composable
fun MediaGrid(media: List<MediaAttachment>, sensitive: Boolean) {
  var revealed by remember { mutableStateOf(false) }
  var viewing by remember { mutableStateOf<Int?>(null) }
  val hidden = sensitive && !revealed
  val shape = RoundedCornerShape(10.dp)

  @Composable
  fun Tile(index: Int, modifier: Modifier) {
    val item = media[index]
    Box(
      modifier.clip(shape).background(MaterialTheme.colorScheme.surfaceVariant)
        .clickable { if (hidden) revealed = true else viewing = index }
        .semantics { contentDescription = item.description?.takeIf { it.isNotEmpty() } ?: "" },
      contentAlignment = Alignment.Center,
    ) {
      AsyncImage(
        model = item.previewUrl ?: item.url, contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize().then(if (hidden) Modifier.blur(30.dp) else Modifier),
      )
      if (hidden) {
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f)) {
          Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.VisibilityOff, null, Modifier.size(16.dp))
            Text(stringResource(R.string.sensitive_content), style = MaterialTheme.typography.labelMedium)
          }
        }
      } else if (item.isVideo) {
        Icon(Icons.Filled.PlayCircle, null, Modifier.size(48.dp), tint = Color.White)
      }
    }
  }

  if (media.size == 1) {
    // A box of known height: tall pictures are cropped to it, never drawn past it over the actions.
    BoxWithConstraints(Modifier.fillMaxWidth()) {
      val ratio = media[0].aspectRatio ?: 1.5f
      Tile(0, Modifier.fillMaxWidth().height((maxWidth / ratio).coerceIn(120.dp, 360.dp)))
    }
  } else {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      for (row in media.indices.chunked(2)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          for (index in row) Tile(index, Modifier.weight(1f).aspectRatio(1f))
          if (row.size == 1) Spacer(Modifier.weight(1f))
        }
      }
    }
  }
  viewing?.let { start -> MediaViewer(media, start, onClose = { viewing = null }) }
}

/** Pictures full screen, swiping between them; `actions` draws a bar at the bottom for the page shown. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaViewer(media: List<MediaAttachment>, start: Int, onClose: () -> Unit, actions: (@Composable (page: Int) -> Unit)? = null) {
  val context = LocalContext.current
  Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
      val pager = rememberPagerState(initialPage = start) { media.size }
      HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
        val item = media[page]
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          if (item.isVideo && item.type != "gifv") {
            Button(onClick = { openInBrowser(context, item.url) }) { Text(stringResource(R.string.open)) }
          } else {
            AsyncImage(model = item.url, contentDescription = item.description, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
          }
        }
      }
      CompositionLocalProvider(LocalContentColor provides Color.White) {
        IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopStart).padding(top = 32.dp, start = 8.dp)) {
          Icon(Icons.Filled.Close, stringResource(R.string.close))
        }
        if (actions != null) {
          Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.6f))
              .padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
          ) { actions(pager.currentPage) }
        }
      }
    }
  }
}

/** Results, or the options to vote for. */
@Composable
fun PollView(poll: Poll, onVote: (Poll) -> Unit) {
  val model = LocalApp.current
  val scope = rememberCoroutineScope()
  var choices by remember(poll.id) { mutableStateOf(setOf<Int>()) }
  var sending by remember { mutableStateOf(false) }
  val canVote = !poll.expired && poll.voted != true
  val shape = RoundedCornerShape(8.dp)

  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    poll.options.forEachIndexed { index, option ->
      if (canVote) {
        val chosen = index in choices
        Row(
          Modifier.fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable { choices = if (poll.multiple) (if (chosen) choices - index else choices + index) else setOf(index) }
            .padding(10.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          val icon = when {
            poll.multiple && chosen -> Icons.Filled.CheckBox
            poll.multiple -> Icons.Outlined.CheckBoxOutlineBlank
            chosen -> Icons.Filled.RadioButtonChecked
            else -> Icons.Outlined.RadioButtonUnchecked
          }
          Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
          Text(option.title)
        }
      } else {
        val share = poll.share(option)
        val own = poll.ownVotes?.contains(index) == true
        Box(Modifier.fillMaxWidth().clip(shape).heightIn(min = 36.dp)) {
          Box(
            Modifier.matchParentSize().fillMaxWidth(share.coerceAtLeast(0.02f))
              .background(MaterialTheme.colorScheme.primary.copy(alpha = if (own) 0.3f else 0.13f)),
          )
          Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(option.title, fontWeight = if (own) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.weight(1f))
            if (own) Icon(Icons.Filled.Check, stringResource(R.string.your_vote), Modifier.size(16.dp).padding(end = 4.dp))
            Text("${(share * 100).toInt()}%")
          }
        }
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      if (canVote) {
        Button(
          enabled = choices.isNotEmpty() && !sending,
          onClick = {
            val client = model.client ?: return@Button
            sending = true
            scope.launch {
              runCatching { client.vote(poll.id, choices.sorted()) }.getOrNull()?.let(onVote)
              sending = false
            }
          },
        ) { Text(stringResource(R.string.vote)) }
      }
      val people = poll.votersCount ?: poll.votesCount
      val end = poll.expires
      val ends = when {
        end == null -> ""
        poll.expired -> " · " + stringResource(R.string.poll_closed)
        else -> " · " + stringResource(R.string.poll_ends, relative(end).replaceFirstChar { it.lowercase() })
      }
      Text(pluralStringResource(R.plurals.people, people, people) + ends, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
fun Loading() {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { androidx.compose.material3.CircularProgressIndicator() }
}

@Composable
fun AccountRow(account: com.disbigle.kit.Account, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) {
  Row(
    Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Avatar(account, 40.dp)
    Column(Modifier.weight(1f)) {
      Text(account.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text("@${account.acct}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    trailing()
  }
}
