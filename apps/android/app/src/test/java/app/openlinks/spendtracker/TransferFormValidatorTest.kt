package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.Account
import app.openlinks.spendtracker.data.Category
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.ui.TransferFormInput
import app.openlinks.spendtracker.ui.TransferFormResult
import app.openlinks.spendtracker.ui.TransferFormValidator
import app.openlinks.spendtracker.ui.screens.defaultTransferCategoryId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferFormValidatorTest {

    private val accounts = listOf(
        Account(id = "acc-usd", name = "Checking", type = "bank", currency = "USD"),
        Account(id = "acc-pen", name = "Soles", type = "bank", currency = "PEN"),
    )

    private fun input(
        fromAccountId: String? = "acc-usd",
        toAccountId: String? = "acc-pen",
        fromAmount: String = "100",
        toAmount: String = "370",
        fromCategoryId: String? = "cat-out",
        toCategoryId: String? = "cat-in",
        description: String = "",
        tags: String = "transfer",
    ) = TransferFormInput(
        fromAccountId = fromAccountId,
        toAccountId = toAccountId,
        fromAmount = fromAmount,
        toAmount = toAmount,
        fromCategoryId = fromCategoryId,
        toCategoryId = toCategoryId,
        description = description,
        tags = tags,
    )

    private fun validate(input: TransferFormInput) = TransferFormValidator.validate(input, accounts)

    @Test
    fun eachLegTakesItsOwnAccountCurrency() {
        val result = validate(input())

        assertTrue(result is TransferFormResult.Valid)
        val transfer = (result as TransferFormResult.Valid).value
        assertEquals("USD", transfer.fromCurrency)
        assertEquals("PEN", transfer.toCurrency)
        assertEquals(100.0, transfer.fromAmount, 0.0)
        assertEquals(370.0, transfer.toAmount, 0.0)
    }

    @Test
    fun amountsAreSentPositiveForTheBackendToSign() {
        val transfer = (validate(input()) as TransferFormResult.Valid).value

        assertTrue(transfer.fromAmount > 0)
        assertTrue(transfer.toAmount > 0)
    }

    @Test
    fun anEmptyDescriptionFallsBackToTheAccountNames() {
        val transfer = (validate(input(description = "")) as TransferFormResult.Valid).value

        assertEquals("Transfer to Soles", transfer.fromDescription)
        assertEquals("Transfer from Checking", transfer.toDescription)
    }

    @Test
    fun anExplicitDescriptionIsUsedForBothLegs() {
        val transfer = (validate(input(description = "  Rent money  ")) as TransferFormResult.Valid).value

        assertEquals("Rent money", transfer.fromDescription)
        assertEquals("Rent money", transfer.toDescription)
    }

    @Test
    fun tagsAreSplitTrimmedAndBlanksDropped() {
        val transfer = (validate(input(tags = "transfer, , exchange ")) as TransferFormResult.Valid).value

        assertEquals(listOf("transfer", "exchange"), transfer.tags)
    }

    @Test
    fun theSameAccountOnBothSidesIsRejected() {
        val result = validate(input(toAccountId = "acc-usd"))

        assertTrue(result is TransferFormResult.Invalid)
        assertTrue((result as TransferFormResult.Invalid).errors.contains(StringKey.ValidationSameAccount))
    }

    @Test
    fun nonPositiveOrUnparseableAmountsAreRejected() {
        listOf("0", "-5", "abc", "").forEach { badAmount ->
            val result = validate(input(fromAmount = badAmount))
            assertTrue(
                "expected $badAmount to be rejected",
                result is TransferFormResult.Invalid &&
                    result.errors.contains(StringKey.ValidationAmountInvalid),
            )
        }
    }

    @Test
    fun aMissingCategoryOnEitherLegIsRejected() {
        val result = validate(input(toCategoryId = null))

        assertTrue(result is TransferFormResult.Invalid)
        assertTrue((result as TransferFormResult.Invalid).errors.contains(StringKey.ValidationCategoryRequired))
    }

    @Test
    fun anUnknownAccountIsRejected() {
        val result = validate(input(fromAccountId = "acc-missing"))

        assertTrue(result is TransferFormResult.Invalid)
        assertTrue((result as TransferFormResult.Invalid).errors.contains(StringKey.ValidationAccountRequired))
    }

    @Test
    fun defaultCategoriesPreferTheBalancePair() {
        val categories = listOf(
            Category(id = "cat-food", name = "Food", type = "expense"),
            Category(id = "cat-out", name = "Balance -", type = "expense"),
            Category(id = "cat-in", name = "Balance +", type = "income"),
        )

        assertEquals("cat-out", defaultTransferCategoryId(categories, "Balance -"))
        assertEquals("cat-in", defaultTransferCategoryId(categories, "Balance +"))
    }

    @Test
    fun defaultCategoriesFallBackToTheFirstWhenBalanceIsMissing() {
        val categories = listOf(Category(id = "cat-food", name = "Food", type = "expense"))

        assertEquals("cat-food", defaultTransferCategoryId(categories, "Balance -"))
    }
}
