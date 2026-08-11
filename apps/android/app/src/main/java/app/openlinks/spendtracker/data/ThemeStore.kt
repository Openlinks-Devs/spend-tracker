package app.openlinks.spendtracker.data

/**
 * The user's appearance choice. Three states, matching what web shipped: an
 * explicit Light or Dark override, or System, which defers to the OS setting.
 * A two-way switch cannot express "follow the system", which is the default and
 * the state most users stay in.
 */
enum class ThemePreference { Light, Dark, System }

/**
 * Persisted appearance preference, shaped exactly like [SessionStore]: a thin
 * reader/writer over a [KeyValueStore] so the decision logic is unit-testable
 * without a Context.
 *
 * Deliberately NOT stored in the session prefs file: [SessionStore.clear] removes
 * the session keys on sign-out, and a user's chosen theme must outlive that. The
 * caller hands this a [SharedPrefsStore] pointed at a different file.
 */
class ThemeStore(private val store: KeyValueStore) {

    /**
     * The stored preference, defaulting to [ThemePreference.System] when the key
     * is absent (first launch) or holds a value this build does not recognise
     * (downgrade, manual edit). An unreadable value must never be fatal: falling
     * back to the OS setting is always a sane screen.
     */
    fun preference(): ThemePreference = when (store.getString(KEY_PREFERENCE)) {
        TOKEN_LIGHT -> ThemePreference.Light
        TOKEN_DARK -> ThemePreference.Dark
        else -> ThemePreference.System
    }

    fun setPreference(preference: ThemePreference) {
        store.putString(KEY_PREFERENCE, tokenFor(preference))
    }

    /**
     * A stable string token, never the enum ordinal: reordering or inserting a
     * value in [ThemePreference] would silently repoint every user's saved choice
     * at a different theme.
     */
    private fun tokenFor(preference: ThemePreference): String = when (preference) {
        ThemePreference.Light -> TOKEN_LIGHT
        ThemePreference.Dark -> TOKEN_DARK
        ThemePreference.System -> TOKEN_SYSTEM
    }

    private companion object {
        const val KEY_PREFERENCE = "theme_preference"
        const val TOKEN_LIGHT = "light"
        const val TOKEN_DARK = "dark"
        const val TOKEN_SYSTEM = "system"
    }
}

/**
 * Pure, unit-testable: does the app render dark, given the user's choice and what
 * the OS currently reports? Kept out of the composable so the three-state logic
 * can be exercised without Compose.
 */
fun resolveDarkTheme(preference: ThemePreference, systemIsDark: Boolean): Boolean = when (preference) {
    ThemePreference.Light -> false
    ThemePreference.Dark -> true
    ThemePreference.System -> systemIsDark
}
