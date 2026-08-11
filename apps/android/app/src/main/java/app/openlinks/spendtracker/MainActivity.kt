package app.openlinks.spendtracker

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import app.openlinks.spendtracker.data.SessionStore
import app.openlinks.spendtracker.data.SharedPrefsStore
import app.openlinks.spendtracker.data.ThemeStore
import app.openlinks.spendtracker.data.resolveDarkTheme
import app.openlinks.spendtracker.ui.AuthGate
import app.openlinks.spendtracker.ui.SessionViewModel
import app.openlinks.spendtracker.ui.theme.LocalThemeController
import app.openlinks.spendtracker.ui.theme.SpendTrackerTheme
import app.openlinks.spendtracker.ui.theme.ThemeController

// The androidx defaults for enableEdgeToEdge()'s navigation bar, kept explicit
// because we have to pass our own detectDarkMode lambda and that means passing the
// whole style. The status bar keeps transparent scrims, as the default does.
private const val NAV_BAR_LIGHT_SCRIM = 0xE6FFFFFF.toInt()
private const val NAV_BAR_DARK_SCRIM = 0x801B1B1B.toInt()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The AuthGate keeps mock parity: in a mock build (USE_MOCK_AUTH=true) it
        // always renders the Shell, so the default debug flow is unchanged. Only a
        // live build routes a signed-out user to the Google sign-in screen.
        val sessionStore = SessionStore(SharedPrefsStore(applicationContext))

        // A different prefs file from the session, because the appearance choice
        // must survive sign-out and SessionStore.clear() wipes the session file.
        val themeStore = ThemeStore(SharedPrefsStore(applicationContext, "spendtracker_prefs"))
        // Read synchronously, before setContent: the theme has to be decided before
        // the first frame or the user sees a light-then-dark flash.
        val initialPreference = themeStore.preference()
        applySystemBarStyle(resolveDarkTheme(initialPreference, systemIsDarkFromConfiguration()))

        setContent {
            // Above SpendTrackerTheme on purpose: the theme wraps AuthGate and the
            // whole app, so the preference has to be resolved outside it.
            val themeController = remember {
                ThemeController(initialPreference) { chosen -> themeStore.setPreference(chosen) }
            }
            val darkTheme = resolveDarkTheme(themeController.preference, isSystemInDarkTheme())

            // The bars are part of the resolved theme too. Without this, a user who
            // forces dark on a light OS gets dark status-bar icons on a dark bar.
            DisposableEffect(darkTheme) {
                applySystemBarStyle(darkTheme)
                onDispose { }
            }

            CompositionLocalProvider(LocalThemeController provides themeController) {
                SpendTrackerTheme(darkTheme = darkTheme) {
                    val viewModel: SessionViewModel = viewModel(factory = SessionViewModel.factory(sessionStore))
                    AuthGate(viewModel = viewModel)
                }
            }
        }
    }

    private fun applySystemBarStyle(isDarkTheme: Boolean) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { isDarkTheme },
            navigationBarStyle = SystemBarStyle.auto(NAV_BAR_LIGHT_SCRIM, NAV_BAR_DARK_SCRIM) { isDarkTheme },
        )
    }

    /**
     * isSystemInDarkTheme() is only available inside a composition, and the first
     * bar style has to be set before setContent, so read the same signal off the
     * configuration.
     */
    private fun systemIsDarkFromConfiguration(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
}
