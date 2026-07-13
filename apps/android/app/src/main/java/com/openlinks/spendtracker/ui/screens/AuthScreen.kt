package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings

/**
 * Live-build sign-in screen: a centered "Sign in with Google" button, a progress
 * indicator while the Credential Manager round-trip is in flight, and any error
 * from a failed exchange (a non-allowlisted email surfaces here). All copy via
 * [Strings].
 */
@Composable
fun AuthScreen(
    signingIn: Boolean,
    errorMessage: String?,
    onSignIn: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = Strings.get(StringKey.AuthTitle),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = Strings.get(StringKey.AuthSubtitle),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp, bottom = 32.dp),
        )
        if (signingIn) {
            CircularProgressIndicator()
        } else {
            Button(onClick = onSignIn) {
                Text(Strings.get(StringKey.AuthSignInWithGoogle))
            }
        }
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(top = 24.dp)
                    .width(280.dp),
            )
        }
    }
}
