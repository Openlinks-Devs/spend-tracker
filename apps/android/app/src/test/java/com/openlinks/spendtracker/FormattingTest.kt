package com.openlinks.spendtracker

import com.openlinks.spendtracker.ui.Formatting
import org.junit.Assert.assertEquals
import org.junit.Test

class FormattingTest {

    @Test
    fun positiveAmountHasNoSign() {
        assertEquals("USD 1,200.00", Formatting.money(1200.0, "USD"))
    }

    @Test
    fun negativeAmountKeepsSignBeforeCurrency() {
        assertEquals("-EUR 4.50", Formatting.money(-4.5, "EUR"))
    }

    @Test
    fun roundsToTwoDecimals() {
        assertEquals("USD 0.10", Formatting.money(0.1, "USD"))
    }
}
