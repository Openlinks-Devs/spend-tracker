package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.AuthState
import app.openlinks.spendtracker.data.InMemoryKeyValueStore
import app.openlinks.spendtracker.data.KeyValueStore
import app.openlinks.spendtracker.data.SessionStore
import app.openlinks.spendtracker.data.ThemePreference
import app.openlinks.spendtracker.data.ThemeStore
import app.openlinks.spendtracker.data.authHeaders
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Stands in for Context.getSharedPreferences(name, ...): one backing map per file
 * name. SharedPrefsStore's new name parameter buys exactly one property, that
 * distinct names are distinct namespaces, and that property is a platform
 * guarantee a plain JVM unit test cannot exercise (Robolectric is not on this
 * project's classpath, and unitTests.isReturnDefaultValues makes the real call
 * return null). Asserting it against an equivalent factory at least pins the
 * contract every caller depends on.
 */
private class NamedStoreFactory {
    private val filesByName = mutableMapOf<String, InMemoryKeyValueStore>()
    fun store(name: String): KeyValueStore = filesByName.getOrPut(name) { InMemoryKeyValueStore() }
}

class SessionStoreTest {

    @Test
    fun defaultsToSignedOut() {
        val store = SessionStore(InMemoryKeyValueStore())
        assertEquals(AuthState.SignedOut, store.authState())
    }

    @Test
    fun saveTokenBecomesSignedIn() {
        val store = SessionStore(InMemoryKeyValueStore())
        store.saveToken("abc123")
        assertEquals(AuthState.SignedIn("abc123"), store.authState())
    }

    @Test
    fun setGuestBecomesGuestAndClearsToken() {
        val store = SessionStore(InMemoryKeyValueStore())
        store.saveToken("abc123")
        store.setGuest()
        assertEquals(AuthState.Guest, store.authState())
    }

    @Test
    fun clearResetsToSignedOut() {
        val store = SessionStore(InMemoryKeyValueStore())
        store.saveToken("abc123")
        store.clear()
        assertEquals(AuthState.SignedOut, store.authState())
    }

    @Test
    fun storesWithDifferentNamesDoNotSeeEachOthersKeys() {
        val factory = NamedStoreFactory()
        val sessionStore = SessionStore(factory.store("spendtracker_session"))
        val prefsFile = factory.store("spendtracker_prefs")

        sessionStore.saveToken("abc123")
        assertNull(prefsFile.getString("bearer_token"))

        prefsFile.putString("theme_preference", "dark")
        assertEquals(AuthState.SignedIn("abc123"), sessionStore.authState())
    }

    @Test
    fun signOutClearsTheSessionFileButNotTheThemeFile() {
        val factory = NamedStoreFactory()
        val sessionStore = SessionStore(factory.store("spendtracker_session"))
        val themeStore = ThemeStore(factory.store("spendtracker_prefs"))

        sessionStore.saveToken("abc123")
        themeStore.setPreference(ThemePreference.Dark)
        sessionStore.clear()

        assertEquals(AuthState.SignedOut, sessionStore.authState())
        assertEquals(ThemePreference.Dark, themeStore.preference())
    }

    @Test
    fun mockModeAlwaysSendsMockUserHeader() {
        val headers = authHeaders(useMockAuth = true, mockUser = "demo-user", state = AuthState.SignedOut)
        assertEquals(mapOf("x-mock-user" to "demo-user"), headers)
    }

    @Test
    fun liveSignedInSendsBearer() {
        val headers = authHeaders(useMockAuth = false, mockUser = "demo-user", state = AuthState.SignedIn("tok"))
        assertEquals(mapOf("Authorization" to "Bearer tok"), headers)
    }

    @Test
    fun liveSignedOutSendsNothing() {
        val headers = authHeaders(useMockAuth = false, mockUser = "demo-user", state = AuthState.SignedOut)
        assertTrue(headers.isEmpty())
    }
}
