package com.openlinks.spendtracker.data

/**
 * Pure mapper from app-side filter/page state to the backend's query params.
 * Returns a list of pairs (not a map) so repeatable keys (account/category/tag)
 * survive; the ApiClient applies each pair via HttpUrl.Builder.addQueryParameter.
 *
 * currency is display-only and is deliberately never emitted here.
 */
fun filtersToQueryParams(filters: TransactionFilters, page: TransactionPage): List<Pair<String, String>> {
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
    // currency is display-only; deliberately NOT sent to the backend.
    params += "limit" to page.limit.toString()
    params += "offset" to page.offset.toString()
    page.sort?.let { sort -> params += "sort" to sort }
    return params
}
