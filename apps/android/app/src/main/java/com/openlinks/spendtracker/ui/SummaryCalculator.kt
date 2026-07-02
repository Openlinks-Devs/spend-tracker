package com.openlinks.spendtracker.ui

import com.openlinks.spendtracker.data.Transaction

/**
 * Derived totals for the summary screen. Kept as a pure function so the numbers
 * are unit-testable without any Android or network dependency.
 *
 * Convention: negative amounts are spend (money out), positive amounts are income.
 * [netTotal] is the signed sum; [totalSpend] is the magnitude of outflows only.
 */
data class SummaryTotals(
    val netTotal: Double,
    val totalSpend: Double,
    val transactionCount: Int,
    val currency: String,
)

object SummaryCalculator {
    fun compute(transactions: List<Transaction>): SummaryTotals {
        val netTotal = transactions.sumOf { transaction -> transaction.amount }
        val totalSpend = transactions
            .filter { transaction -> transaction.amount < 0 }
            .sumOf { transaction -> -transaction.amount }
        val currency = transactions.firstOrNull()?.currency ?: "USD"
        return SummaryTotals(
            netTotal = netTotal,
            totalSpend = totalSpend,
            transactionCount = transactions.size,
            currency = currency,
        )
    }
}
