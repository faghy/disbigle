package com.disbigle.app.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.disbigle.app.R
import com.disbigle.kit.Account
import com.disbigle.kit.AccountAction
import com.disbigle.kit.AspectList
import com.disbigle.kit.Relationship
import com.disbigle.kit.Status
import com.disbigle.kit.account
import com.disbigle.kit.act
import com.disbigle.kit.addMember
import com.disbigle.kit.aspects
import com.disbigle.kit.aspectsContaining
import com.disbigle.kit.follow
import com.disbigle.kit.relationship
import com.disbigle.kit.removeMember
import com.disbigle.kit.statuses
import com.disbigle.kit.unfollow
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(nav: Nav, id: String, isMe: Boolean) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val store: ListStore = viewModel()
  val client = model.client
  var account by remember(id) { mutableStateOf(if (isMe) model.me else model.accounts[id]) }
  var error by remember { mutableStateOf<String?>(null) }
  var relationship by remember { mutableStateOf<Relationship?>(null) }
  var aspects by remember { mutableStateOf<List<AspectList>>(emptyList()) }
  var memberOf by remember { mutableStateOf<Set<String>>(emptySet()) }
  var menu by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  val list = store.list<Status>("profile:$id", { it.id }) { q -> client!!.statuses(id, q) }

  LaunchedEffect(id, isMe) {
    client ?: return@LaunchedEffect
    if (isMe) account = model.me
    if (account == null) {
      try {
        account = client.account(id).also { model.accounts[id] = it }
      } catch (e: Exception) {
        error = context.messageOf(e)
      }
    }
    if (!list.loaded) list.refresh()
    if (!isMe) {
      relationship = runCatching { client.relationship(id) }.getOrNull()
      aspects = runCatching { client.aspects() }.getOrNull() ?: emptyList()
      memberOf = runCatching { client.aspectsContaining(id) }.getOrNull()?.map { it.id }?.toSet() ?: emptySet()
    }
  }

  fun act(action: AccountAction) {
    scope.launch { runCatching { client?.act(action, id) }.getOrNull()?.let { relationship = it } }
  }

  fun toggle(aspect: AspectList) {
    val inside = aspect.id in memberOf
    scope.launch {
      runCatching {
        if (inside) client?.removeMember(id, aspect.id) else client?.addMember(id, aspect.id)
      }.onSuccess { memberOf = if (inside) memberOf - aspect.id else memberOf + aspect.id }
    }
  }

  val shown = account
  Screen(
    shown?.name ?: "", nav, back = !isMe,
    actions = {
      if (isMe) {
        IconButton(onClick = { nav.settings() }) { Icon(Icons.Outlined.Settings, stringResource(R.string.settings)) }
      } else if (relationship != null && shown != null) {
        Box {
          IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more_actions)) }
          DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            if (aspects.isNotEmpty()) {
              Text(stringResource(R.string.aspects), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
              for (aspect in aspects) {
                DropdownMenuItem(
                  text = { Text(aspect.title) },
                  leadingIcon = { if (aspect.id in memberOf) Icon(Icons.Filled.Check, null) else Spacer(Modifier) },
                  onClick = { toggle(aspect) },
                )
              }
              HorizontalDivider()
            }
            DropdownMenuItem(
              text = { Text(stringResource(R.string.share)) },
              leadingIcon = { Icon(Icons.Outlined.Share, null) },
              onClick = {
                menu = false
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, shown.url), null))
              },
            )
            val muting = relationship?.muting == true
            DropdownMenuItem(
              text = { Text(stringResource(if (muting) R.string.unmute else R.string.mute)) },
              leadingIcon = { Icon(if (muting) Icons.Outlined.VolumeUp else Icons.Outlined.VolumeOff, null) },
              onClick = { menu = false; act(if (muting) AccountAction.UNMUTE else AccountAction.MUTE) },
            )
            val blocking = relationship?.blocking == true
            DropdownMenuItem(
              text = { Text(stringResource(if (blocking) R.string.unblock else R.string.block), color = if (blocking) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error) },
              leadingIcon = { Icon(Icons.Outlined.Block, null) },
              onClick = { menu = false; act(if (blocking) AccountAction.UNBLOCK else AccountAction.BLOCK) },
            )
          }
        }
      }
    },
  ) { modifier ->
    if (shown == null) {
      if (error != null) Hint(error!!) else Loading()
      return@Screen
    }
    PullToRefreshBox(isRefreshing = list.loading && list.items.isNotEmpty(), onRefresh = { list.refresh() }, modifier = modifier.fillMaxSize()) {
      LazyColumn(Modifier.fillMaxSize()) {
        item {
          ProfileHeader(shown, relationship.takeIf { !isMe }, busy) {
            val current = relationship ?: return@ProfileHeader
            busy = true
            scope.launch {
              runCatching { if (current.following || current.requested) client!!.unfollow(id) else client!!.follow(id) }
                .getOrNull()?.let { relationship = it }
              busy = false
            }
          }
          HorizontalDivider()
        }
        itemsIndexed(list.items, key = { _, s -> s.id }) { index, status ->
          LaunchedEffect(index) { list.reached(index) }
          StatusRow(status, nav, onDelete = { list.remove(it) })
          HorizontalDivider()
        }
        item {
          ListFooter(list.loading && list.items.isEmpty(), list.error, list.loaded && list.items.isEmpty(), stringResource(R.string.no_posts)) { list.refresh() }
        }
      }
    }
  }
}

@Composable
private fun ProfileHeader(account: Account, relationship: Relationship?, busy: Boolean, onFollow: () -> Unit) {
  val context = LocalContext.current
  val linkColor = MaterialTheme.colorScheme.primary
  Column {
    Box(Modifier.fillMaxWidth().height(176.dp)) {
      val brand = MaterialTheme.colorScheme.primary
      val headerModifier = Modifier.fillMaxWidth().height(130.dp)
      if (account.headerUrl != null) {
        AsyncImage(model = account.headerUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = headerModifier.background(brand.copy(alpha = 0.2f)))
      } else {
        Box(headerModifier.background(Brush.horizontalGradient(listOf(brand, brand.copy(alpha = 0.6f)))))
      }
      Box(
        Modifier.offset(x = 16.dp, y = 92.dp).clip(RoundedCornerShape(22.dp))
          .border(4.dp, MaterialTheme.colorScheme.surface, RoundedCornerShape(22.dp)),
      ) { Avatar(account, 76.dp) }
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Row(verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
          Text(account.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
          Text("@${account.acct}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        relationship?.let {
          val label = stringResource(
            when {
              it.following -> R.string.following_button
              it.requested -> R.string.requested
              else -> R.string.follow
            },
          )
          if (it.following || it.requested) {
            OutlinedButton(onClick = onFollow, enabled = !busy) { Text(label) }
          } else {
            Button(onClick = onFollow, enabled = !busy) { Text(label) }
          }
        }
      }
      if (account.note.isNotEmpty()) {
        Text(remember(account.note) { richText(account.note, linkColor) { openInBrowser(context, it) } })
      }
      for (field in account.fields) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(field.name, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(remember(field.value) { richText(field.value, linkColor) { openInBrowser(context, it) } }, style = MaterialTheme.typography.bodyMedium)
        }
      }
      Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Count(account.statusesCount, pluralStringResource(R.plurals.posts, account.statusesCount))
        Count(account.followingCount, stringResource(R.string.following_count))
        Count(account.followersCount, pluralStringResource(R.plurals.followers, account.followersCount))
      }
    }
  }
}

@Composable
private fun Count(value: Int, label: String) {
  Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(compact(value), fontWeight = FontWeight.Bold)
    Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
