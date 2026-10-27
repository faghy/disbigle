package com.disbigle.app.ui

import android.content.Context
import android.net.Uri
import android.text.format.DateUtils
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import com.disbigle.app.AppModel
import com.disbigle.app.R
import com.disbigle.kit.Account
import com.disbigle.kit.ApiException
import com.disbigle.kit.Page
import com.disbigle.kit.Query
import com.disbigle.kit.RichText
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Disbigle tomato. */
val Brand = Color(0xFFCF3200)

val LocalApp = staticCompositionLocalOf<AppModel> { error("no AppModel") }

@Composable
fun DisbigleTheme(content: @Composable () -> Unit) {
  val colors = if (isSystemInDarkTheme()) {
    darkColorScheme(
      primary = Color(0xFFFF8A5C), onPrimary = Color(0xFF3A0A00), primaryContainer = Color(0xFF5C1A00),
      onPrimaryContainer = Color(0xFFFFDBCF), background = Color(0xFF1A1110), surface = Color(0xFF1A1110),
      surfaceContainer = Color(0xFF271D1B), surfaceVariant = Color(0xFF3A2E2B),
      secondaryContainer = Color(0xFF5C1A00), onSecondaryContainer = Color(0xFFFFDBCF),
    )
  } else {
    lightColorScheme(
      primary = Brand, onPrimary = Color.White, primaryContainer = Color(0xFFFFDBCF),
      onPrimaryContainer = Color(0xFF3A0A00), background = Color(0xFFFFFBF8), surface = Color(0xFFFFFBF8),
      surfaceContainer = Color(0xFFFFF1E8), surfaceVariant = Color(0xFFF5E6DF),
      secondaryContainer = Color(0xFFFFDBCF), onSecondaryContainer = Color(0xFF3A0A00),
    )
  }
  MaterialTheme(colorScheme = colors, content = content)
}

/** A list read page by page (newest first), with the `Link` cursors of the API. */
class PagedList<T : Any>(
  private val scope: kotlinx.coroutines.CoroutineScope,
  private val idOf: (T) -> String,
  private val load: suspend (Query) -> Page<T>,
) {
  val items = mutableStateListOf<T>()
  var loading by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var finished by mutableStateOf(false)
    private set
  var loaded by mutableStateOf(false)
    private set
  private var next: Query? = null

  fun refresh() = fetch(emptyList(), replacing = true)

  fun loadMore() {
    val cursor = next ?: return
    if (!finished && !loading) fetch(cursor, replacing = false)
  }

  /** Loads the next page when the item at `index` (just shown) is near the end. */
  fun reached(index: Int) {
    if (index >= items.size - 5) loadMore()
  }

  fun replace(item: T) {
    val index = items.indexOfFirst { idOf(it) == idOf(item) }
    if (index >= 0) items[index] = item
  }

  fun remove(id: String) {
    items.removeAll { idOf(it) == id }
  }

  fun prepend(item: T) {
    val index = items.indexOfFirst { idOf(it) == idOf(item) }
    if (index >= 0) items[index] = item else items.add(0, item)
  }

  private fun fetch(query: Query, replacing: Boolean) {
    loading = true
    scope.launch {
      try {
        val page = load(query)
        if (replacing) {
          items.clear()
          items.addAll(page.items)
        } else {
          val known = items.map(idOf).toSet()
          items.addAll(page.items.filter { idOf(it) !in known })
        }
        next = page.next
        finished = page.next == null
        error = null
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error = e.message ?: e.toString()
      } finally {
        loading = false
        loaded = true
      }
    }
  }
}

/** Lists of a screen, kept while it is in the back stack. */
class ListStore : ViewModel() {
  private val lists = mutableMapOf<String, PagedList<*>>()

  @Suppress("UNCHECKED_CAST")
  fun <T : Any> list(key: String, idOf: (T) -> String, load: suspend (Query) -> Page<T>): PagedList<T> =
    lists.getOrPut(key) { PagedList(viewModelScope, idOf, load) } as PagedList<T>
}

/** Spinner, error with retry, or the empty message at the end of a list. */
@Composable
fun ListFooter(loading: Boolean, error: String?, empty: Boolean, emptyText: String, retry: () -> Unit) {
  Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
    when {
      loading -> CircularProgressIndicator(Modifier.size(28.dp))
      error != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(error, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
        TextButton(onClick = retry) { Text(androidx.compose.ui.res.stringResource(R.string.try_again)) }
      }
      empty -> Text(emptyText, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
fun Avatar(account: Account?, size: Dp = 44.dp) {
  val shape = RoundedCornerShape(size * 0.28f)
  val url = account?.avatarUrl
  val modifier = Modifier.size(size).clip(shape).clearAndSetSemantics {}
  if (url != null) {
    AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier.background(initialsColor(account)))
  } else {
    Box(modifier.background(initialsColor(account)), contentAlignment = Alignment.Center) {
      Text(account?.initials ?: "", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.4f).sp)
    }
  }
}

/** A colour picked from the account, so each person keeps theirs. */
private fun initialsColor(account: Account?): Color {
  val sum = (account?.acct ?: "").sumOf { it.code }
  return Color.hsv((sum % 360).toFloat(), 0.45f, 0.85f)
}

/** Post HTML as styled text; links call `onLink` (mentions and tags open in the app). */
fun richText(html: String, linkColor: Color, onLink: (String) -> Unit): AnnotatedString {
  val parsed = RichText.parse(html)
  return buildAnnotatedString {
    append(parsed.text)
    for (span in parsed.spans) {
      if (span.url != null) {
        val url = span.url!!
        addLink(
          LinkAnnotation.Clickable(url, TextLinkStyles(SpanStyle(color = linkColor))) { onLink(url) },
          span.start, span.end,
        )
      } else {
        val style = when (span.style) {
          RichText.Style.BOLD -> SpanStyle(fontWeight = FontWeight.Bold)
          RichText.Style.ITALIC -> SpanStyle(fontStyle = FontStyle.Italic)
          RichText.Style.CODE -> SpanStyle(fontFamily = FontFamily.Monospace)
          RichText.Style.STRIKE -> SpanStyle(textDecoration = TextDecoration.LineThrough)
          null -> null
        }
        style?.let { addStyle(it, span.start, span.end) }
      }
    }
  }
}

/** "5m", "3h", "2d" style time since `instant`. */
fun relative(instant: Instant): String {
  val now = System.currentTimeMillis()
  return DateUtils.getRelativeTimeSpanString(instant.toEpochMilli(), now, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_ALL).toString()
}

/** Large counts as 1.2K. */
fun compact(count: Int): String = when {
  count >= 1_000_000 -> "%.1fM".format(count / 1_000_000f).replace(".0M", "M")
  count >= 1_000 -> "%.1fK".format(count / 1_000f).replace(".0K", "K")
  else -> count.toString()
}

/** Opens a page in a Custom Tab (the browser with its cookies and saved passwords). */
fun openInBrowser(context: Context, url: String) {
  CustomTabsIntent.Builder()
    .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(Brand.toArgb()).build())
    .build()
    .launchUrl(context, Uri.parse(url))
}

/** A readable message for an error of the API. */
fun Context.messageOf(error: Throwable): String = when (error) {
  is ApiException.Unauthorized -> getString(R.string.session_ended)
  else -> error.message ?: error.toString()
}
