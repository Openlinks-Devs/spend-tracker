package com.openlinks.spendtracker.ui

import com.openlinks.spendtracker.i18n.StringKey

/** Raw text captured from the form fields, before validation. */
data class TransactionFormInput(
    val description: String,
    val amount: String,
    val currency: String,
    val accountId: String?,
    val categoryId: String?,
    val tags: String,
)

/** Cleaned, validated values ready to send to the backend. */
data class ValidatedTransaction(
    val description: String,
    val amount: Double,
    val currency: String,
    val accountId: String,
    val categoryId: String?,
    val tags: List<String>,
)

sealed interface FormResult {
    data class Valid(val value: ValidatedTransaction) : FormResult
    data class Invalid(val errors: List<StringKey>) : FormResult
}

/**
 * Pure validation shared by create and edit, so the rules are unit-testable
 * without touching Compose. Tags are split on commas and trimmed; blanks dropped.
 */
object TransactionFormValidator {
    fun validate(input: TransactionFormInput): FormResult {
        val errors = mutableListOf<StringKey>()

        val description = input.description.trim()
        if (description.isEmpty()) errors.add(StringKey.ValidationDescriptionRequired)

        val amount = input.amount.trim().replace(",", "").toDoubleOrNull()
        if (amount == null) errors.add(StringKey.ValidationAmountInvalid)

        val accountId = input.accountId?.takeIf { it.isNotBlank() }
        if (accountId == null) errors.add(StringKey.ValidationAccountRequired)

        if (errors.isNotEmpty()) return FormResult.Invalid(errors)

        val currency = input.currency.trim().ifEmpty { "USD" }
        val tags = input.tags.split(",")
            .map { tag -> tag.trim() }
            .filter { tag -> tag.isNotEmpty() }

        return FormResult.Valid(
            ValidatedTransaction(
                description = description,
                amount = amount!!,
                currency = currency,
                accountId = accountId!!,
                categoryId = input.categoryId?.takeIf { it.isNotBlank() },
                tags = tags,
            ),
        )
    }
}
