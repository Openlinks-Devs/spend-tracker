package com.openlinks.spendtracker.ui

import java.util.Locale
import kotlin.math.abs

/** Deterministic amount formatting shared by the screens (and unit-testable). */
object Formatting {
    fun money(amount: Double, currency: String): String {
        val sign = if (amount < 0) "-" else ""
        val magnitude = abs(amount)
        val formatted = String.format(Locale.US, "%,.2f", magnitude)
        return "$sign$currency $formatted"
    }
}
