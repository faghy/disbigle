plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "com.disbigle.app"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.disbigle.app"
    minSdk = 28
    targetSdk = 35
    // CI passes the run number, so every build installs as an update.
    versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
    versionName = "0.1.0"
  }

  signingConfigs {
    // The release key comes from the environment (CI secrets); without it the release build is unsigned.
    System.getenv("DISBIGLE_KEYSTORE")?.let { path ->
      create("release") {
        storeFile = file(path)
        storePassword = System.getenv("DISBIGLE_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("DISBIGLE_KEY_ALIAS") ?: "disbigle"
        keyPassword = System.getenv("DISBIGLE_KEY_PASSWORD") ?: System.getenv("DISBIGLE_KEYSTORE_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.findByName("release")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  packaging {
    resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
  }
}

kotlin { jvmToolchain(17) }

dependencies {
  implementation(project(":kit"))
  implementation(libs.coroutines.android)
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.material3)
  implementation(libs.compose.icons)
  implementation(libs.compose.ui.tooling.preview)
  debugImplementation(libs.compose.ui.tooling)
  implementation(libs.activity.compose)
  implementation(libs.navigation.compose)
  implementation(libs.lifecycle.viewmodel.compose)
  implementation(libs.lifecycle.runtime.compose)
  implementation(libs.coil.compose)
  implementation(libs.coil.okhttp)
  implementation(libs.browser)
  implementation(libs.work.runtime)
}
