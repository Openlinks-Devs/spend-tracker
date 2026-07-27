package com.openlinks.spendtracker.ui.screens

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.Connection
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.ConnectionsUiState

/** The row's headline: the linked Gmail address, or just "Telegram". Pure. */
fun connectionTitle(connection: Connection): String =
    if (connection.provider == "gmail") connection.externalId else Strings.get(StringKey.IntegrationsTelegramName)

/** Maps the backend's status enum to display copy. Pure. */
fun connectionStatusLabel(status: String): String = when (status) {
    "active" -> Strings.get(StringKey.ConnectionStatusActive)
    "needs_reauth" -> Strings.get(StringKey.ConnectionStatusNeedsReauth)
    "disabled" -> Strings.get(StringKey.ConnectionStatusDisabled)
    else -> status
}

/**
 * Opens [url] in a Chrome Custom Tab, falling back to whatever browser is
 * installed. Google refuses OAuth inside a WebView, so linking has to leave the
 * app; returning is handled by reloading the list when the screen resumes.
 */
fun openExternalUrl(context: Context, url: String): Boolean = try {
    CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url))
    true
} catch (_: ActivityNotFoundException) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

@Composable
fun IntegrationsScreen(
    state: ConnectionsUiState,
    onLinkGmail: () -> Unit,
    onConnectTelegram: () -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = Strings.get(StringKey.IntegrationsSubtitle),
            style = MaterialTheme.typography.bodySmall,
        )

        if (state.liveModeRequired) {
            EmptyState(
                icon = Icons.Filled.Lock,
                message = Strings.get(StringKey.IntegrationsMockMode),
                modifier = Modifier.fillMaxSize(),
            )
            return@Column
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onLinkGmail, enabled = !state.linking) {
                Text(Strings.get(StringKey.IntegrationsLinkGmail))
            }
            OutlinedButton(onClick = onConnectTelegram, enabled = !state.linking) {
                Text(Strings.get(StringKey.IntegrationsConnectTelegram))
            }
        }

        if (state.premiumRequired) {
            Text(
                text = Strings.get(StringKey.IntegrationsPremiumRequired),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        state.error?.let { errorMessage ->
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                state.loading && state.connections.isEmpty() ->
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                state.connections.isEmpty() ->
                    EmptyState(
                        icon = Icons.Filled.LinkOff,
                        message = Strings.get(StringKey.IntegrationsEmpty),
                        modifier = Modifier.align(Alignment.Center),
                    )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.connections) { connection ->
                        ConnectionRow(
                            connection = connection,
                            onReauthenticate = onLinkGmail,
                            onRemove = { onRemove(connection.id) },
                        )
                    }
                }
            }
        }
    }
}

/** Centred icon-plus-message placeholder, so an empty screen is not a bare sentence. */
@Composable
private fun EmptyState(icon: ImageVector, message: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(40.dp),
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

@Composable
private fun ConnectionRow(
    connection: Connection,
    onReauthenticate: () -> Unit,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = connectionTitle(connection),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = connectionStatusLabel(connection.status),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (connection.provider == "gmail" && connection.status == "needs_reauth") {
                IconButton(onClick = onReauthenticate) {
                    Icon(
                        imageVector = Icons.Filled.Refresh,
                        contentDescription = Strings.get(StringKey.ActionReauthenticate),
                    )
                }
            }
            IconButton(onClick = onRemove) {
                Icon(
                    imageVector = Icons.Filled.Delete,
                    contentDescription = Strings.get(StringKey.ActionRemove),
                )
            }
        }
    }
}
