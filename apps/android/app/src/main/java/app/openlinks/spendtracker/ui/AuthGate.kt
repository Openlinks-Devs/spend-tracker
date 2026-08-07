package app.openlinks.spendtracker.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openlinks.spendtracker.BuildConfig
import app.openlinks.spendtracker.data.AuthState
import app.openlinks.spendtracker.ui.screens.AuthScreen

/** Where the top-level gate sends the user. */
enum class GateDestination { SHELL, AUTH }

/**
 * Pure gate decision, unit-tested in isolation. Mock builds always reach the
 * Shell so the default debug flow is untouched; only a live build routes a user
 * who is not signed in (signed-out or guest) to the auth screen.
 */
fun authGateDestination(useMockAuth: Boolean, authState: AuthState): GateDestination =
    when {
        useMockAuth -> GateDestination.SHELL
        authState is AuthState.SignedIn -> GateDestination.SHELL
        else -> GateDestination.AUTH
    }

/**
 * Reads the compile-time mock flag and the live auth state, then shows either the
 * existing app shell or the sign-in screen. In a mock build this is always the
 * shell, so [SpendTrackerApp] renders exactly as before.
 */
@Composable
fun AuthGate(viewModel: SessionViewModel) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    when (authGateDestination(BuildConfig.USE_MOCK_AUTH, authState)) {
        GateDestination.SHELL -> SpendTrackerApp(viewModel = viewModel)
        GateDestination.AUTH -> {
            val context = LocalContext.current
            val authUiState by viewModel.authUiState.collectAsStateWithLifecycle()
            AuthScreen(
                signingIn = authUiState.signingIn,
                errorMessage = authUiState.error,
                onSignIn = { viewModel.signInWithGoogle(context) },
            )
        }
    }
}
