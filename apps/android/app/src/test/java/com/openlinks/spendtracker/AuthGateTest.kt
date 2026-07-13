package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.AuthState
import com.openlinks.spendtracker.ui.GateDestination
import com.openlinks.spendtracker.ui.authGateDestination
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pure decision table for the auth gate. Mock builds always land on the Shell so
 * the default debug flow is untouched; only live builds route a signed-out user
 * to the auth screen.
 */
class AuthGateTest {

    @Test
    fun mockBuildAlwaysReachesShellRegardlessOfAuthState() {
        assertEquals(
            GateDestination.SHELL,
            authGateDestination(useMockAuth = true, authState = AuthState.SignedOut),
        )
        assertEquals(
            GateDestination.SHELL,
            authGateDestination(useMockAuth = true, authState = AuthState.Guest),
        )
        assertEquals(
            GateDestination.SHELL,
            authGateDestination(useMockAuth = true, authState = AuthState.SignedIn("tok")),
        )
    }

    @Test
    fun liveBuildSignedInReachesShell() {
        assertEquals(
            GateDestination.SHELL,
            authGateDestination(useMockAuth = false, authState = AuthState.SignedIn("tok")),
        )
    }

    @Test
    fun liveBuildSignedOutRoutesToAuth() {
        assertEquals(
            GateDestination.AUTH,
            authGateDestination(useMockAuth = false, authState = AuthState.SignedOut),
        )
    }

    @Test
    fun liveBuildGuestRoutesToAuth() {
        assertEquals(
            GateDestination.AUTH,
            authGateDestination(useMockAuth = false, authState = AuthState.Guest),
        )
    }
}
