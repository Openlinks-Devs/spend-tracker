plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Build-time mock/live seam flags. Read from Gradle properties (gradle.properties
// or -P command line overrides) and baked into BuildConfig.
val apiBaseUrl: String = (project.findProperty("apiBaseUrl") as String?)
    ?: "http://10.0.2.2:3000"
val mockUser: String = (project.findProperty("mockUser") as String?) ?: "demo-user"
val useMockAuth: Boolean =
    (project.findProperty("useMockAuth") as String?)?.toBoolean() ?: true
// The Web OAuth client id (== backend GOOGLE_CLIENT_ID == the ID token audience).
// Passed at build time via -PserverClientId for live builds; empty in mock builds.
val serverClientId: String = (project.findProperty("serverClientId") as String?) ?: ""

// Release signing. The keystore lives outside the repo and its credentials come
// from Gradle properties (put them in ~/.gradle/gradle.properties) or the matching
// environment variables for CI. Nothing here may ever hold a literal secret.
fun signingSetting(propertyName: String, environmentName: String): String? =
    (project.findProperty(propertyName) as String?) ?: System.getenv(environmentName)

val releaseStorePath: String? = signingSetting("releaseStoreFile", "ANDROID_RELEASE_STORE_FILE")
val releaseStorePassword: String? =
    signingSetting("releaseStorePassword", "ANDROID_RELEASE_STORE_PASSWORD")
val releaseKeyAlias: String? = signingSetting("releaseKeyAlias", "ANDROID_RELEASE_KEY_ALIAS")
val releaseKeyPassword: String? =
    signingSetting("releaseKeyPassword", "ANDROID_RELEASE_KEY_PASSWORD")
val releaseKeystore: File? = releaseStorePath?.let(::File)?.takeIf { keystore -> keystore.exists() }

// A machine without the keystore still has to be able to build. When any part of
// the configuration is missing the release build stays unsigned rather than
// failing, so a fresh clone and CI are not blocked on holding the signing key.
val canSignRelease: Boolean = releaseKeystore != null &&
    releaseStorePassword != null &&
    releaseKeyAlias != null &&
    releaseKeyPassword != null

android {
    namespace = "app.openlinks.spendtracker"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.openlinks.spendtracker"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        buildConfigField("String", "MOCK_USER", "\"$mockUser\"")
        buildConfigField("boolean", "USE_MOCK_AUTH", "$useMockAuth")
        buildConfigField("String", "SERVER_CLIENT_ID", "\"$serverClientId\"")
    }

    signingConfigs {
        if (canSignRelease) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (canSignRelease) signingConfigs.getByName("release") else null
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // The calendar heatmap uses java.time (LocalDate), which is only native
        // from API 26. minSdk is 24, so desugar it to stay safe on API 24-25.
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.navigation:navigation-compose:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // Chrome Custom Tabs: Google rejects OAuth in a WebView, so Gmail linking
    // hands the consent URL to the user's browser.
    implementation("androidx.browser:browser:1.8.0")

    // Vico: Compose-native charting (column/line cartesian charts) for the analytics screen.
    implementation("com.patrykandpatrick.vico:compose-m3:2.1.3")

    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Native Google sign-in: Credential Manager yields a Google ID token that is
    // exchanged for a Better Auth bearer session.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation(platform("androidx.compose:compose-bom:2024.12.01"))
}
