package com.disbigle.app

import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.lifecycleScope
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.disbigle.app.ui.DisbigleRoot
import com.disbigle.kit.Client
import com.disbigle.kit.SignIn
import kotlinx.coroutines.launch

class DisbigleApplication : Application(), SingletonImageLoader.Factory {
  override fun newImageLoader(context: PlatformContext): ImageLoader = ImageLoader.Builder(context)
    .components { add(OkHttpNetworkFetcherFactory(callFactory = { Client.defaultHttp })) }
    .build()
}

class MainActivity : ComponentActivity() {
  private val model: AppModel by viewModels()
  /** An error of the sign-in that came back from the browser, for the sign-in screen. */
  val signInError = mutableStateOf<String?>(null)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) handle(intent)
    setContent { DisbigleRoot(model, this) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handle(intent)
  }

  private fun handle(intent: Intent) {
    val data = intent.data
    if (data != null && data.toString().startsWith(SignIn.REDIRECT_URI)) {
      lifecycleScope.launch {
        signInError.value = null
        try {
          model.finishSignIn(data.toString())
        } catch (_: SignIn.Failure.Denied) {
          signInError.value = getString(R.string.authorization_refused)
        } catch (e: Exception) {
          signInError.value = e.message
        }
      }
      return
    }
    if (intent.hasExtra(EXTRA_STATUS) || intent.hasExtra(EXTRA_ACCOUNT)) {
      model.open(intent.getStringExtra(EXTRA_STATUS), intent.getStringExtra(EXTRA_ACCOUNT))
    }
    if (BuildConfig.DEBUG) {
      val server = intent.getStringExtra("server")
      val token = intent.getStringExtra("token")
      if (server != null && token != null) model.debugSignIn(server, token, intent.getStringExtra("screen"))
      // `--ez check true`: run the background check now (it otherwise runs about every 15 minutes).
      if (intent.getBooleanExtra("check", false)) {
        androidx.work.WorkManager.getInstance(this).enqueue(androidx.work.OneTimeWorkRequest.from(CheckWorker::class.java))
      }
    }
  }

  companion object {
    const val EXTRA_STATUS = "statusId"
    const val EXTRA_ACCOUNT = "accountId"
  }
}
