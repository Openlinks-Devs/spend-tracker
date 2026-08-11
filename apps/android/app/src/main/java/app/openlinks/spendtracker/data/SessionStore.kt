package app.openlinks.spendtracker.data

import android.content.Context

/**
 * The mock/live seam, client side. In mock mode every request carries an
 * x-mock-user header and the backend resolves a fixed demo identity. In live
 * mode a bearer token would be attached instead. This app ships mock-only, but
 * the seam is kept intact so live auth can be added later without reshaping the
 * client.
 */
sealed interface AuthState {
    data class SignedIn(val token: String) : AuthState
    data object Guest : AuthState
    data object SignedOut : AuthState
}

/** Tiny persistence interface so the state machine is testable without a Context. */
interface KeyValueStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
}

/**
 * SharedPreferences-backed store. [name] is the prefs file, and it is a parameter
 * rather than a constant because not everything we persist is session state: the
 * appearance preference has to survive sign-out, and [SessionStore.clear] wipes
 * every key in the session file. Separate files are separate namespaces, so a
 * caller that wants durable state simply asks for a different one. The default
 * keeps every existing call site pointing at the session file unchanged.
 *
 * SharedPreferences (not DataStore) on purpose: reads here are synchronous, which
 * is what MainActivity.onCreate needs to resolve the theme before the first frame.
 * A Flow-based read would decide after the first frame and flash light-then-dark.
 */
class SharedPrefsStore(
    context: Context,
    name: String = "spendtracker_session",
) : KeyValueStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }
}

/** In-memory store for tests and for a default mock session with no Context. */
class InMemoryKeyValueStore : KeyValueStore {
    private val backing = mutableMapOf<String, String>()
    override fun getString(key: String): String? = backing[key]
    override fun putString(key: String, value: String) {
        backing[key] = value
    }
    override fun remove(key: String) {
        backing.remove(key)
    }
}

class SessionStore(private val store: KeyValueStore) {
    fun authState(): AuthState = when {
        !store.getString(KEY_TOKEN).isNullOrBlank() -> AuthState.SignedIn(store.getString(KEY_TOKEN)!!)
        store.getString(KEY_GUEST) == "1" -> AuthState.Guest
        else -> AuthState.SignedOut
    }

    fun saveToken(token: String) {
        store.remove(KEY_GUEST)
        store.putString(KEY_TOKEN, token)
    }

    fun setGuest() {
        store.remove(KEY_TOKEN)
        store.putString(KEY_GUEST, "1")
    }

    fun clear() {
        store.remove(KEY_TOKEN)
        store.remove(KEY_GUEST)
    }

    private companion object {
        const val KEY_TOKEN = "bearer_token"
        const val KEY_GUEST = "guest"
    }
}

/**
 * Pure, unit-testable: which auth header (if any) does a request carry?
 * Mock mode always sends x-mock-user; live mode attaches a bearer when signed in.
 */
fun authHeaders(useMockAuth: Boolean, mockUser: String, state: AuthState): Map<String, String> = when {
    useMockAuth -> mapOf("x-mock-user" to mockUser)
    state is AuthState.SignedIn -> mapOf("Authorization" to "Bearer ${state.token}")
    else -> emptyMap()
}
