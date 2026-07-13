package com.openlinks.spendtracker.ui

import com.openlinks.spendtracker.data.SummaryRow

/**
 * Picks which currency the dashboard should render totals in, derived from the
 * current analytics summary rather than a fixed default, so the app follows
 * whichever currency the user actually transacts in most.
 */

/** The currency with the highest transaction count in [summary], or null if empty. */
fun mostUsedCurrency(summary: List<SummaryRow>): String? =
    summary.maxByOrNull { row -> row.count }?.currency

/**
 * Honors [preference] (e.g. a filter's explicit currency) when it appears in
 * [summary]; otherwise falls back to [mostUsedCurrency].
 */
fun resolveDisplayCurrency(preference: String?, summary: List<SummaryRow>): String? {
    if (preference != null && summary.any { row -> row.currency == preference }) return preference
    return mostUsedCurrency(summary)
}
