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
    @SerialName("category_id") val categoryId: String? = null,
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
