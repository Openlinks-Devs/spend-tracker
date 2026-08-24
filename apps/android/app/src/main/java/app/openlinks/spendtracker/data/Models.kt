package app.openlinks.spendtracker.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire models mirroring the backend /api payloads (see apps/backend/src/db/types.ts).
 * Field names use the backend's snake_case; @SerialName keeps Kotlin idiomatic where
 * it helps, but we keep names aligned with the JSON to avoid surprises.
 */

@Serializable
data class Transaction(
    val id: String,
    val description: String,
    val amount: Double,
    val currency: String,
    @SerialName("account_id") val accountId: String,
    @SerialName("category_id") val categoryId: String,
    val tags: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class NewTransaction(
    val description: String,
    val amount: Double,
    val currency: String,
    @SerialName("account_id") val accountId: String,
    @SerialName("category_id") val categoryId: String,
    val tags: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class TransactionUpdate(
    val description: String? = null,
    @SerialName("category_id") val categoryId: String? = null,
    val tags: List<String>? = null,
)

@Serializable
data class Account(
    val id: String,
    val name: String,
    val type: String,
    val currency: String,
)

@Serializable
data class Category(
    val id: String,
    val name: String,
    val type: String,
    /** Null for a root category. Categories nest to any depth. */
    @SerialName("parent_id") val parentId: String? = null,
    val emoji: String? = null,
)

/**
 * A transfer between two accounts. The client sends both legs fully resolved with
 * positive amounts; the backend signs them (money leaves the source, lands in the
 * destination) and inserts both in one transaction. Amounts may differ (fees) and
 * so may currencies (exchange).
 */
@Serializable
data class TransferInput(
    @SerialName("from_account_id") val fromAccountId: String,
    @SerialName("to_account_id") val toAccountId: String,
    @SerialName("from_amount") val fromAmount: Double,
    @SerialName("to_amount") val toAmount: Double,
    @SerialName("from_currency") val fromCurrency: String,
    @SerialName("to_currency") val toCurrency: String,
    @SerialName("from_category_id") val fromCategoryId: String,
    @SerialName("to_category_id") val toCategoryId: String,
    @SerialName("from_description") val fromDescription: String,
    @SerialName("to_description") val toDescription: String,
    val tags: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: String? = null,
)

/** The two transactions POST /api/transfers created. */
@Serializable
data class TransferResult(
    val from: Transaction,
    val to: Transaction,
)

/** A linked Gmail or Telegram integration, from GET /api/connections. */
@Serializable
data class Connection(
    val id: String,
    val provider: String,
    val status: String,
    @SerialName("external_id") val externalId: String,
    @SerialName("created_at") val createdAt: String,
)

/** POST /api/connections/gmail/link-url response. */
@Serializable
data class GmailLinkUrl(val url: String)

/** POST /api/connections/telegram/pair-code response. */
@Serializable
data class TelegramPairing(val deepLink: String)

/**
 * The transaction an imported email produced, as embedded in an email log row.
 * Deliberately not a full [Transaction]: the endpoint only carries enough to
 * label the link, and the detail screen fetches the rest by id.
 */
@Serializable
data class EmailTransactionRef(
    val id: String,
    val description: String,
    val amount: Double,
    val currency: String,
)

/**
 * One processed email, from GET /api/emails. [sender], [subject] and [emailDate]
 * are nullable twice over: historical rows predate the audit log, and the backend
 * clears sender and subject once a row is 30 days old, so the UI renders those as
 * unavailable rather than pretending.
 *
 * [verdict] stays a String rather than an enum so a value the backend adds later
 * renders raw instead of failing to decode.
 */
@Serializable
data class EmailLogItem(
    @SerialName("message_id") val messageId: String,
    @SerialName("connection_id") val connectionId: String,
    @SerialName("account_email") val accountEmail: String,
    val sender: String? = null,
    val subject: String? = null,
    @SerialName("email_date") val emailDate: String? = null,
    @SerialName("received_at") val receivedAt: String,
    val verdict: String,
    val attempts: Int = 0,
    val transaction: EmailTransactionRef? = null,
)

/**
 * A row's stable identity. The backend keys `import_source` on the pair, not on
 * the message id alone, so two connections that received the same message would
 * otherwise collide.
 */
fun emailRowKey(email: EmailLogItem): String = "${email.connectionId}/${email.messageId}"

/** Paginated list envelope returned by GET /api/emails. */
@Serializable
data class EmailListResponse(
    val items: List<EmailLogItem> = emptyList(),
    val total: Int = 0,
    val limit: Int = 0,
    val offset: Int = 0,
)

/** Envelope returned by POST /api/emails/{connectionId}/{messageId}/retry. */
@Serializable
data class EmailRetryResponse(
    val email: EmailLogItem,
)

/** Consistent backend error shape: { "error": string }. */
@Serializable
data class ApiError(
    val error: String,
)

/** Paginated list envelope returned by GET /api/transactions. */
@Serializable
data class TransactionListResponse(
    val items: List<Transaction> = emptyList(),
    val total: Int = 0,
    val limit: Int = 0,
    val offset: Int = 0,
)

/**
 * Analytics wire models mirroring GET /api/transactions/analytics. Unlike the
 * models above these rows are already camelCase on the wire, so no @SerialName
 * is needed to keep Kotlin idiomatic.
 */

@Serializable
data class SummaryRow(
    val currency: String,
    val income: Double,
    val spend: Double,
    val net: Double,
    val count: Int,
)

@Serializable
data class SeriesRow(
    val bucketStart: String,
    val currency: String,
    val income: Double,
    val spend: Double,
    val net: Double,
)

@Serializable
data class CategoryRow(
    val categoryId: String,
    val currency: String,
    val spend: Double,
    val income: Double,
    val net: Double,
    val count: Int,
)

@Serializable
data class TagRow(
    val tag: String,
    val currency: String,
    val spend: Double,
    val count: Int,
)

@Serializable
data class AccountRow(
    val accountId: String,
    val currency: String,
    val income: Double,
    val spend: Double,
    val net: Double,
    val count: Int,
)

@Serializable
data class AnalyticsPayload(
    val summary: List<SummaryRow> = emptyList(),
    val series: List<SeriesRow> = emptyList(),
    val byCategory: List<CategoryRow> = emptyList(),
    val byTag: List<TagRow> = emptyList(),
    val byAccount: List<AccountRow> = emptyList(),
)

/**
 * App-side filter and pagination state for the transaction list/analytics
 * screens. Not serialized directly; [filtersToQueryParams] maps these to the
 * backend's query params. [currency] is display-only and deliberately never
 * sent to the backend (mirrors the web client's request-vs-url split).
 */
data class TransactionFilters(
    val query: String = "",
    val range: String = "this-month",
    val from: String? = null,
    val to: String? = null,
    val accountIds: List<String> = emptyList(),
    val categoryIds: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val tagMatch: String = "any",
    val amountMin: Double? = null,
    val amountMax: Double? = null,
    val type: String = "all",
    val currency: String? = null,
)

data class TransactionPage(
    val limit: Int = 50,
    val offset: Int = 0,
    val sort: String? = null,
)
