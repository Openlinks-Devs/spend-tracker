package app.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.Connection
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings

/**
 * Tells the user, on the screen they actually open, that a linked Gmail account
 * stopped importing. The Integrations screen carries the same state, but nobody
 * opens it unprompted, which is the gap this closes.
 *
 * Renders nothing when there is nothing wrong or the user dismissed it. Colours
 * come from the theme's error role, so the banner follows the light/dark/system
 * preference in effect rather than hardcoding a red.
 */
@Composable
fun ConnectionAlertBanner(
    brokenConnections: List<Connection>,
    onReconnect: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (brokenConnections.isEmpty()) return

    val accountList = brokenConnections.joinToString(", ") { connection -> connection.externalId }
    val headline = if (brokenConnections.size == 1) {
        Strings.get(StringKey.ConnectionAlertSingle).format(accountList)
    } else {
        Strings.get(StringKey.ConnectionAlertMultiple).format(accountList)
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 12.dp, end = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(text = headline, style = MaterialTheme.typography.bodyMedium)
                Text(
                    text = Strings.get(StringKey.ConnectionAlertDetail),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            IconButton(onClick = onDismiss) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = Strings.get(StringKey.ActionDismiss),
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onReconnect) {
                Text(text = Strings.get(StringKey.ActionReconnect))
            }
        }
    }
}
