package com.openlinks.spendtracker

import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.ui.FormResult
import com.openlinks.spendtracker.ui.TransactionFormInput
import com.openlinks.spendtracker.ui.TransactionFormValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionFormValidatorTest {

    @Test
    fun validInputParsesAndSplitsTags() {
        val result = TransactionFormValidator.validate(
            TransactionFormInput(
                description = "  Coffee ",
                amount = "-4.50",
                currency = "usd ".trim(),
                accountId = "acc-1",
                categoryId = "cat-1",
                tags = "food, , morning ,",
            ),
        )
        assertTrue(result is FormResult.Valid)
        val value = (result as FormResult.Valid).value
        assertEquals("Coffee", value.description)
        assertEquals(-4.50, value.amount, 0.0001)
        assertEquals("acc-1", value.accountId)
        assertEquals("cat-1", value.categoryId)
        assertEquals(listOf("food", "morning"), value.tags)
    }

    @Test
    fun blankCurrencyDefaultsToUsd() {
        val result = TransactionFormValidator.validate(
            TransactionFormInput("t", "1", "", "acc-1", "cat-1", ""),
        )
        assertTrue(result is FormResult.Valid)
        assertEquals("USD", (result as FormResult.Valid).value.currency)
    }

    @Test
    fun missingFieldsReportEveryError() {
        val result = TransactionFormValidator.validate(
            TransactionFormInput(
                description = "  ",
                amount = "not-a-number",
                currency = "USD",
                accountId = null,
                categoryId = null,
                tags = "",
            ),
        )
        assertTrue(result is FormResult.Invalid)
        val errors = (result as FormResult.Invalid).errors
        assertTrue(errors.contains(StringKey.ValidationDescriptionRequired))
        assertTrue(errors.contains(StringKey.ValidationAmountInvalid))
        assertTrue(errors.contains(StringKey.ValidationAccountRequired))
        assertTrue(errors.contains(StringKey.ValidationCategoryRequired))
    }

    @Test
    fun amountWithThousandsSeparatorParses() {
        val result = TransactionFormValidator.validate(
            TransactionFormInput("Rent", "1,200.00", "USD", "acc-1", "cat-1", ""),
        )
        assertTrue(result is FormResult.Valid)
        assertEquals(1200.0, (result as FormResult.Valid).value.amount, 0.0001)
    }
}
