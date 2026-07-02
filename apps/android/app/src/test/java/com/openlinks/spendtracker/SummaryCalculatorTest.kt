package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.ui.SummaryCalculator
import org.junit.Assert.assertEquals
import org.junit.Test

class SummaryCalculatorTest {

    private fun transaction(amount: Double, currency: String = "USD") = Transaction(
        id = "id-$amount",
        description = "t",
        amount = amount,
        currency = currency,
        accountId = "acc",
        categoryId = "cat",
        tags = emptyList(),
        createdAt = "2026-07-02T00:00:00Z",
        updatedAt = null,
    )

    @Test
    fun emptyListProducesZeros() {
        val totals = SummaryCalculator.compute(emptyList())
        assertEquals(0.0, totals.netTotal, 0.0001)
        assertEquals(0.0, totals.totalSpend, 0.0001)
        assertEquals(0, totals.transactionCount)
        assertEquals("USD", totals.currency)
    }

    @Test
    fun netTotalIsSignedSumAndSpendIsOutflowMagnitude() {
        val totals = SummaryCalculator.compute(
            listOf(
                transaction(-25.50),
                transaction(-4.50),
                transaction(100.0),
            ),
        )
        assertEquals(70.0, totals.netTotal, 0.0001)
        assertEquals(30.0, totals.totalSpend, 0.0001)
        assertEquals(3, totals.transactionCount)
    }

    @Test
    fun currencyComesFromFirstTransaction() {
        val totals = SummaryCalculator.compute(listOf(transaction(-1.0, "EUR")))
        assertEquals("EUR", totals.currency)
    }
}
