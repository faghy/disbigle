package com.disbigle.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.disbigle.app.R
import kotlinx.coroutines.launch

const val DEFAULT_SERVER = "app.disbigle.com"

@Composable
fun SignInScreen(callbackError: String?) {
  val model = LocalApp.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var server by rememberSaveable { mutableStateOf(DEFAULT_SERVER) }
  var working by rememberSaveable { mutableStateOf(false) }
  var error by rememberSaveable { mutableStateOf<String?>(null) }

  fun signIn() {
    if (working || server.isBlank()) return
    working = true
    error = null
    scope.launch {
      try {
        openInBrowser(context, model.startSignIn(server))
      } catch (e: Exception) {
        error = context.messageOf(e)
      } finally {
        working = false
      }
    }
  }

  Surface(Modifier.fillMaxSize()) {
    Column(
      Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Image(painterResource(R.drawable.ic_launcher_foreground), null, Modifier.size(96.dp))
      Text(stringResource(R.string.welcome), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
      Text(stringResource(R.string.welcome_text), color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(
        value = server,
        onValueChange = { server = it },
        label = { Text(stringResource(R.string.your_server)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onGo = { signIn() }),
        supportingText = { Text(stringResource(R.string.sign_in_footer)) },
        modifier = Modifier.fillMaxWidth(),
      )
      (error ?: callbackError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
      Button(onClick = { signIn() }, enabled = !working && server.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
        if (working) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.sign_in))
      }
      TextButton(onClick = { openInBrowser(context, "https://$DEFAULT_SERVER/register") }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.create_account))
      }
    }
  }
}
