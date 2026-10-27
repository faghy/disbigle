plugins {
  alias(libs.plugins.kotlin.jvm)
  alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(17) }

dependencies {
  api(libs.coroutines.core)
  api(libs.serialization.json)
  api(libs.okhttp)
  testImplementation(libs.junit)
  testImplementation(libs.coroutines.test)
  testImplementation(libs.okhttp.mockwebserver)
}

tasks.test {
  // Live tests against a development server: DISBIGLE_TEST_SERVER=http://localhost:3300
  environment("DISBIGLE_TEST_SERVER", System.getenv("DISBIGLE_TEST_SERVER") ?: "")
}
