package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.InMemoryKeyValueStore
import app.openlinks.spendtracker.data.ThemePreference
import app.openlinks.spendtracker.data.ThemeStore
import app.openlinks.spendtracker.data.resolveDarkTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeStoreTest {

    @Test
    fun defaultsToSystemWhenNothingStored() {
        val store = ThemeStore(InMemoryKeyValueStore())
        assertEquals(ThemePreference.System, store.preference())
    }

    @Test
    fun roundTripsEveryPreference() {
        ThemePreference.entries.forEach { preference ->
            val store = ThemeStore(InMemoryKeyValueStore())
            store.setPreference(preference)
            assertEquals(preference, store.preference())
        }
    }

    @Test
    fun lastWriteWins() {
        val store = ThemeStore(InMemoryKeyValueStore())
        store.setPreference(ThemePreference.Dark)
        store.setPreference(ThemePreference.Light)
        assertEquals(ThemePreference.Light, store.preference())
    }

    @Test
    fun garbageStoredValueFallsBackToSystem() {
        val backing = InMemoryKeyValueStore()
        backing.putString("theme_preference", "chartreuse")
        assertEquals(ThemePreference.System, ThemeStore(backing).preference())
    }

    /**
     * The persisted form is a stable token, not the enum ordinal, so that
     * reordering [ThemePreference] cannot silently repoint a saved choice.
     */
    @Test
    fun persistsStableStringTokens() {
        val backing = InMemoryKeyValueStore()
        val store = ThemeStore(backing)

        store.setPreference(ThemePreference.Light)
        assertEquals("light", backing.getString("theme_preference"))
        store.setPreference(ThemePreference.Dark)
        assertEquals("dark", backing.getString("theme_preference"))
        store.setPreference(ThemePreference.System)
        assertEquals("system", backing.getString("theme_preference"))
    }

    @Test
    fun resolveDarkThemeTruthTable() {
        assertFalse(resolveDarkTheme(ThemePreference.Light, systemIsDark = false))
        assertFalse(resolveDarkTheme(ThemePreference.Light, systemIsDark = true))
        assertTrue(resolveDarkTheme(ThemePreference.Dark, systemIsDark = false))
        assertTrue(resolveDarkTheme(ThemePreference.Dark, systemIsDark = true))
        assertFalse(resolveDarkTheme(ThemePreference.System, systemIsDark = false))
        assertTrue(resolveDarkTheme(ThemePreference.System, systemIsDark = true))
    }
}
