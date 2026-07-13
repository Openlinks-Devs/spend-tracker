package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.SummaryRow
import com.openlinks.spendtracker.ui.mostUsedCurrency
import com.openlinks.spendtracker.ui.resolveDisplayCurrency
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CurrencyResolverTest {

    private fun summaryRow(currency: String, count: Int) = SummaryRow(
        currency = currency,
        income = 0.0,
        spend = 0.0,
        net = 0.0,
        count = count,
    )

    @Test
    fun mostUsedCurrencyReturnsCurrencyWithHighestCount() {
        val summary = listOf(
            summaryRow("USD", count = 2),
            summaryRow("EUR", count = 5),
        )
        assertEquals("EUR", mostUsedCurrency(summary))
    }

    @Test
    fun mostUsedCurrencyReturnsNullForEmptySummary() {
        assertNull(mostUsedCurrency(emptyList()))
    }

    @Test
    fun resolveDisplayCurrencyHonorsPreferenceWhenPresentInSummary() {
        val summary = listOf(
            summaryRow("USD", count = 5),
            summaryRow("EUR", count = 1),
        )
        assertEquals("EUR", resolveDisplayCurrency("EUR", summary))
    }

    @Test
    fun resolveDisplayCurrencyFallsBackToMostUsedWhenPreferenceAbsent() {
        val summary = listOf(
            summaryRow("USD", count = 2),
            summaryRow("EUR", count = 5),
        )
        assertEquals("EUR", resolveDisplayCurrency("GBP", summary))
    }

    @Test
    fun resolveDisplayCurrencyFallsBackToMostUsedWhenPreferenceNull() {
        val summary = listOf(
            summaryRow("USD", count = 2),
            summaryRow("EUR", count = 5),
        )
        assertEquals("EUR", resolveDisplayCurrency(null, summary))
    }

    @Test
    fun resolveDisplayCurrencyReturnsNullForEmptySummaryRegardlessOfPreference() {
        assertNull(resolveDisplayCurrency("USD", emptyList()))
    }
}
