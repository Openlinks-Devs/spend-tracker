package app.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.EmailLogItem
import app.openlinks.spendtracker.data.emailRowKey
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.Formatting
import app.openlinks.spendtracker.ui.InboxUiState

/**
 * Maps the backend's verdict vocabulary to display copy. Pure, and worded exactly
 * as the web client words it so both surfaces describe the same outcome the same
 * way. An unrecognised value falls through to its raw form rather than vanishing,
 * matching [connectionStatusLabel].
 */
fun emailVerdictLabel(verdict: String): String = when (verdict) {
    "imported" -> Strings.get(StringKey.VerdictImported)
    "not_transaction" -> Strings.get(StringKey.VerdictNotTransaction)
    "not_configured" -> Strings.get(StringKey.VerdictNotConfigured)
    "extract_failed" -> Strings.get(StringKey.VerdictExtractFailed)
    "failed" -> Strings.get(StringKey.VerdictFailed)
    "unknown" -> Strings.get(StringKey.VerdictUnknown)
    else -> verdict
}

/**
 * Whether a verdict is a problem the user should notice. Only the two that mean
 * a real email did not become a transaction. `not_transaction` is the
 * overwhelmingly common case (every newsletter the poller reads), so colouring it
 * would turn the whole screen red and say nothing.
 */
fun emailVerdictIsError(verdict: String): Boolean = verdict == "failed" || verdict == "extract_failed"

/**
 * The transaction an inbox row can open, if any. An `imported` row can still
 * carry no transaction, because deleting a transaction nulls the link; that row
 * stays imported and simply offers nothing to tap, rather than a dead link.
 */
fun openableTransactionId(email: EmailLogItem): String? = email.transaction?.id

@Composable
fun InboxScreen(
    state: InboxUiState,
    onOpenTransaction: (String) -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (state.liveModeRequired) {
            InboxPlaceholder(
                icon = Icons.Filled.Lock,
                message = Strings.get(StringKey.InboxMockMode),
                modifier = Modifier.fillMaxSize(),
            )
            return@Column
        }

        Text(
            text = Strings.get(StringKey.InboxSubtitle),
            style = MaterialTheme.typography.bodySmall,
        )

        state.error?.let { errorMessage ->
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                state.loading && state.emails.isEmpty() ->
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                state.emails.isEmpty() ->
                    InboxPlaceholder(
                        icon = Icons.Filled.Inbox,
                        message = Strings.get(StringKey.InboxEmpty),
                        modifier = Modifier.align(Alignment.Center),
                    )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.emails, key = { email -> emailRowKey(email) }) { email ->
                        EmailRow(
                            email = email,
                            onOpenTransaction = onOpenTransaction,
                        )
                    }
                    if (state.canLoadMore) {
                        item {
                            OutlinedButton(
                                onClick = onLoadMore,
                                enabled = !state.loadingMore,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(Strings.get(StringKey.InboxLoadMore))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Centred icon-plus-message placeholder, so an empty screen is not a bare sentence. */
@Composable
private fun InboxPlaceholder(icon: ImageVector, message: String, modifier: Modifier = Modifier) {
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
private fun EmailRow(email: EmailLogItem, onOpenTransaction: (String) -> Unit) {
    val transactionId = openableTransactionId(email)
    val rowModifier = Modifier.fillMaxWidth().let { base ->
        if (transactionId == null) base else base.clickable { onOpenTransaction(transactionId) }
    }
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = rowModifier,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            // Subject leads: it is what the user recognises the email by. A
            // cleared or historical row says so rather than showing a blank line.
            Text(
                text = email.subject ?: Strings.get(StringKey.InboxSubjectUnavailable),
                style = MaterialTheme.typography.bodyLarge,
                fontStyle = if (email.subject == null) FontStyle.Italic else FontStyle.Normal,
                color = if (email.subject == null) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = email.sender ?: Strings.get(StringKey.InboxSenderUnavailable),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Plain text, not a chip: the verdict is information, not decoration.
                Text(
                    text = emailVerdictLabel(email.verdict),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (emailVerdictIsError(email.verdict)) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
                // The email's own date when it survives, otherwise the moment we
                // processed it, labelled so the two are not read as the same thing.
                Text(
                    text = email.emailDate?.let { emailDate -> Formatting.dateTime(emailDate) }
                        ?: Strings.get(StringKey.InboxReceivedAt)
                            .format(Formatting.dateTime(email.receivedAt)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
            email.transaction?.let { transaction ->
                Text(
                    text = "${transaction.description} " +
                        Formatting.money(transaction.amount, transaction.currency),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            // Only worth naming when the importer actually retried, which only
            // ever happens on the failing path.
            if (email.attempts > 1) {
                Text(
                    text = Strings.get(StringKey.InboxAttempts).format(email.attempts.toString()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}
