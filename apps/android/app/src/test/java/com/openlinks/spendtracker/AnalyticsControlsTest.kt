package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.SummaryRow
import com.openlinks.spendtracker.ui.screens.currenciesIn
import com.openlinks.spendtracker.ui.screens.summaryRowFor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AnalyticsControlsTest {

    private val usdRow = SummaryRow(currency = "USD", income = 100.0, spend = 40.0, net = 60.0, count = 3)
    private val eurRow = SummaryRow(currency = "EUR", income = 20.0, spend = 5.0, net = 15.0, count = 1)

    @Test
    fun currenciesInReturnsDistinctCurrenciesInFirstSeenOrder() {
        val summary = listOf(usdRow, eurRow, usdRow.copy(income = 200.0))

        val currencies = currenciesIn(summary)

        assertEquals(listOf("USD", "EUR"), currencies)
    }

    @Test
    fun currenciesInReturnsEmptyListForEmptySummary() {
        assertEquals(emptyList<String>(), currenciesIn(emptyList()))
    }

    @Test
    fun summaryRowForReturnsMatchingRow() {
        val summary = listOf(usdRow, eurRow)

        val row = summaryRowFor(summary, "EUR")

        assertEquals(eurRow, row)
    }

    @Test
    fun summaryRowForReturnsNullWhenCurrencyMissing() {
        val summary = listOf(usdRow, eurRow)

        val row = summaryRowFor(summary, "GBP")

        assertNull(row)
    }

    @Test
    fun summaryRowForReturnsNullWhenCurrencyIsNull() {
        val summary = listOf(usdRow, eurRow)

        val row = summaryRowFor(summary, null)

        assertNull(row)
    }
}
