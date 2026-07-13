package com.openlinks.spendtracker.data

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.openlinks.spendtracker.BuildConfig

/**
 * Native Google sign-in via Credential Manager. On-device Credential Manager
 * yields a Google ID token, which is exchanged for a Better Auth session token
 * and persisted. The serverClientId is the Web OAuth client id, the same value
 * as the backend GOOGLE_CLIENT_ID (the token audience). The separate Android
 * OAuth client (package + SHA-1) is a Console registration only.
 *
 * The Credential Manager round-trip needs a real device with Google Play and the
 * user's OAuth clients, so it is device-verified only, not unit-testable.
 */
class AuthRepository(
    private val api: SpendApi,
    private val session: SessionStore,
    private val serverClientId: String = BuildConfig.SERVER_CLIENT_ID,
) {
    suspend fun signInWithGoogle(context: Context) {
        val googleIdOption = GetGoogleIdOption.Builder()
            .setServerClientId(serverClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
        val credential = CredentialManager.create(context)
            .getCredential(context, request)
            .credential
        require(
            credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL,
        ) { "Unexpected credential type from Credential Manager" }
        val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
        session.saveToken(api.exchangeGoogleIdToken(idToken))
    }

    suspend fun signOut(context: Context) {
        runCatching { api.signOutRemote() }
        session.clear()
        runCatching {
            CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
        }
    }
}
