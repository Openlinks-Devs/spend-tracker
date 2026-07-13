package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.TransactionFilters
import com.openlinks.spendtracker.data.TransactionPage
import com.openlinks.spendtracker.data.filtersToQueryParams
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionQueryTest {

    @Test
    fun defaultFiltersOnlyEmitRangeLimitAndOffset() {
        val params = filtersToQueryParams(TransactionFilters(), TransactionPage())

        assertEquals(
            listOf(
                "range" to "this-month",
                "limit" to "50",
                "offset" to "0",
            ),
            params,
        )
    }

    @Test
    fun repeatsAccountCategoryAndTagKeysForEachValue() {
        val filters = TransactionFilters(
            accountIds = listOf("acc-1", "acc-2"),
            categoryIds = listOf("cat-1", "cat-2", "cat-3"),
            tags = listOf("food", "rent"),
        )

        val params = filtersToQueryParams(filters, TransactionPage())

        assertEquals(
            listOf("acc-1", "acc-2"),
            params.filter { (key, _) -> key == "account" }.map { (_, value) -> value },
        )
        assertEquals(
            listOf("cat-1", "cat-2", "cat-3"),
            params.filter { (key, _) -> key == "category" }.map { (_, value) -> value },
        )
        assertEquals(
            listOf("food", "rent"),
            params.filter { (key, _) -> key == "tag" }.map { (_, value) -> value },
        )
    }

    @Test
    fun omitsTagMatchAndTypeWhenAtDefaults() {
        val params = filtersToQueryParams(TransactionFilters(), TransactionPage())

        assertFalse(params.any { (key, _) -> key == "tagMatch" })
        assertFalse(params.any { (key, _) -> key == "type" })
    }

    @Test
    fun includesTagMatchAndTypeWhenNonDefault() {
        val filters = TransactionFilters(tagMatch = "all", type = "income")

        val params = filtersToQueryParams(filters, TransactionPage())

        assertTrue(params.contains("tagMatch" to "all"))
        assertTrue(params.contains("type" to "income"))
    }

    @Test
    fun includesQueryMinMaxLimitAndOffsetWhenSet() {
        val filters = TransactionFilters(
            query = "coffee",
            amountMin = 5.0,
            amountMax = 100.0,
        )
        val page = TransactionPage(limit = 25, offset = 75, sort = "amount_desc")

        val params = filtersToQueryParams(filters, page)

        assertTrue(params.contains("q" to "coffee"))
        assertTrue(params.contains("min" to "5.0"))
        assertTrue(params.contains("max" to "100.0"))
        assertTrue(params.contains("limit" to "25"))
        assertTrue(params.contains("offset" to "75"))
        assertTrue(params.contains("sort" to "amount_desc"))
    }

    @Test
    fun includesFromAndToWhenSet() {
        val filters = TransactionFilters(range = "custom", from = "2026-01-01", to = "2026-01-31")

        val params = filtersToQueryParams(filters, TransactionPage())

        assertTrue(params.contains("from" to "2026-01-01"))
        assertTrue(params.contains("to" to "2026-01-31"))
    }

    @Test
    fun neverEmitsCurrencyParamEvenWhenSet() {
        val filters = TransactionFilters(currency = "USD")

        val params = filtersToQueryParams(filters, TransactionPage())

        assertFalse(params.any { (key, _) -> key == "currency" })
    }
}
