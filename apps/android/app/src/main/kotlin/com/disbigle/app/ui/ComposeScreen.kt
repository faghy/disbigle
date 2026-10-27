package com.disbigle.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.RemoveCircleOutline
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.disbigle.app.ComposeTarget
import com.disbigle.app.R
import com.disbigle.kit.AspectList
import com.disbigle.kit.Client
import com.disbigle.kit.MediaAttachment
import com.disbigle.kit.PostDraft
import com.disbigle.kit.RichText
import com.disbigle.kit.Visibility
import com.disbigle.kit.aspects
import com.disbigle.kit.describeMedia
import com.disbigle.kit.edit
import com.disbigle.kit.publish
import com.disbigle.kit.source
import com.disbigle.kit.upload
import java.io.ByteArrayOutputStream
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** An attachment being uploaded, or uploaded. */
private class Attachment(val key: Long = System.nanoTime(), val preview: Bitmap? = null) {
  var uploaded by mutableStateOf<MediaAttachment?>(null)
  var description by mutableStateOf("")
  var failed by mutableStateOf<String?>(null)
}

private class PollState(options: List<String>, expiresIn: Int, multiple: Boolean) {
  val options = mutableStateListOf(*options.toTypedArray())
  var expiresIn by mutableStateOf(expiresIn)
  var multiple by mutableStateOf(multiple)
}

/** Writing a post, a reply or a direct message, or editing one of your posts. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeScreen(target: ComposeTarget, onClose: () -> Unit) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val client = model.client
  val editing = (target as? ComposeTarget.Edit)?.status
  val replyTo = (target as? ComposeTarget.Reply)?.status
  val maxCharacters = model.instance?.maxCharacters ?: 5000
  val maxMedia = model.instance?.maxMediaAttachments ?: 4

  var text by remember { mutableStateOf("") }
  var visibility by remember { mutableStateOf(Visibility.PUBLIC) }
  var aspectIds by remember { mutableStateOf(setOf<String>()) }
  var aspects by remember { mutableStateOf<List<AspectList>>(emptyList()) }
  var warning by remember { mutableStateOf("") }
  var warningOn by remember { mutableStateOf(false) }
  var sensitive by remember { mutableStateOf(false) }
  val media = remember { mutableStateListOf<Attachment>() }
  var poll by remember { mutableStateOf<PollState?>(null) }
  var sending by remember { mutableStateOf(false) }
  var loadingSource by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var confirmDiscard by remember { mutableStateOf(false) }
  // Sent with every attempt, so a retry after a lost answer does not post twice.
  val idempotencyKey = remember { Client.newIdempotencyKey() }
  val focus = remember { FocusRequester() }

  val uploading = media.any { it.uploaded == null && it.failed == null }
  val canSend = (text.isNotBlank() || media.isNotEmpty() || poll != null) && text.length <= maxCharacters &&
    !uploading && !sending && media.none { it.failed != null } && (poll?.options?.all { it.isNotBlank() } ?: true)

  LaunchedEffect(target) {
    client ?: return@LaunchedEffect
    when (target) {
      ComposeTarget.New -> {
        visibility = model.preferences.defaultVisibility
        sensitive = model.preferences.sensitiveMedia
        aspects = runCatching { client.aspects() }.getOrNull() ?: emptyList()
      }
      is ComposeTarget.Reply -> {
        val status = target.status
        // Replies to private posts stay private; mention whoever is in the conversation.
        visibility = status.visibility
        val names = (listOf(status.account.acct) + status.mentions.map { it.acct }).toSet() - (model.me?.acct ?: "")
        text = names.sorted().joinToString("") { "@$it " }
      }
      is ComposeTarget.Edit -> {
        val status = target.status
        loadingSource = true
        text = runCatching { client.source(status.id) }.getOrNull() ?: RichText.plain(status.content)
        loadingSource = false
        warning = status.spoilerText
        warningOn = status.spoilerText.isNotEmpty()
        sensitive = status.sensitive
        visibility = status.visibility
        media.addAll(status.mediaAttachments.map { m -> Attachment().apply { uploaded = m; description = m.description ?: "" } })
        // The API wants the poll with every edit: the time left keeps the closing time where it is.
        status.poll?.let {
          val left = ((it.expires ?: Instant.now()).epochSecond - Instant.now().epochSecond).toInt()
          poll = PollState(it.options.map { o -> o.title }, left.coerceIn(300, 30 * 86_400), it.multiple)
        }
      }
    }
    runCatching { focus.requestFocus() }
  }

  val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, maxMedia))) { uris ->
    for (uri in uris.take(maxMedia - media.size)) {
      scope.launch {
        val image = withContext(Dispatchers.IO) { runCatching { readImage(context, uri) }.getOrNull() }
        val attachment = Attachment(preview = image?.first)
        media.add(attachment)
        if (image == null) {
          attachment.failed = context.getString(R.string.image_unreadable)
          return@launch
        }
        try {
          attachment.uploaded = client!!.upload(image.second, "photo.jpg", "image/jpeg")
        } catch (e: Exception) {
          attachment.failed = context.messageOf(e)
        }
      }
    }
  }

  fun send() {
    if (!canSend || client == null) return
    sending = true
    error = null
    scope.launch {
      try {
        // Alt text first, so the post never goes out without it.
        for (item in media) {
          val uploaded = item.uploaded ?: continue
          if (item.description != (uploaded.description ?: "")) client.describeMedia(uploaded.id, item.description)
        }
        val draft = PostDraft(
          text = text,
          visibility = visibility,
          spoilerText = if (warningOn) warning.trim() else "",
          sensitive = sensitive && media.isNotEmpty(),
          inReplyToId = replyTo?.id,
          mediaIds = media.mapNotNull { it.uploaded?.id },
          poll = poll?.let { PostDraft.PollDraft(it.options.map(String::trim), it.expiresIn, it.multiple) },
          aspectIds = if (visibility == Visibility.DIRECT) emptyList() else aspectIds.toList(),
        )
        val saved = if (editing != null) client.edit(editing.id, draft) else client.publish(draft, idempotencyKey)
        model.saved(saved)
        onClose()
      } catch (e: Exception) {
        error = context.messageOf(e)
      } finally {
        sending = false
      }
    }
  }

  fun close() {
    if (text.isNotBlank() && editing == null && replyTo == null || media.isNotEmpty() && editing == null) confirmDiscard = true else onClose()
  }
  BackHandler { close() }

  Surface(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
      TopAppBar(
        title = {
          Text(stringResource(when (target) {
            ComposeTarget.New -> R.string.new_post
            is ComposeTarget.Reply -> R.string.reply
            is ComposeTarget.Edit -> R.string.edit_post
          }))
        },
        navigationIcon = { IconButton(onClick = { close() }) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) } },
        actions = {
          if (sending) {
            CircularProgressIndicator(Modifier.size(24.dp).padding(end = 4.dp), strokeWidth = 2.dp)
          } else {
            Button(onClick = { send() }, enabled = canSend, modifier = Modifier.padding(end = 8.dp)) {
              Text(stringResource(if (editing == null) R.string.post else R.string.save))
            }
          }
        },
      )
      Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        replyTo?.let {
          Text(
            stringResource(R.string.replying_to, it.account.name) + "\n" + RichText.plain(it.content),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 4, overflow = TextOverflow.Ellipsis,
          )
        }
        if (warningOn) {
          OutlinedTextField(warning, { warning = it }, label = { Text(stringResource(R.string.content_warning)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        OutlinedTextField(
          value = text,
          onValueChange = { text = it },
          enabled = !loadingSource,
          placeholder = { Text(stringResource(if (visibility == Visibility.DIRECT) R.string.direct_placeholder else R.string.compose_placeholder)) },
          supportingText = {
            Text(
              "${maxCharacters - text.length}", modifier = Modifier.fillMaxWidth(),
              textAlign = androidx.compose.ui.text.style.TextAlign.End,
              color = if (text.length > maxCharacters) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
          },
          modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp).focusRequester(focus),
        )
        for (item in media) {
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(72.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
              if (item.preview != null) {
                androidx.compose.foundation.Image(item.preview.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
              } else {
                item.uploaded?.let { AsyncImage(it.previewUrl ?: it.url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
              }
              if (item.uploaded == null && item.failed == null) CircularProgressIndicator(Modifier.size(24.dp))
            }
            Column(Modifier.weight(1f)) {
              item.failed?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
              OutlinedTextField(
                item.description, { item.description = it },
                placeholder = { Text(stringResource(R.string.alt_text_placeholder), style = MaterialTheme.typography.bodySmall) },
                textStyle = MaterialTheme.typography.bodySmall, minLines = 2, maxLines = 4, modifier = Modifier.fillMaxWidth(),
              )
            }
            IconButton(onClick = { media.remove(item) }) { Icon(Icons.Outlined.RemoveCircleOutline, stringResource(R.string.remove)) }
          }
        }
        poll?.let { PollEditor(it, editing?.poll != null) }
        if (editing == null && replyTo == null) {
          AudiencePicker(visibility, { visibility = it }, aspects, aspectIds) { id, on -> aspectIds = if (on) aspectIds + id else aspectIds - id }
        }
        if (media.isNotEmpty()) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.sensitive_media), Modifier.weight(1f))
            Switch(sensitive, { sensitive = it })
          }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
      }
      HorizontalDivider()
      Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(
          onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
          enabled = media.size < maxMedia && poll == null,
        ) { Icon(Icons.Outlined.AddPhotoAlternate, stringResource(R.string.add_photos)) }
        IconToggleButton(checked = poll != null, onCheckedChange = { poll = if (it) PollState(listOf("", ""), 86_400, false) else null }, enabled = media.isEmpty()) {
          Icon(Icons.Outlined.BarChart, stringResource(if (poll == null) R.string.add_poll else R.string.remove_poll))
        }
        IconToggleButton(checked = warningOn, onCheckedChange = { warningOn = it }) {
          Icon(Icons.Outlined.Warning, stringResource(R.string.content_warning))
        }
      }
    }
  }

  if (confirmDiscard) {
    AlertDialog(
      onDismissRequest = { confirmDiscard = false },
      title = { Text(stringResource(R.string.discard_question)) },
      confirmButton = { TextButton(onClick = { confirmDiscard = false; onClose() }) { Text(stringResource(R.string.discard), color = MaterialTheme.colorScheme.error) } },
      dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text(stringResource(R.string.keep_writing)) } },
    )
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PollEditor(poll: PollState, wasPoll: Boolean) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    SectionTitle(stringResource(R.string.poll))
    poll.options.forEachIndexed { index, option ->
      Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
          option, { poll.options[index] = it.take(100) }, singleLine = true,
          placeholder = { Text(stringResource(R.string.option_n, index + 1)) }, modifier = Modifier.weight(1f),
        )
        if (poll.options.size > 2) {
          IconButton(onClick = { poll.options.removeAt(index) }) {
            Icon(Icons.Outlined.RemoveCircleOutline, stringResource(R.string.remove_option_n, index + 1), tint = MaterialTheme.colorScheme.error)
          }
        }
      }
    }
    if (poll.options.size < 6) TextButton(onClick = { poll.options.add("") }) { Text(stringResource(R.string.add_option)) }
    val durations = listOf(300 to R.string.d_5m, 3600 to R.string.d_1h, 21_600 to R.string.d_6h, 86_400 to R.string.d_1d, 259_200 to R.string.d_3d, 604_800 to R.string.d_7d)
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { open = it }) {
      val label = durations.firstOrNull { it.first == poll.expiresIn }?.let { stringResource(it.second) } ?: relative(Instant.now().plusSeconds(poll.expiresIn.toLong()))
      OutlinedTextField(
        label, {}, readOnly = true, label = { Text(stringResource(R.string.ends_in)) },
        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
        modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
      )
      ExposedDropdownMenu(open, { open = false }) {
        for ((seconds, name) in durations) DropdownMenuItem(text = { Text(stringResource(name)) }, onClick = { poll.expiresIn = seconds; open = false })
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.several_answers), Modifier.weight(1f))
      Switch(poll.multiple, { poll.multiple = it })
    }
    if (wasPoll) Text(stringResource(R.string.poll_edit_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AudiencePicker(
  visibility: Visibility,
  onVisibility: (Visibility) -> Unit,
  aspects: List<AspectList>,
  chosen: Set<String>,
  onAspect: (String, Boolean) -> Unit,
) {
  Column {
    SectionTitle(stringResource(R.string.who_can_see))
    var open by remember { mutableStateOf(false) }
    val options = listOf(
      Visibility.PUBLIC to R.string.visibility_public,
      Visibility.UNLISTED to R.string.visibility_unlisted_long,
      Visibility.PRIVATE to R.string.visibility_followers,
      Visibility.DIRECT to R.string.visibility_direct,
    )
    ExposedDropdownMenuBox(open, { if (chosen.isEmpty()) open = it }) {
      OutlinedTextField(
        stringResource(options.first { it.first == visibility }.second), {}, readOnly = true, enabled = chosen.isEmpty(),
        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
        modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
      )
      ExposedDropdownMenu(open, { open = false }) {
        for ((value, name) in options) DropdownMenuItem(text = { Text(stringResource(name)) }, onClick = { onVisibility(value); open = false })
      }
    }
    if (aspects.isNotEmpty() && visibility != Visibility.DIRECT) {
      for (aspect in aspects) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(aspect.id in chosen, { onAspect(aspect.id, it) })
          Text(aspect.title)
        }
      }
      Text(stringResource(R.string.aspects_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** A picked image as a preview and a JPEG (travels everywhere, drops location metadata), at most 2560 px. */
fun readImage(context: Context, uri: Uri): Pair<Bitmap, ByteArray> {
  val source = ImageDecoder.createSource(context.contentResolver, uri)
  val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
    val longest = maxOf(info.size.width, info.size.height)
    if (longest > 2560) {
      val scale = 2560f / longest
      decoder.setTargetSize((info.size.width * scale).toInt(), (info.size.height * scale).toInt())
    }
    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
  }
  val out = ByteArrayOutputStream()
  bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
  return bitmap to out.toByteArray()
}
