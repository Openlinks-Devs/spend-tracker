# Transaction search, filters, and analytics charts

Date: 2026-07-12
Branch: `feature/transaction-analytics` (based on `main`)

## Base and relationship to multicurrency

This is intentionally separate, independent work built on `main`, which already
carries the 2026-stack modernization (responsive layout, loading components,
date/time formatting). It does NOT build on `feature/multicurrency-p0`.

Note the accepted tradeoff: `feature/multicurrency-p0` (unmerged, 83 commits ahead
of `main`) already has a parallel search + filter implementation tangled with the
multicurrency schema (`base_amount`, transfers, rates), so it cannot be cleanly
reused here. We build search + filters fresh on `main`. The only piece we port is
the `EChart.tsx` wrapper and the `echarts` dependency, reproduced verbatim so both
branches share the same wrapper pattern. If both branches ever merge, the two
filter/search implementations will need reconciliation.

## Goal

Turn the spend tracker into a data-rich analytics surface: a single search bar,
an optional collapsible filter panel, and useful charts. Search, filters, and
charts all read from one shared filter set. The same filter set drives both the
Dashboard and the Transactions page, and clicking a chart segment drills into the
matching filtered transaction list.

## Research basis

Studied Monarch, YNAB, Copilot Money, and Lunch Money. Converging patterns we adopt:

- Two-tier filtering: an always-visible search box plus a collapsible advanced panel.
- One filter model drives both the list and every chart.
- Live totals (income / spend / net) recompute for the current search + filter set.
- Date-range presets plus a custom range are the master control that also scopes charts.
- Plain-text search, no operator syntax (YNAB `field:value` operators deferred).
- Click a chart segment to drill into the matching filtered transactions.

## Data model (existing)

`transactions`: `id`, `description`, `amount numeric(14,2)`, `currency text`,
`account_id`, `category_id`, `tags text[]`, `created_at timestamptz`, `updated_at`.
Sign convention: `amount < 0` is spend, `amount > 0` is income.

## Filter model (single source of truth = URL query params)

A `useTransactionFilters()` hook parses and serializes the filter set through
React Router `useSearchParams`. Parameters:

- `q`: free-text search string.
- `range`: preset key (`this-month`, `last-3-months`, `this-year`, `all`) OR
  `from` / `to` ISO dates for a custom range.
- `account`: repeatable account id (multi-select).
- `category`: repeatable category id (multi-select).
- `tag`: repeatable tag name (multi-select) plus `tagMatch` = `all` | `any`.
- `min` / `max`: amount bounds (absolute value, applied to spend/income magnitude).
- `type`: `all` | `income` | `expense`.
- `currency`: the currency whose aggregates the charts display (defaults to the
  most-used currency in the current result set).
- List-only: `sort`, `limit`, `offset`.

Because the filter set lives in the URL, it survives navigation. Dashboard and
Transactions share one state. A chart drill-down navigates to
`/transactions?<current filters>&category=<id>` (or `tag=`, or a date window).

## Backend (server-side SQL)

### `buildTransactionFilter(params)`

The single translator from filter params to a parameterized SQL `WHERE` clause
plus an ordered parameter array. Reused by the list query and the analytics query.
This is the core unit and is tested in isolation.

- Search: `description ILIKE '%' || $n || '%'` with `%` and `_` escaped.
- Tags: `tags && $n::text[]` for `any`, `tags @> $n::text[]` for `all`.
- Type: `amount < 0` for expense, `amount > 0` for income.
- Amount range: `abs(amount) >= $min` / `abs(amount) <= $max`.
- Date range: `created_at >= $from` / `created_at < $to` (presets resolved to bounds
  server-side so client and server agree).
- Accounts / categories: `account_id = ANY($ids)` / `category_id = ANY($ids)`.

### Endpoints

- `GET /api/transactions` gains the filter params plus pagination. Returns
  `{ items, total, limit, offset }`. Default `limit` 50, `sort` `created_at desc`.
- `GET /api/transactions/analytics?bucket=day|week|month` returns
  `{ summary, series, byCategory, byTag }`. Every aggregate is **grouped by
  currency** so sums never cross currencies:
  - `summary`: `[{ currency, income, spend, net, count }]`.
  - `series`: `[{ bucketStart, currency, income, spend, net }]`, bucketed via
    `date_trunc(bucket, created_at)`.
  - `byCategory`: `[{ categoryId, currency, spend, income, net, count }]`.
  - `byTag`: `[{ tag, currency, spend, count }]` (unnest `tags`).

FX conversion is out of scope; it belongs to the multicurrency workstream.

## Web components (each has one job)

- `useTransactionFilters()`: parse/serialize URL params; the only place that knows
  the query-string shape.
- `useTransactionsQuery(filters)`: React Query for the paginated list, keyed on the
  serialized filters.
- `useTransactionAnalytics(filters, bucket)`: React Query for the analytics payload.
- `SearchBar`: debounced input bound to `q`.
- `FilterPanel`: collapsible advanced filters. Reuses the repo's existing Radix
  Select / Popover / Calendar primitives. Date presets + custom range, account
  multi-select, category multi-select, tag multi-select + ALL/ANY, amount range, type.
- `FilterChips`: always-visible active-filter summary with per-chip remove and Clear all.
- `SummaryTiles`: live KPI tiles (income / spend / net / count) for the selected currency.
- `charts/CategoryPieChart`, `charts/SpendingOverTimeChart`,
  `charts/IncomeExpenseChart`, `charts/TagBarChart`, `charts/SpendCalendarHeatmap`.
  Each builds an ECharts `option` object and renders it through the shared
  `EChart` wrapper (ported from `feature/multicurrency-p0`): the wrapper owns
  init, resize observer, and dispose. Extend the wrapper's `echarts.use([...])`
  registration with the modules the new charts need (`LineChart`, `LegendComponent`,
  `HeatmapChart`, `CalendarComponent`, `VisualMapComponent`). Colors come from a
  shared palette so light and dark match.
- Click-to-drill-down: because `EChart` currently exposes only `option`, extend it
  with an optional `onEvents` prop so charts can subscribe to `click` for drill-down.
- `CurrencySwitcher`: picks which currency's aggregates the charts show.
- `AnalyticsSection`: composes `SummaryTiles` + the charts. Rendered by BOTH the
  Dashboard and the Transactions page.

## Charts (ECharts, all filterable, click-to-drill)

1. Spending by category: donut. Click a slice to drill into that category.
2. Spending over time: bar, with a day / week / month bucket toggle.
3. Income vs expense: grouped bars per bucket with a net line overlay.
4. Spending by tag: horizontal bars.
5. Spend calendar heatmap: GitHub-style calendar shaded by daily spend.

Prior-period comparison overlays are a documented follow-up, not built now.

## Pagination

The Transactions list keeps day-grouping in the UI but pages the server results
(`limit` / `offset`, "load more"). The Dashboard shows the analytics section plus a
short recent slice.

## Currency handling

All aggregates are grouped by currency. The charts and KPI tiles show one currency
at a time via `CurrencySwitcher`, defaulting to the most-used currency in the result
set. Sums never cross currencies. No FX conversion in this work.

## Testing

- Backend: unit tests for `buildTransactionFilter` (every dimension, ALL vs ANY tags,
  type sign, amount bounds, date-preset resolution, ILIKE escaping) and route
  integration tests for the list and analytics endpoints against the test DB
  (`apps/backend/test` exists).
- Web: round-trip tests for `useTransactionFilters` serialize/parse and any pure
  formatting/aggregation helpers.

## Out of scope

- FX / currency conversion (owned by the multicurrency workstream).
- YNAB-style `field:value` search operators.
- Saved views / saved filters.
- Prior-period comparison overlays.
- Android client changes (web + backend only).
