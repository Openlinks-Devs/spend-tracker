package app.openlinks.spendtracker.data

/**
 * Pure mappers from app-side filter/page state to the backend's query params.
 * They return lists of pairs (not maps) so repeatable keys (account/category/tag)
 * survive; the ApiClient applies each pair via HttpUrl.Builder.addQueryParameter.
 *
 * The list and analytics endpoints disagree on one param, exactly like the web
 * client's toListRequestParams/toRequestParams split: the transactions list
 * filters by currency server-side, while analytics deliberately fetches every
 * currency at once so the currency switcher has all options to offer.
 */

private fun baseFilterParams(filters: TransactionFilters): List<Pair<String, String>> {
    val params = mutableListOf<Pair<String, String>>()
    if (filters.query.isNotBlank()) params += "q" to filters.query
    if (filters.range.isNotBlank()) params += "range" to filters.range
    filters.from?.let { from -> params += "from" to from }
    filters.to?.let { to -> params += "to" to to }
    filters.accountIds.forEach { accountId -> params += "account" to accountId }
    filters.categoryIds.forEach { categoryId -> params += "category" to categoryId }
    filters.tags.forEach { tag -> params += "tag" to tag }
    if (filters.tagMatch != "any") params += "tagMatch" to filters.tagMatch
    filters.amountMin?.let { amountMin -> params += "min" to amountMin.toString() }
    filters.amountMax?.let { amountMax -> params += "max" to amountMax.toString() }
    if (filters.type != "all") params += "type" to filters.type
    return params
}

/** Params for GET /api/transactions: every filter (currency included) plus paging. */
fun listQueryParams(filters: TransactionFilters, page: TransactionPage): List<Pair<String, String>> {
    val params = baseFilterParams(filters).toMutableList()
    filters.currency?.takeIf { currency -> currency.isNotBlank() }
        ?.let { currency -> params += "currency" to currency }
    params += "limit" to page.limit.toString()
    params += "offset" to page.offset.toString()
    page.sort?.let { sort -> params += "sort" to sort }
    return params
}

/**
 * Params for GET /api/transactions/analytics: the same filters minus currency
 * (the payload is bucketed per currency and the UI switches client-side), and
 * without paging, which the aggregate endpoint ignores.
 */
fun analyticsQueryParams(filters: TransactionFilters, bucket: String): List<Pair<String, String>> =
    baseFilterParams(filters) + ("bucket" to bucket)
