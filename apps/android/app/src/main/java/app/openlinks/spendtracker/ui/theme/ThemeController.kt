package app.openlinks.spendtracker.ui.theme

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import app.openlinks.spendtracker.data.ThemePreference

/**
 * Holds the appearance state at the root of the composition, above
 * [SpendTrackerTheme], because the preference has to be resolved before the theme
 * is chosen and the theme wraps the whole app.
 *
 * It exists as a CompositionLocal rather than a parameter so the control that
 * changes the theme does not have to be threaded down through every composable
 * between the root and the app bar. Reading the preference goes through
 * [preference]; writing goes through [updatePreference], which recomposes the tree
 * and persists in the same step so the two can never drift apart.
 */
@Stable
class ThemeController(
    initialPreference: ThemePreference,
    private val onPersist: (ThemePreference) -> Unit,
) {
    var preference: ThemePreference by mutableStateOf(initialPreference)
        private set

    fun updatePreference(next: ThemePreference) {
        preference = next
        onPersist(next)
    }
}

/**
 * The default is an inert controller rather than an error: a preview or a test
 * host that renders a screen without MainActivity's provider should show the
 * control in its System state, not crash. The real app always provides one.
 */
val LocalThemeController = staticCompositionLocalOf {
    ThemeController(ThemePreference.System) { }
}
