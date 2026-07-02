package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.AuthState
import com.openlinks.spendtracker.data.InMemoryKeyValueStore
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.authHeaders
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

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
