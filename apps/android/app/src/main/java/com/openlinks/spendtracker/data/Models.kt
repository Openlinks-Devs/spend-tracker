package com.openlinks.spendtracker.data

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
