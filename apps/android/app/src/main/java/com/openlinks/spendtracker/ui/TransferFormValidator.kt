package com.openlinks.spendtracker.ui

import com.openlinks.spendtracker.data.Account
import com.openlinks.spendtracker.data.TransferInput
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings

/** Raw text captured from the transfer form, before validation. */
data class TransferFormInput(
    val fromAccountId: String?,
    val toAccountId: String?,
    val fromAmount: String,
    val toAmount: String,
    val fromCategoryId: String?,
    val toCategoryId: String?,
    val description: String,
    val tags: String,
)

sealed interface TransferFormResult {
    data class Valid(val value: TransferInput) : TransferFormResult
    data class Invalid(val errors: List<StringKey>) : TransferFormResult
}

/**
 * Pure validation for the transfer form, unit-testable without Compose. Mirrors
 * the web dialog: both legs need an account, a positive amount and a category,
 * the two accounts must differ, each leg's currency comes from its own account
 * (so an exchange records the real currencies), and an empty description falls
 * back to "Transfer to/from <account>".
 */
object TransferFormValidator {
    fun validate(input: TransferFormInput, accounts: List<Account>): TransferFormResult {
        val errors = mutableListOf<StringKey>()

        val fromAccount = accounts.firstOrNull { account -> account.id == input.fromAccountId }
        val toAccount = accounts.firstOrNull { account -> account.id == input.toAccountId }
        if (fromAccount == null || toAccount == null) errors.add(StringKey.ValidationAccountRequired)
        if (fromAccount != null && fromAccount.id == toAccount?.id) {
            errors.add(StringKey.ValidationSameAccount)
        }

        val fromAmount = parseAmount(input.fromAmount)
        val toAmount = parseAmount(input.toAmount)
        if (fromAmount == null || toAmount == null) errors.add(StringKey.ValidationAmountInvalid)

        val fromCategoryId = input.fromCategoryId?.takeIf { id -> id.isNotBlank() }
        val toCategoryId = input.toCategoryId?.takeIf { id -> id.isNotBlank() }
        if (fromCategoryId == null || toCategoryId == null) {
            errors.add(StringKey.ValidationCategoryRequired)
        }

        if (errors.isNotEmpty()) return TransferFormResult.Invalid(errors)

        val description = input.description.trim()
        val tags = input.tags.split(",")
            .map { tag -> tag.trim() }
            .filter { tag -> tag.isNotEmpty() }

        return TransferFormResult.Valid(
            TransferInput(
                fromAccountId = fromAccount!!.id,
                toAccountId = toAccount!!.id,
                fromAmount = fromAmount!!,
                toAmount = toAmount!!,
                fromCurrency = fromAccount.currency,
                toCurrency = toAccount.currency,
                fromCategoryId = fromCategoryId!!,
                toCategoryId = toCategoryId!!,
                fromDescription = description.ifEmpty {
                    Strings.get(StringKey.TransferDefaultOutDescription).format(toAccount.name)
                },
                toDescription = description.ifEmpty {
                    Strings.get(StringKey.TransferDefaultInDescription).format(fromAccount.name)
                },
                tags = tags,
            ),
        )
    }

    // Positive amounts only: the backend signs the legs itself.
    private fun parseAmount(raw: String): Double? =
        raw.trim().replace(",", "").toDoubleOrNull()?.takeIf { amount -> amount > 0 }
}
