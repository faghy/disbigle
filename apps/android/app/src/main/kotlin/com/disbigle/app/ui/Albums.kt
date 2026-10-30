package com.disbigle.app.ui

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.LibraryAdd
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.disbigle.app.R
import com.disbigle.kit.Album
import com.disbigle.kit.GalleryItem
import com.disbigle.kit.addToAlbum
import com.disbigle.kit.album
import com.disbigle.kit.albums
import com.disbigle.kit.createAlbum
import com.disbigle.kit.deleteAlbum
import com.disbigle.kit.removeFromAlbum
import com.disbigle.kit.updateAlbum
import kotlinx.coroutines.launch

/** Square thumbnails three to a row, as items of a list; `onReachEnd` asks for more near the end. */
fun LazyListScope.galleryRows(items: List<GalleryItem>, key: String, onOpen: (Int) -> Unit, onReachEnd: () -> Unit = {}) {
  val rows = items.indices.chunked(3)
  itemsIndexed(rows, key = { index, _ -> "$key:$index" }) { rowIndex, row ->
    LaunchedEffect(rowIndex) { if (rowIndex >= rows.size - 3) onReachEnd() }
    Row(Modifier.fillMaxWidth().padding(start = 2.dp, end = 2.dp, bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
      for (index in row) GalleryThumbnail(items[index], Modifier.weight(1f)) { onOpen(index) }
      repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
    }
  }
}

/** A square thumbnail; a sensitive one stays hidden behind an icon until tapped. */
@Composable
fun GalleryThumbnail(item: GalleryItem, modifier: Modifier, onClick: () -> Unit) {
  val media = item.mediaAttachment
  var revealed by remember(media.id) { mutableStateOf(false) }
  val hidden = item.sensitive && !revealed
  Box(
    modifier.aspectRatio(1f).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
      .clickable { if (hidden) revealed = true else onClick() }
      .semantics { contentDescription = media.description?.takeIf { it.isNotEmpty() } ?: "" },
    contentAlignment = Alignment.Center,
  ) {
    // Blur needs Android 12: before it a hidden picture is not loaded at all.
    if (!hidden || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      AsyncImage(
        model = media.thumbnailUrl, contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize().then(if (hidden) Modifier.blur(24.dp) else Modifier),
      )
    }
    if (hidden) {
      Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f)) {
        Icon(Icons.Outlined.VisibilityOff, stringResource(R.string.sensitive_content), Modifier.padding(8.dp).size(20.dp))
      }
    } else if (media.isVideo) {
      Icon(Icons.Filled.PlayCircle, null, Modifier.size(32.dp), tint = Color.White)
    }
  }
}

/** The viewer of a gallery: the post each picture comes from and, for your own, the albums. */
@Composable
fun GalleryViewer(items: List<GalleryItem>, start: Int, nav: Nav, canAddToAlbum: Boolean, onClose: () -> Unit, onAlbumsChanged: () -> Unit = {}) {
  var adding by remember { mutableStateOf<GalleryItem?>(null) }
  val colors = ButtonDefaults.textButtonColors(contentColor = Color.White)
  MediaViewer(items.map { it.mediaAttachment }, start.coerceIn(0, maxOf(0, items.size - 1)), onClose) { page ->
    val item = items.getOrNull(page) ?: return@MediaViewer
    TextButton(onClick = { onClose(); nav.statusId(item.statusId) }, colors = colors) {
      Icon(Icons.AutoMirrored.Outlined.Article, null, Modifier.padding(end = 6.dp).size(18.dp))
      Text(stringResource(R.string.open_post))
    }
    if (canAddToAlbum) {
      TextButton(onClick = { adding = item }, colors = colors) {
        Icon(Icons.Outlined.LibraryAdd, null, Modifier.padding(end = 6.dp).size(18.dp))
        Text(stringResource(R.string.add_to_album))
      }
    }
  }
  adding?.let { AddToAlbumSheet(it.mediaAttachment.id, onDismiss = { adding = null }, onChanged = onAlbumsChanged) }
}

/** Your albums with a tick on those holding the picture: ticking adds it, unticking removes it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddToAlbumSheet(mediaId: String, onDismiss: () -> Unit, onChanged: () -> Unit) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val client = model.client
  val me = model.me
  var albums by remember(mediaId) { mutableStateOf<List<Album>?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(setOf<String>()) }
  var creating by remember { mutableStateOf(false) }

  LaunchedEffect(mediaId) {
    if (client == null || me == null) return@LaunchedEffect
    try {
      albums = client.albums(me.id, mediaId)
    } catch (e: Exception) {
      error = context.messageOf(e)
    }
  }

  fun set(album: Album, include: Boolean) {
    client ?: return
    busy = busy + album.id
    error = null
    scope.launch {
      try {
        if (include) client.addToAlbum(album.id, mediaId) else client.removeFromAlbum(album.id, mediaId)
        albums = albums?.map { if (it.id == album.id) it.copy(includes = include) else it }
        onChanged()
      } catch (e: Exception) {
        error = context.messageOf(e)
      } finally {
        busy = busy - album.id
      }
    }
  }

  ModalBottomSheet(onDismissRequest = onDismiss) {
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
      Text(stringResource(R.string.add_to_album), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
      val list = albums
      if (list == null && error == null) {
        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(28.dp)) }
      }
      for (album in list.orEmpty()) {
        val inside = album.includes == true
        Row(
          Modifier.fillMaxWidth().clickable(enabled = album.id !in busy, role = Role.Checkbox) { set(album, !inside) }
            .padding(horizontal = 8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Checkbox(inside, null, enabled = album.id !in busy)
          Text(album.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
      }
      if (list?.isEmpty() == true) Hint(stringResource(R.string.no_albums))
      error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
      HorizontalDivider(Modifier.padding(vertical = 4.dp))
      TextButton(onClick = { creating = true }, modifier = Modifier.padding(horizontal = 8.dp)) {
        Icon(Icons.Outlined.Add, null, Modifier.padding(end = 6.dp).size(18.dp))
        Text(stringResource(R.string.new_album))
      }
    }
  }
  if (creating && client != null) {
    AlbumDialog(null, onDismiss = { creating = false }) { name, description ->
      val album = client.createAlbum(name, description)
      client.addToAlbum(album.id, mediaId)
      albums = listOf(album.copy(includes = true)) + albums.orEmpty()
      onChanged()
    }
  }
}

/** Name and description of a new album (`album` null) or of one to edit. */
@Composable
fun AlbumDialog(album: Album?, onDismiss: () -> Unit, onSave: suspend (name: String, description: String) -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var name by remember { mutableStateOf(album?.name ?: "") }
  var description by remember { mutableStateOf(album?.description ?: "") }
  var saving by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }

  AlertDialog(
    onDismissRequest = { if (!saving) onDismiss() },
    title = { Text(stringResource(if (album == null) R.string.new_album else R.string.edit_album)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
          name, { name = it.take(Album.MAX_NAME) }, label = { Text(stringResource(R.string.album_name)) }, singleLine = true,
          supportingText = { Text("${name.length}/${Album.MAX_NAME}") }, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
          description, { description = it.take(Album.MAX_DESCRIPTION) }, label = { Text(stringResource(R.string.album_description)) },
          minLines = 2, maxLines = 5, supportingText = { Text("${description.length}/${Album.MAX_DESCRIPTION}") }, modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
      }
    },
    confirmButton = {
      TextButton(enabled = name.isNotBlank() && !saving, onClick = {
        saving = true
        error = null
        scope.launch {
          try {
            onSave(name.trim(), description.trim())
            onDismiss()
          } catch (e: Exception) {
            error = context.messageOf(e)
          } finally {
            saving = false
          }
        }
      }) { Text(stringResource(if (album == null) R.string.create else R.string.save)) }
    },
    dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text(stringResource(R.string.cancel)) } },
  )
}

/** Albums two to a row, as items of a list. */
fun LazyListScope.albumRows(albums: List<Album>, onOpen: (Album) -> Unit) {
  itemsIndexed(albums.chunked(2), key = { _, row -> "albums:" + row.joinToString { it.id } }) { _, row ->
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      for (album in row) AlbumCard(album, Modifier.weight(1f)) { onOpen(album) }
      if (row.size == 1) Spacer(Modifier.weight(1f))
    }
  }
}

/** Cover, name and how many pictures. */
@Composable
fun AlbumCard(album: Album, modifier: Modifier, onClick: () -> Unit) {
  val shape = RoundedCornerShape(10.dp)
  Column(modifier.clip(shape).clickable(onClick = onClick)) {
    Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
      val cover = album.cover
      if (cover != null) {
        AsyncImage(model = cover.thumbnailUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
      } else {
        Icon(Icons.Outlined.PhotoLibrary, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Text(album.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    Text(
      pluralStringResource(R.plurals.album_items, album.mediaCount, album.mediaCount),
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

/** An album's pictures; its owner can rename or delete it. */
@Composable
fun AlbumScreen(nav: Nav, id: String) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val client = model.client
  var album by remember(id) { mutableStateOf<Album?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  var viewing by remember { mutableStateOf<Int?>(null) }
  var editing by remember { mutableStateOf(false) }
  var confirmDelete by remember { mutableStateOf(false) }
  var actionError by remember { mutableStateOf<String?>(null) }

  suspend fun load() {
    client ?: return
    try {
      album = client.album(id)
      error = null
    } catch (e: Exception) {
      error = context.messageOf(e)
    }
  }

  LaunchedEffect(id) { load() }

  val shown = album
  val isOwner = shown != null && shown.accountId == model.me?.id
  Screen(
    shown?.name ?: "", nav,
    actions = {
      if (isOwner) {
        IconButton(onClick = { editing = true }) { Icon(Icons.Outlined.Edit, stringResource(R.string.edit_album)) }
        IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Outlined.Delete, stringResource(R.string.delete_album)) }
      }
    },
  ) { modifier ->
    if (shown == null) {
      if (error != null) Hint(error!!) else Loading()
      return@Screen
    }
    LazyColumn(modifier.fillMaxSize()) {
      item {
        shown.account?.let { owner -> AccountRow(owner, onClick = { nav.account(owner) }) }
        if (shown.description.isNotEmpty()) {
          Text(shown.description, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        Text(
          pluralStringResource(R.plurals.album_items, shown.mediaCount, shown.mediaCount),
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp),
        )
      }
      galleryRows(shown.items, "album", onOpen = { viewing = it })
      if (shown.items.isEmpty()) {
        item { ListFooter(false, null, true, stringResource(R.string.album_empty)) {} }
      }
      item { Spacer(Modifier.height(24.dp)) }
    }
  }

  val items = shown?.items.orEmpty()
  viewing?.let { start ->
    if (items.isEmpty()) {
      LaunchedEffect(Unit) { viewing = null }
    } else {
      GalleryViewer(items, start, nav, canAddToAlbum = isOwner, onClose = { viewing = null }, onAlbumsChanged = { scope.launch { load() } })
    }
  }
  if (editing && shown != null && client != null) {
    AlbumDialog(shown, onDismiss = { editing = false }) { name, description ->
      val updated = client.updateAlbum(id, name, description)
      album = album?.copy(name = updated.name, description = updated.description)
    }
  }
  if (confirmDelete && shown != null) {
    AlertDialog(
      onDismissRequest = { confirmDelete = false },
      title = { Text(stringResource(R.string.delete_album_question, shown.name)) },
      text = { Text(stringResource(R.string.delete_album_note)) },
      confirmButton = {
        TextButton(onClick = {
          confirmDelete = false
          client ?: return@TextButton
          scope.launch {
            try {
              client.deleteAlbum(id)
              nav.back()
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
