package com.disbigle.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.disbigle.app.R
import com.disbigle.kit.Account
import com.disbigle.kit.Page
import com.disbigle.kit.Status
import com.disbigle.kit.favouritedBy
import com.disbigle.kit.rebloggedBy

/** The two lists of the sheet: who liked a post and who reshared it. */
enum class InteractionTab { LIKES, RESHARES }

/** Who liked and who reshared one of your posts, in two tabs; a person opens their profile. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InteractionsSheet(status: Status, start: InteractionTab, nav: Nav, onDismiss: () -> Unit) {
  val model = LocalApp.current
  val scope = rememberCoroutineScope()
  val client = model.client
  var tab by remember(status.id) { mutableStateOf(start) }
  val likes = remember(status.id) {
    PagedList<Account>(scope, { it.id }) { q -> client?.favouritedBy(status.id, q) ?: Page(emptyList(), null) }
  }
  val reshares = remember(status.id) {
    PagedList<Account>(scope, { it.id }) { q -> client?.rebloggedBy(status.id, q) ?: Page(emptyList(), null) }
  }
  val list = if (tab == InteractionTab.LIKES) likes else reshares
  // The local domain, to show local people with their full handle.
  val domain = model.instance?.domain?.takeIf { it.isNotEmpty() }

  LaunchedEffect(tab) { if (!list.loaded && !list.loading) list.refresh() }

  ModalBottomSheet(onDismissRequest = onDismiss) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
      Text(
        stringResource(R.string.likes_and_reshares), style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
      )
      PrimaryTabRow(selectedTabIndex = tab.ordinal) {
        for (each in InteractionTab.entries) {
          val (label, count) = when (each) {
            InteractionTab.LIKES -> stringResource(R.string.likes) to status.favouritesCount
            InteractionTab.RESHARES -> stringResource(R.string.reshares) to status.reblogsCount
          }
          Tab(
            selected = each == tab,
            onClick = { tab = each },
            text = {
              Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(label)
                Text(compact(count), color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            },
          )
        }
      }
      LazyColumn(Modifier.fillMaxWidth()) {
        itemsIndexed(list.items, key = { _, a -> "${tab.name}:${a.id}" }) { index, account ->
          LaunchedEffect(index) { list.reached(index) }
          val handle = if (account.acct.contains('@') || domain == null) "@${account.acct}" else "@${account.acct}@$domain"
          AccountRow(account, onClick = { onDismiss(); nav.account(account) }, handle = handle)
        }
        item {
          ListFooter(
            list.loading || !list.loaded, list.error, list.loaded && list.items.isEmpty(),
            stringResource(if (tab == InteractionTab.LIKES) R.string.no_likes else R.string.no_reshares),
          ) { if (list.items.isEmpty()) list.refresh() else list.loadMore() }
        }
      }
    }
  }
}
