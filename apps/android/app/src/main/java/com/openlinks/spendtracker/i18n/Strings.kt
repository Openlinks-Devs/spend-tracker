package com.openlinks.spendtracker.i18n

/**
 * Central i18n table. Every visible string in the UI resolves through here so a
 * second locale can be added by swapping the map, and so no screen hardcodes copy.
 */
enum class StringKey {
    AppTitle,
    NavSummary,
    NavTransactions,
    SummaryTitle,
    SummaryTotalBalance,
    SummaryTotalSpend,
    SummaryTransactionCount,
    SummaryRecent,
    SummaryEmpty,
    TransactionsTitle,
    TransactionsEmpty,
    TransactionDetailTitle,
    FieldDescription,
    FieldAmount,
    FieldCurrency,
    FieldAccount,
    FieldCategory,
    FieldTags,
    FieldCreatedAt,
    FieldUpdatedAt,
    FieldNone,
    FormCreateTitle,
    FormEditTitle,
    ActionAdd,
    ActionSave,
    ActionEdit,
    ActionDelete,
    ActionCancel,
    ActionRetry,
    ActionBack,
    StateLoading,
    ErrorGeneric,
    ValidationDescriptionRequired,
    ValidationAmountInvalid,
    ValidationAccountRequired,
    TagsHint,
}

/** Simple locale-aware lookup. English is the only bundled locale for now. */
object Strings {
    private val english: Map<StringKey, String> = mapOf(
        StringKey.AppTitle to "SpendTracker",
        StringKey.NavSummary to "Summary",
        StringKey.NavTransactions to "Transactions",
        StringKey.SummaryTitle to "Summary",
        StringKey.SummaryTotalBalance to "Net total",
        StringKey.SummaryTotalSpend to "Total spend",
        StringKey.SummaryTransactionCount to "Transactions",
        StringKey.SummaryRecent to "Recent transactions",
        StringKey.SummaryEmpty to "No transactions yet",
        StringKey.TransactionsTitle to "Transactions",
        StringKey.TransactionsEmpty to "No transactions yet. Tap + to add one.",
        StringKey.TransactionDetailTitle to "Transaction",
        StringKey.FieldDescription to "Description",
        StringKey.FieldAmount to "Amount",
        StringKey.FieldCurrency to "Currency",
        StringKey.FieldAccount to "Account",
        StringKey.FieldCategory to "Category",
        StringKey.FieldTags to "Tags",
        StringKey.FieldCreatedAt to "Created",
        StringKey.FieldUpdatedAt to "Updated",
        StringKey.FieldNone to "None",
        StringKey.FormCreateTitle to "New transaction",
        StringKey.FormEditTitle to "Edit transaction",
        StringKey.ActionAdd to "Add",
        StringKey.ActionSave to "Save",
        StringKey.ActionEdit to "Edit",
        StringKey.ActionDelete to "Delete",
        StringKey.ActionCancel to "Cancel",
        StringKey.ActionRetry to "Retry",
        StringKey.ActionBack to "Back",
        StringKey.StateLoading to "Loading...",
        StringKey.ErrorGeneric to "Something went wrong",
        StringKey.ValidationDescriptionRequired to "Description is required",
        StringKey.ValidationAmountInvalid to "Enter a valid amount",
        StringKey.ValidationAccountRequired to "Select an account",
        StringKey.TagsHint to "Comma-separated tags",
    )

    private val locales: Map<String, Map<StringKey, String>> = mapOf("en" to english)

    fun get(key: StringKey, locale: String = "en"): String =
        locales[locale]?.get(key) ?: english[key] ?: key.name
}
