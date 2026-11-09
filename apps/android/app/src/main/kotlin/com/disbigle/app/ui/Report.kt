package com.disbigle.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.disbigle.app.R
import com.disbigle.kit.Account
import com.disbigle.kit.ReportCategory
import com.disbigle.kit.Status
import com.disbigle.kit.report
import kotlinx.coroutines.launch

/** Reports a post or a person to the moderators: why, and a few words if wanted. */
@Composable
fun ReportDialog(account: Account, status: Status?, onDismiss: () -> Unit) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var category by remember { mutableStateOf(ReportCategory.SPAM) }
  var comment by remember { mutableStateOf("") }
  var sending by remember { mutableStateOf(false) }
  var sent by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val labels = mapOf(
    ReportCategory.SPAM to R.string.report_spam, ReportCategory.LEGAL to R.string.report_legal,
    ReportCategory.VIOLATION to R.string.report_violation, ReportCategory.OTHER to R.string.report_other,
  )
  AlertDialog(
    onDismissRequest = onDismiss,
    title = {
      Text(
        if (sent) stringResource(R.string.report_sent)
        else if (status != null) stringResource(R.string.report_post_of, account.name)
        else stringResource(R.string.report_account, account.name),
      )
    },
    text = {
      if (!sent) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          for ((value, label) in labels) {
            Row(
              Modifier.fillMaxWidth().clickable { category = value },
              verticalAlignment = Alignment.CenterVertically,
            ) {
              RadioButton(selected = category == value, onClick = { category = value })
              Text(stringResource(label))
            }
          }
          OutlinedTextField(
            comment, { comment = it },
            label = { Text(stringResource(R.string.report_comment)) },
            modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 6,
          )
          Text(stringResource(R.string.report_help), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
      }
    },
    confirmButton = {
      if (sent) {
        TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok)) }
      } else {
        TextButton(
          enabled = !sending,
          onClick = {
            val client = model.client ?: return@TextButton
            sending = true
            scope.launch {
              try {
                client.report(account.id, listOfNotNull(status?.id), category, comment)
                sent = true
              } catch (e: Exception) {
                error = context.messageOf(e)
              } finally {
                sending = false
              }
            }
          },
        ) { Text(stringResource(R.string.report_send), color = MaterialTheme.colorScheme.error) }
      }
    },
    dismissButton = {
      if (!sent) TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
    },
  )
}
