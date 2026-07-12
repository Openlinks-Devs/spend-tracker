# Multicurrency money tracker: feature research

This document consolidates feature research on best-in-class personal finance apps into an implementation reference for upgrading this spend tracker into a serious multicurrency money tracker. Reference apps: Firefly III, Actual Budget, YNAB, Toshl, Cashew, Ivy Wallet, Spendee, Wallet by BudgetBakers, Monarch, PocketSmith, Lunch Money, Money Manager Ex (MMEX), GnuCash, and the plain-text tools Beancount, Ledger, and hledger. Every feature below is described concretely enough to implement without going back to the source apps.

## 1. Transaction entry

### 1.1 Amount input

- Sign comes from type, not from a typed minus. No surveyed app makes the user type a negative number. Firefly III, Ivy Wallet, Toshl, Cashew, and MMEX derive the sign from an explicit transaction type (expense/withdrawal, income/deposit, transfer) chosen before or above the amount. YNAB instead uses two separate register columns, Outflow and Inflow.
- Math in the amount field: YNAB accepts `+ - x /` typed directly in the amount field (buttons on mobile, keyboard on desktop) and evaluates the expression. Ivy Wallet ships a full calculator keypad as the amount screen, useful for cash and bill splits. The amount input should double as a calculator.
- Decimal handling: Toshl accepts either comma or period as the decimal separator regardless of locale. Cashew respects per-account decimal precision (up to 12 digits). Best practice: format and limit decimals per the selected currency's decimal places, not globally.
- Clipboard: Cashew supports long-press copy/paste on amount fields.

### 1.2 Currency, foreign amount, exchange rate

- Default from account, overridable per transaction: the dominant pattern. Spendee sets currency per wallet but lets any single transaction override it, with an editable exchange rate, and shows the amount in both native and main currency. Wallet by BudgetBakers is stricter: a record always adopts the currency of the selected account, and recording another currency means picking an account in that currency. Per-record currency is the top community request against that model.
- Best currency picker (Toshl): the currency symbol next to the amount is tappable; it opens a searchable list of all currencies with the 5 most recently used pinned on top, each showing a suggested exchange rate. The suggested rate is editable inline: delete it and type your own, or tap either the foreign amount or the main-currency amount and the other recalculates. The last-used currency sticks as the default for the next entry.
- Best data model (Firefly III): every transaction has an optional foreign currency plus foreign amount pair alongside the native amount. If the user fills the foreign amount, Firefly uses it verbatim instead of any rate-derived value, on the principle that the user knows the real converted amount better than any rate table, which matters because banks apply steep spreads. Rates are auto-downloaded but user-overridable.
- Frozen conversion at entry (Cashew): a one-tap conversion button inside amount entry converts a typed foreign amount into the account currency using daily-updated rates; the converted value is frozen at entry time so later rate changes never rewrite history. Custom per-pair rates are configurable.
- Repeat plus currency interaction (Toshl): for a recurring entry in a foreign currency, the user chooses whether each repetition takes a fresh rate on its day or keeps the original rate. No other app surfaces this decision.
- Counterexamples: YNAB and Actual Budget are single-currency per budget file; MMEX locks the amount field to the account currency.

### 1.3 The other fields

- Date/time: defaults to today everywhere. Toshl groups future-dated entries as "planned" atop the list. Actual's `T` shortcut opens a new transaction with the date picker already focused. Firefly III also stores meta-dates (interest, booking, processing).
- Payee/description autocomplete: YNAB's payee field autocompletes and doubles as the transfer mechanism (payees named "Transfer to/from: Account"); picking a known payee pre-fills the last category used with that payee. Actual does the same payee-as-transfer trick. Cashew goes further: typing a known title auto-selects its remembered category and subcategory. Firefly III autocompletes description, payee (expense account), and source/destination account fields, and free-typing a new expense/revenue account creates it inline.
- Category picker: mandatory in Toshl and Cashew; type-to-create in Toshl (type a new name, press Enter, it is saved for reuse). Cashew supports subcategories in the picker. Firefly III adds a separate budget selector that appears only for withdrawals and hides for deposits.
- Tags/labels: Toshl allows many tags per entry, auto-sorted by the chosen category and usage frequency, type-to-create. Monarch, Spendee (labels), and Wallet also have freeform tags. Tags are consistently optional and multi-valued; category is single-valued.
- Notes/description: a plain optional text field in all apps, distinct from payee.
- Attachments: receipt photos in Toshl (Pro), Monarch, Spendee (plus location), and Wallet (Receipts plus Warranty, Payment Type, Status, Location). Spendee ships an AI receipt scanner that pre-fills price, category, description, and photo.
- Recurring: entered on the same form as "Repeats" (Toshl) or via the date picker offering a repeat frequency (YNAB scheduled transactions). Firefly III instead keeps recurring transactions as a separate feature that spawns transactions. Cashew models subscription/repetitive/upcoming types whose instances only count in totals once marked Paid, with optional auto-pay of overdue ones.

### 1.4 Transaction types and cross-currency transfers

- Universal type triad: expense, income, transfer, always a segmented control at the top of the form (Toshl's top-edge switcher, MMEX's Withdrawal/Deposit/Transfer radio).
- Transfers swap the payee/category area for a second account picker. Toshl and Spendee drop category and tags entirely on transfers and render them with a distinct two-arrow icon in both accounts' lists.
- Cross-currency transfer, the key design decision: ask for BOTH amounts, never just a rate.
  - Firefly III: a transfer between a EUR and a USD account requires the user to enter the amount in both currencies (native amount plus foreign amount). The rate is implied, not typed.
  - MMEX: an "Advanced" checkbox on the transfer dialog splits the amount row into two fields, "from amount" and "to amount", which also absorbs bank spread.
  - Toshl: shows both amounts with a suggested rate between them; editing either amount or the rate recalculates the others.
  - Cashew avoids the problem by pairing a transfer-out and transfer-in transaction, each in its own account currency, excluded from income/expense reports via a "Balance Correction" category.
  - PocketSmith models transfers as two transactions tagged with transfer categories, each in its account's native currency, converted to base currency for reporting with daily rates. It does not auto-convert transfers between different-currency accounts, a documented pain point to avoid.
  - Actual's community proposal: the user enters either the receiving amount or the rate; entering the destination amount back-computes the rate, never the reverse.
- Field visibility rule (Firefly III): the form adapts to type. The budget selector appears only for withdrawals; piggy-bank linking appears only for transfers; the foreign-amount pair appears only when a second currency is involved.

### 1.5 Split transactions

- Actual Budget has the best implementation: choose "Split Transaction" inside the category dropdown; child rows appear under the parent with Add Split buttons; each child gets its own category and amount; the hard constraint is that children must sum to the parent total. A Distribute button assigns the remainder evenly across empty splits, or proportionally when all splits have values, distributing leftover cents one by one. Right-click unsplits individual children.
- YNAB: type "split" in the category box (it is the first autocomplete result), then tab through sub-rows; the running remainder is shown until the splits balance.
- Firefly III: any withdrawal, deposit, or transfer can be split into sub-transactions, each with its own description, amount, category, and budget. Constraint: a withdrawal's splits share one source account (you can split destinations, not sources); a deposit's splits share the destination.
- Monarch: each split row gets Merchant, Category, and Amount, so one card charge can be attributed to different merchants; "Add a split" grows the list beyond two.
- Wallet by BudgetBakers and PocketSmith support category-level splits on existing records; MMEX supports multiple categories per transaction via a split-category dialog.

### 1.6 Quick entry

- Templates: Wallet by BudgetBakers templates store name, account, category, amount, type, currency, payee, and labels for one-tap reuse. Cashew's "pinned" transactions do the same from a long-press on the plus button, duplicating to the current date.
- Duplicate/clone: Actual `U` duplicates selected rows; Wallet has clone; Cashew duplicates selected transactions to now.
- Keyboard-first entry (Actual Budget, best in class): `T` new transaction with date picker open, `E` date, `P` payee, `C` category, `M` amount, `R` convert two selected rows into a transfer, `?` opens the shortcut list. YNAB tabs cleanly through Date, Payee, Category, Memo, Outflow/Inflow.
- Ambient capture (Cashew): app-link URLs that create transactions without opening the UI, Siri Shortcuts, Android notification scanning, and a home-screen widget. Cashew also lets users reorder or disable steps of the entry flow itself (which prompt comes first: amount, category, or title).
- Entry-speed benchmark: Ivy Wallet's flow (tap plus, pick category, type amount on the keypad, optional note, save) is around 15 to 20 seconds and is the simplicity bar for mobile.

### 1.7 Patterns to steal, by app

- Toshl: tappable currency symbol, recent currencies, editable rate with bidirectional amount recalculation.
- Firefly III: native amount plus foreign amount stored per transaction, user-entered foreign amount beats computed rate; type-adaptive form fields.
- MMEX and Firefly III: cross-currency transfers always capture both concrete amounts.
- Actual Budget: split UX with sum constraint and remainder Distribute; full keyboard grammar.
- YNAB: math expressions in the amount field; payee-as-transfer; payee autocomplete pre-filling category.
- Cashew: title autocomplete that fills category, pinned templates, frozen conversion at entry time, customizable entry step order.

## 2. Multicurrency mechanics

### 2.1 The three-layer model: base vs account vs transaction currency

- Firefly III is the cleanest three-layer reference. Each installation has one primary (base) currency (default EUR, changeable in admin). Each asset account has exactly one currency. Each transaction has an amount in the account currency plus an optional foreign amount and foreign currency pair on the same row. Entering a EUR expense on a USD account forces the user to enter both amounts.
- PocketSmith: one base currency per user, one native currency per account (defaults to the bank's country), transactions live in the account currency. Multicurrency mode activates automatically the moment an account in another currency exists.
- Wallet (BudgetBakers): one base currency per user, fixed forever (changing it requires deleting all data), one currency per account, transactions inherit the account currency. Over 150 currencies. The community's top feedback request is per-record currency, which it lacks.
- GnuCash: no global base currency in storage. Every account has a commodity (currency); reports pick a report currency at render time. Cross-currency transactions carry two amounts per split (value in transaction currency, quantity in account commodity).
- Beancount/Ledger/hledger: no base currency at all in the data. Every amount is `<number> <commodity>`. A base currency exists only at report time (Beancount's `operating_currency` option tells Fava which columns to render; hledger's `-V` or `-X EUR` picks a valuation commodity).
- Actual Budget: explicitly currency agnostic, single implicit currency. The community proposal (issues #2147/#3351) converges on the same three-layer design: budget base currency, per-account currency, transaction entered in account currency with the base amount auto-derived from a rate and always overridable ("account currency should never be auto-calculated").
- MMEX: one base currency per database (rates of other currencies are quoted relative to it), per-account currency, transactions in account currency.

### 2.2 Exchange rates: sources, fetch, and granularity

- Firefly III: rates come from exchangerate.host, pre-collected by the `firefly-iii/exchange-rates` pipeline into a bucket that instances download via a daily cron job. Only built-in default currencies are covered, no crypto. New rates arrive about weekly and it explicitly does not backfill historical rates. Rates are stored per currency pair per date and are fully user-editable in both directions, with CRUD via the API. Critical fallback to avoid copying: if no rate exists, the rate is 1. Converted-to-primary amounts are precomputed and cached per transaction, with a recalculation command.
- MMEX: pulls from ExchangeRate-API via its own public mirror (`moneymanagerex.github.io/currency/data/latest_{base}.json`, refreshed every 24h), keeps a per-currency rate history table with dated entries, updates only active currencies, and allows manual edit in Tools > Currency Manager.
- PocketSmith: stores one conversion rate per currency pair per day; each transaction is converted at its own date's rate. Balances convert at the account's last balance date. Also quotes BTC, XAU, XAG.
- Wallet: rates auto-update overnight; users can disable auto-update and pin manual rates per currency.
- GnuCash: a Price Database stores dated price entries per commodity pair; "Get Quotes" pulls via Finance::Quote, and every cross-currency transaction entered through the transfer dialog silently adds a `user:xfer-dialog` price entry, so the price DB accumulates the user's own realized rates alongside fetched ones.
- Beancount/hledger/Ledger: rates are plain dated price directives in the journal (`P 2026-06-15 USD 3.74 PEN`). Fetching is external tooling (`bean-price`, market-price scripts). hledger can infer market prices from transaction costs with `--infer-market-prices`, so actual purchases become the rate source.
- Per-transaction override exists everywhere it matters: Firefly's foreign amount is used instead of any calculated amount, Beancount has `@`/`@@` per posting, Actual's proposal makes the rate editable per transaction.

### 2.3 Historical vs current rate

Two distinct valuation questions, and good tools separate them:

- Transaction valuation at historical rate: PocketSmith values each transaction at its date's stored rate. hledger makes this explicit with `--value=then` (value on transaction date) vs `--value=end` (period end) vs `--value=now` vs `--value=YYYY-MM-DD`; lookup takes the latest price on or before the valuation date. Beancount is the same via dated `P` directives.
- Firefly III is weaker here: it converts with whatever rates it has, defaults to 1 when missing, and will not download last month's rates, so the per-transaction foreign amount is the reliable historical record.
- Practical rule the plain-text tools encode: the rate actually applied to a transaction is stored on the transaction (cost or foreign amount); the rates table only values amounts that never had an explicit conversion.

### 2.4 Conversion display and preserving the original

- Universal pattern: the original amount is the source of truth, the converted amount is a decoration. Firefly III reports convert only account-currency amounts back to base, never sideways (a EUR-based user cannot view GBP amounts in USD). Its transaction rows carry both `amount` and `foreign_amount`, so the UI can show "USD 20.00 (EUR 18.35)".
- PocketSmith has a per-user toggle, "Show amounts in base currency instead of native where possible", with tooltips showing conversion details next to balances.
- hledger prints costs inline (`-10.00 USD @ 0.85 EUR`) and only converts in reports when `-B` (cost) or `-V` (market value) is passed; the journal itself is never rewritten.
- Actual's community workaround writes the original into the note text (`{{ fixed (div amount 100) 2 }} XXX (FX rate: RATE)`) while replacing the amount. This is the anti-pattern native support fixes: the original must be a first-class field, not prose.

### 2.5 Cross-currency transfers (data model view)

- One transaction, two amounts is the consumer-grade winner: Firefly III models a transfer as a single transaction where both currencies must have a monetary value, the two amounts implying the effective rate; bank fees and spread are absorbed into the amount pair (the stated purpose of foreign amount: banks with steep exchange rates).
- GnuCash: one transaction, per-split value/quantity in different commodities, with the entered exchange rate written to the price DB. With Trading Accounts enabled it auto-creates `Trading:CURRENCY:XXX` equity subaccounts to absorb the imbalance.
- hledger documents both styles: `@` cost notation (implied rate, journal balances by cost) or four postings against `equity:conversion` (each currency balances to zero independently), converting between styles with `--infer-equity` / `--infer-costs`.

### 2.6 Currency gain/loss

- Full modeling exists only in the double-entry tools: GnuCash Trading Accounts capture realized FX gain/loss automatically; hledger and Beancount get realized gains via `equity:conversion` or cost-basis lots, and unrealized gains via valuation reports (Beancount has an `unrealized` plugin).
- Consumer trackers do not model gain/loss as an entity. Firefly III, Wallet, PocketSmith, and MMEX simply revalue foreign balances at the current (or daily historical) rate, so unrealized FX movement shows up as net-worth fluctuation, and any realized spread on a transfer is just the difference baked into the two amounts. The pragmatic consumer simplification: store both legs of every conversion, revalue balances at the latest rate for display, and skip gain/loss accounting entirely.

### 2.7 Data schema conventions

- Firefly III: currency table holds ISO 4217 `code`, `symbol`, `name`, and `decimal_places` (0 for zero-decimal currencies, up to 8 max); amounts stored as high-precision decimals; rates stored per pair per date; ISO 4217 compliance expected but custom codes allowed.
- Actual Budget: stores amounts as integers in minor units (cents); the multicurrency proposal keeps that and adds a per-account currency plus a per-transaction rate, tagging currencies by ISO 4217 code.
- GnuCash: amounts are exact rationals (numerator/denominator pairs), never floats; each commodity declares its smallest fraction (JPY 1/1, USD 1/100); price entries are dated rationals with a source tag (`Finance::Quote`, `user:xfer-dialog`).
- Beancount/hledger: arbitrary-precision decimals parsed from text; display precision inferred per commodity from usage or declared; commodity codes are free-form but conventionally ISO 4217.
- MMEX: SQLite tables `CURRENCYFORMATS_V1` (code, symbol, scale) and `CURRENCYHISTORY_V1` (currency id, date, rate vs base), rates as decimals keyed by day.
- Zero-decimal handling: the robust pattern is a per-currency `decimal_places` or smallest-fraction field consulted for entry, rounding, and display (Firefly III, GnuCash, the ISO 4217 exponent). Tools that hardcode 2 decimals or store bare cents are exactly the ones that cannot represent JPY (exponent 0) or BHD (exponent 3) correctly.

## 3. Filters, search and list UX

### 3.1 Filter catalog

- Date range: every serious app ships presets plus custom range. Lunch Money's quick filter lists the active month first, then previous month, current year, last year, All Time, plus a custom range. PocketSmith supports between two dates, before, after, and on a specific date. Ivy Wallet's Reports filter has a time period selector with custom ranges. Firefly III exposes `date_on:`, `date_before:`, `date_after:` (and the same trio for book, due, payment, process, interest and invoice dates).
- Account: multi-select is the norm. Toshl toggles each account on/off with "All accounts" as default. PocketSmith and Monarch constrain to one or more accounts. Firefly III distinguishes source vs destination: `source_account_is:`, `destination_account_contains:`, plus account-number variants (`account_nr_starts:`).
- Category: multi-select with hierarchy awareness. PocketSmith category criteria have an explicit "Include sub-categories" checkbox for parents. Monarch filters by categories or category groups. Firefly III: `category_is:`, `category_contains:`, `category_starts:`, `category_ends:`.
- Tags with any/all/none logic: PocketSmith's labels filter offers "Any", "All", or "None" operators. Firefly III has `tag_is:`, `tag_contains:`, and a dedicated `tag_is_not:`. Lunch Money lets reports include or exclude specific tags.
- Amount range: Ivy Wallet has min/max amount fields. Firefly III: `amount_is:`, `amount_more:`, `amount_less:`, `amount_min:`/`amount_max:`, plus foreign-currency twins (`foreign_amount_more:`). PocketSmith amount search uses absolute value and ignores the sign, a good default for "find the 24.99 charge".
- Transaction type: PocketSmith offers "Income only" / "Expense only", plus transfers vs non-transfers. Firefly III: `type:withdrawal|deposit|transfer`.
- Currency: Firefly III `currency_is:` and `foreign_currency_is:`; PocketSmith includes currency in transaction-type criteria; Lunch Money search matches currency.
- Text search fields: be explicit about what plain search hits. Lunch Money's quick search matches payee, category name, amount, currency, notes, and tag names (so typing "24.99" works). Firefly III's bare query searches description only; other fields need operators (`notes_contains:`, `description_starts:`). PocketSmith merchant keyword search is case-insensitive with "contains" or "does NOT contain".
- Emptiness and metadata filters: Firefly III is the gold standard: `has_no_category`, `has_no_budget`, `has_no_tag`, `has_any_tag`, `has_attachments`, `has_no_attachments`, `has_notes`, `no_notes`, `reconciled:`, `external_id_is:`, `attachment_name_contains:`. An "uncategorized only" toggle is the single most-used cleanup filter across these apps.

### 3.2 Filter UX patterns

- Condition-row builder with saved filters (Actual Budget): each filter is a row of field plus operator (`is`, `contains`, `matches` with regex, greater/less than for date and amount) plus value. Conditions stack. Active filters render as removable pills above the register. An "Unsaved filter" dropdown offers Save new filter, then later select, update, revert, or delete saved filters.
- Match all vs match any (Lunch Money): the advanced filter explicitly asks whether to match ALL or ANY of the conditions, with "Add another filter" rows and a red x to remove each. Firefly III joins everything as AND only (subqueries in parentheses and `-` negation exist, but no OR between top-level clauses), and users file issues about it, so plan for OR early.
- Saved searches as first-class objects (PocketSmith): saved searches reappear on the Transactions page and Timeline, and a saved search can be promoted into a rule that auto-categorizes matching transactions. Firefly III similarly converts a search query into a rule trigger.
- Search prefixes in one box (YNAB): the register search accepts typed prefixes with autocomplete: `Payee: Transfer`, `Category: Split`, `Flag: Red`, `is: uncleared`. Documented weaknesses to avoid copying: additive only (no exclusion), no wildcards, whitespace-sensitive matching, and it breaks on payees containing colons or commas.
- Quick filter from context: Monarch applies filters instantly as you pick them and jumps from an account to its filtered transaction list; clicking a category or tag anywhere should deep-link to the transaction list pre-filtered. Toshl makes every filter cumulative: account plus time span plus category plus tag combine into an ever finer mesh.
- Presets as slots (MMEX): the Transaction Filter dialog has 10 numbered slots that store preset filter configurations.
- URL persistence: Monarch and Lunch Money encode active filters in the URL query string so filtered views are shareable and survive refresh. Treat this as table stakes for a web app.

### 3.3 Search syntax power features (Firefly III, the reference implementation)

Over 100 operators defined in `config/search.php`, all following a `field_verb` grammar: verbs `_is`, `_contains`, `_starts`, `_ends` for text; `_on`, `_before`, `_after` for dates; `_more`, `_less`, `_min`, `_max` for amounts. Any operator negates with a `-` prefix (`-tag_is:work`), values quote with `"` for spaces, and `()` groups subqueries. Aliases keep casual queries short (`amount:`, `on:`, `before:`, `after:`, `from:`, `to:`, `tag:`). Dates accept fuzzy values (a year, a month) and relative expressions. The same query language powers rules and the API, which is the real payoff: one grammar for search, automation, and integrations.

### 3.4 List UX

- Grouping with subtotal headers: Toshl groups the expense list by day with per-day sums. Monarch groups by date. Lunch Money groups by the selected period. A month header with income/expense/net subtotal is the most useful variant for a spend tracker.
- Running balance: YNAB offers a Running Balance column toggled via the View menu in a single-account register; it is tied to date order and intentionally unavailable when sorted by other columns. Only offer it in single-account, date-sorted views.
- Sorting: YNAB sorts by any column header with stacked secondary sort (click Payee then Date to get Date-then-Payee). Actual Budget notably cannot sort columns, a top user complaint. Ship sortable date, amount, and payee at minimum.
- Totals bar for the filtered set: YNAB's select-all checkbox shows the selected total in the top right of the register. Actual shows aggregate totals for the filtered view, and a revised total when a subset is selected. Show count plus sum, and per-currency sums when currencies mix.
- Bulk selection and edit: Monarch has an "Edit multiple" mode with checkboxes and Shift+click range select; bulk-editable fields are merchant name, category, date, notes, and tags. YNAB supports select-all on search results then bulk categorize, flag, or delete. Recategorize and retag are the two bulk actions people actually use during cleanup.
- Inline edit: Actual Budget and YNAB edit cells directly in the register row (payee, category, amount) without opening a modal; Monarch opens a side drawer. Inline category editing is the highest-leverage one.
- Pagination: Firefly III uses classic page numbers; Monarch and Lunch Money use infinite scroll or load-more within the filtered set. Infinite scroll plus sticky group headers plus a persistent totals bar is the modern combination.

## 4. Reports, dashboard and budgets

### 4.1 Dashboard widgets

- Net worth over time: Actual Budget's Net Worth graph plots the sum of all account balances over time (assets minus debts) with Trend and Stacked view modes. YNAB's Net Worth report colors debts red and assets blue per month. PocketSmith and Ivy Wallet show a single net worth number converted to the base currency; PocketSmith converts each account as at the account's last balance date using stored daily rates. Firefly III draws the net worth line in the primary currency only when its "convert to primary" setting is enabled; otherwise it draws separate series per currency.
- Account balances list: every app has one. PocketSmith shows the native balance with a tooltip of the converted base amount (a preference flips which one is primary). Spendee shows each wallet in its own currency plus the main currency. MMEX's home page lists accounts with totals converted to base currency, with an option to exclude future-dated transactions from displayed balances.
- Spending this month vs last: Toshl's monthly overview header shows the selected month's expenses and income with a percentage difference vs the previous month. Actual Budget's Summary card can show a total or a monthly average for a range. Monarch's dashboard is drag-and-drop widgets (net worth, recent transactions, cash flow, budgets, goals).
- Category breakdown: YNAB's Spending Breakdown is a donut of categories by percentage of spend, with drill-down from category group to category to payee. Monarch and Spendee use donut plus list; Firefly III shows a front-page category chart for expenses and income.
- Cash flow bars: Actual Budget's Cash Flow graph shows income and expense per month as paired bars over budgeted accounts. Monarch's Cash Flow has two modes: Breakdown (a Sankey diagram from income through categories to expenses/savings) and Trends (grouped or stacked bars per period). Toshl's signature "river flow" graph shows income flowing against the monthly budget, split into spent, planned, and left-to-spend.
- Budget progress and bills: Firefly III's front page shows budget progress bars plus upcoming subscriptions (its recurring-bill entity), which also predict expected amounts. Monarch shows budget remaining per group. Actual Budget's dashboard is fully composable: multiple dashboards mixing Net Worth, Cash Flow, Spending Analysis, Summary, Calendar (daily income/expense heat), Text/Markdown, and saved custom reports.

### 4.2 Mixed currencies in reports: three strategies

1. Convert everything to a base currency (PocketSmith, Ivy Wallet, Toshl, Spendee, MMEX). PocketSmith stores a rate per day and converts each transaction at its date's historical rate; report and dashboard category totals are always in base currency, while the transaction list shows per-currency sums unless the base-currency preference is on. Toshl fetches rates hourly, keeps over 15 years of daily history, and lets the user switch the main display currency freely; every graph and sum re-renders in it. Spendee updates rates daily and lets you override the rate per transaction (with "remember this rate"). MMEX computes all reports and grand totals in the base currency using its stored rate table. Ivy Wallet converts balance, income, and spending to the chosen base currency and allows a custom rate per transaction.
2. Keep currencies separate, convert opt-in (Firefly III). Default philosophy is to split currencies as much as possible: double bars, double charts, double report entries, so nothing is silently mixed. Since v6.x there are admin settings (enable exchange rates, download rates via daily cron, per-user "convert to primary" toggle); when enabled, charts and API amounts are also expressed in the primary currency at the stored rate, otherwise converted fields are null.
3. Refuse to mix (YNAB, Actual Budget). YNAB officially recommends one budget per currency; a linked foreign account gets converted once at import. Actual Budget has no currency field at all, so multi-currency means separate budget files or manual conversion at entry.

Excluded accounts are a common control: Monarch and PocketSmith let you exclude accounts from net worth and cash flow, YNAB distinguishes budget accounts from tracking accounts (tracking accounts appear only in Net Worth), and Actual Budget separates budgeted and off-budget accounts (Cash Flow only reads budgeted ones).

### 4.3 Time controls

- Period selectors are universally month-first with custom ranges: Monarch reports span daily to yearly groupings with arbitrary date ranges; Actual Budget supports live ranges (such as "last 6 months", which shift as time passes) or static ranges per widget; Firefly III's report engine takes any start/end date and offers default, audit, category, tag, and budget report types; MMEX offers current month, last month, year-to-date, financial year, and custom.
- Compare-to-previous is strongest in Toshl (every headline number shows percent change vs the prior period) and YNAB (Spending Trends compares periods and shows monthly averages). Actual Budget's Spending Analysis tracks and compares expenses over a specified period, highlighting trends, fluctuations, and overspending. Monarch overlays previous-period lines in Trends mode.

### 4.4 Budgets

- Per-category monthly budgets exist everywhere. YNAB and Actual Budget are envelope systems (assign every dollar, category balances are the budget). Monarch supports category and category-group budgets, plus Flex budgeting (Fixed, Non-monthly, and one Flex bucket with a single number). Ivy Wallet and Spendee use simple per-category or multi-category limits with daily-pace hints (how much you can spend per day to stay on budget). MMEX supports yearly and monthly budget plans compared against actuals in reports.
- Rollover: YNAB and Actual Budget roll category balances forward inherently (Actual can also reset to zero). Monarch has an explicit per-category Rollover toggle carrying leftover into next month's Remaining. Toshl's equivalent is "Move remaining funds to next period", carrying surplus or deficit forward. Firefly III has an auto-budget mode with a rollover strategy that adds unspent amounts to the next period's limit.
- Multicurrency budgets: Firefly III is the most explicit: a budget counts only transactions in the currency of each budget limit, so a EUR 100 limit ignores USD spending unless a second USD limit is added to the same budget; the foreign-amount field attributes cross-currency card spends to the right limit. Toshl lets each budget have its own currency among 200 plus, converting spends into it at the day's rate. PocketSmith budgets adopt the currency of the account or category setup, convert transactions to base for the overall summary, and cannot convert transfer budgets across currencies (documented workaround: separate categories per side). YNAB and Actual Budget sidestep the issue via one currency per budget file.
- Budget periods: Toshl allows monthly, weekly, daily, or custom periods and one-time budgets; Firefly III limits are per date range (weekly, monthly, quarterly, half-year, yearly, or custom); Monarch's Budget Calendar view edits all 12 months in a grid with month, year, and decade zoom.

### 4.5 Insights

- Averages: YNAB's Spending Trends shows average monthly spend per category; Actual Budget's Summary card computes monthly averages; Monarch shows average spend lines in Trends; Firefly III reports include period averages per category and per account.
- Largest expenses: Firefly III report pages list top expenses and top revenue per period; Spendee and Toshl surface biggest categories and biggest single expenses in their overviews.
- Payee/merchant aggregation: Monarch groups reports by category, merchant, account, or tag. MMEX has a dedicated by-payee report with pie charts. YNAB drills from category to payee inside Spending Breakdown. Firefly III models payees as expense accounts, so every expense account has its own spent-over-time chart.
- Trends: Monarch Trends (stacked or grouped bars per group over time), YNAB Spending Trends (trend bars plus totals table), PocketSmith Trends page (category history converted to base currency), Toshl month-over-month comparisons filterable by category, tag, and account, and Actual Budget custom reports (any field, rendered as table, bar, line, area, or donut, savable to the dashboard).

## 5. Accounts

### 5.1 Account types offered

- Firefly III has four core types: asset, expense, revenue, and liability. Only asset and liability accounts are "yours". Asset accounts carry a role: default asset, shared asset, savings, credit card, or cash wallet. Liabilities are a separate type with subtypes debt, loan, and mortgage, plus a direction ("I owe" vs "I am owed"), interest rate, and interest period. The docs recommend modeling credit cards as asset accounts with the credit card role rather than as liabilities.
- Actual Budget keeps types minimal: an account is either on-budget (checking, credit card, anything that feeds the budget) or off-budget (investments, mortgage, tracking only). Off-budget transactions cannot be categorized.
- YNAB has three groups: Budget accounts (checking, savings, cash, credit card, line of credit), Loan accounts (with interest and escrow handling), and Tracking accounts (asset or liability, excluded from the budget, only for net worth).
- MMEX offers Checking (covers bank, savings, and credit cards; supports withdrawals, deposits, transfers), Term (same behavior in a separate dashboard section, for mortgages, loans, deposits), Investment (stocks, bonds, funds), plus cash and asset accounts.
- Ivy Wallet has no type field at all: an account is just name, currency, color, icon, and an "exclude from balance" flag.
- Wallet by BudgetBakers offers General, Account with overdraft (bank account plus overdraft limit), Credit card (with credit limit), Saving account, Loan, and Investment.
- PocketSmith splits accounts into bank-feed vs offline, with transactional types (bank, credit, cash) plus non-transactional assets and debts (property, vehicle, mortgage) used for net worth.
- GnuCash uses full double-entry with 12 account types (Cash, Bank, Stock, Mutual Fund, Accounts Receivable, Other Assets, Credit Card, Accounts Payable, Liability, Equity, Income, Expense) in a user-defined tree.

### 5.2 What changes per type, especially credit cards

- Credit cards live in negative balance territory in YNAB, Actual, and GnuCash: a card you owe money on has a negative (YNAB/Actual) or credit-side (GnuCash) balance. Actual's reconciliation explicitly says to enter the statement balance as a negative number for credit or loan accounts.
- YNAB gives each credit card an automatic payment category: categorized spending on the card moves budgeted money into that category so the payment is always funded. This is the deepest per-type behavior surveyed.
- Firefly III's credit card role adds a monthly full payment date setting and card type, used for card-specific views. BudgetBakers stores a credit limit on cards and an overdraft limit on overdraft accounts and shows the balance against the limit.
- Loan/liability types add interest fields: YNAB Loan accounts simulate interest and payoff dates; Firefly liabilities take start amount, start date, interest rate, and interest period.
- Investment types (MMEX, BudgetBakers, GnuCash Stock/Mutual Fund) track holdings and prices instead of plain transactions; Actual and Ivy treat them as ordinary off-budget accounts.

### 5.3 Account fields

- Common core: name, type, currency, opening/initial balance, notes. Firefly III adds IBAN, account number, a virtual balance offset, an active flag, and an explicit "include in net worth" toggle. PocketSmith has the same toggle. Ivy Wallet and BudgetBakers use an "exclude from balance/stats" flag instead. GnuCash has placeholder and hidden flags plus tax-related.
- Currency per account: Firefly III, Ivy Wallet, BudgetBakers, PocketSmith, MMEX, and GnuCash all fix one currency per account and all its transactions. PocketSmith lets you change an account's currency later in preferences; GnuCash makes the commodity effectively immutable once transactions exist. Actual and YNAB have no account currency field at all.
- Only PocketSmith and Firefly convert per-account balances into a base currency for totals and net worth; Ivy converts to a selected base currency on the home screen.

### 5.4 Opening balance and balance handling

- Every app computes the balance from transactions rather than storing it; the opening balance is materialized as a special transaction. GnuCash is the purest: a transfer from an Equity: Opening Balances account. Firefly III creates a system "initial balance" account and books an opening-balance transaction dated at the chosen opening date. Actual creates a "Starting Balance" transaction from the balance entered at creation. MMEX has an initial balance field with the guidance to enter today's balance and only add transactions after that date.
- Firefly III's virtual balance is the one stored offset: a constant added on top of the computed balance, for money you pretend is not there.

### 5.5 Reconciliation

- YNAB: transactions are uncleared or cleared (green C). Reconciliation compares YNAB's cleared balance against the bank's balance; on completion transactions become reconciled (locked padlock) and a balance adjustment transaction is created for any residual difference. Recommended weekly.
- Actual Budget: three states, uncleared (gray), cleared (green), locked/reconciled. Click the lock icon, enter the statement balance, toggle transactions cleared while a live difference counts to zero, then "Lock transactions". Locked rows warn on edit; off-budget accounts get a one-click "create reconciliation transaction" to adjust value.
- Firefly III: a dedicated reconcile view per asset account: pick statement start/end dates and balances, tick transactions, and Firefly creates a special reconciliation transaction for the difference; reconciled transactions become uneditable.
- GnuCash: classic R column with states n (new), c (cleared), y (reconciled). The reconcile dialog takes statement date, starting and ending balance; tick transactions until the difference is zero.
- MMEX marks transactions Unreconciled/Reconciled (plus Void, Follow-up, Duplicate). Ivy Wallet and BudgetBakers have no reconciliation concept; BudgetBakers only has cleared/pending from bank sync.

### 5.6 Archive/close vs delete

- Actual Budget: closing an account requires choosing another account to transfer the remaining balance to (or force close). Closed accounts move to a Closed Accounts section, keep their transactions, and can be reopened. Deletion is separate and destroys history.
- YNAB: closing keeps the account and its transactions for reports; a closed account with a balance gets an adjustment. Deleting removes transactions.
- Firefly III: accounts can be set inactive (hidden from lists, history kept); deleting an account deletes its transactions, which the UI warns about loudly.
- MMEX: account status Open/Closed, purely for decluttering; data stays.
- PocketSmith: no per-account archive flag; the documented pattern is an "Archive" account group dragged to the bottom, plus per-account hide-balance and exclude-from-net-worth options.
- GnuCash: accounts are marked hidden; deletion prompts to move or delete child transactions and subaccounts.

### 5.7 Account list UX

- Grouping by type is the norm: YNAB's sidebar groups Budget / Loans / Tracking with group subtotals and per-account working balances; Actual groups On Budget / Off Budget / Closed with a "For budget" total; MMEX's navigator groups Checking / Term / Investment with a favorites filter; BudgetBakers and Ivy show accounts as colored cards with per-account balances.
- Multicurrency lists show the balance in the account's currency, with the group or net worth total converted to the base currency (PocketSmith Account Summary, Firefly III net worth box, Ivy home screen). PocketSmith also supports drag-and-drop custom grouping and per-account hide-balance.
- GnuCash shows the account tree with each account's balance in its own commodity plus a report-currency total column.

## Current app snapshot

### Backend (Hono + PostgreSQL)

- Hono app served by `@hono/node-server`, PostgreSQL via `pg`, Zod validation, Vercel AI SDK with OpenAI. No auth on any API endpoint, single-tenant, CORS restricted to `WEB_ORIGIN`.
- Schema (single hand-run migration `migrations/001_init.sql`):
  - `accounts(id uuid, name, type text free-form, currency text free-form, created_at, updated_at)`. Seed: Cash / cash / PEN. No opening balance, no archive flag.
  - `categories(id, name, type text free-form, created_at, updated_at)`. Seed: Food, Transport, Utilities, Salary, Uncategorized.
  - `transactions(id, description, amount numeric(14,2) signed with negative = expense, currency text free-form, account_id nullable FK, category_id FK NOT NULL, tags text[], created_at, updated_at)`. No transaction date separate from `created_at`, no payee, no notes, no type column, no transfer or split concepts, no foreign amount.
  - `agent_state(key, value)` stores the Gmail history cursor.
- Endpoints: plain CRUD for `/api/transactions`, `/api/accounts`, `/api/categories`, plus `GET /api/tags` (distinct unnest). `GET /api/transactions` returns the entire table ordered by `created_at DESC` with zero query params: no pagination, filtering, date range, search, or aggregation. Currency is validated only as a non-empty string. Bad FKs and deletes of referenced rows surface as generic 500s.
- Ingestion pipeline: Gmail poller (60s default) -> AI detect (`is_transaction_email`) -> AI extract sets ALL fields including free-text `currency`, signed `amount`, `account_id`/`category_id` from provided lists, minimum 3 tags, and `created_at` computed in America/Lima. On success: insert plus a Telegram HTML notification with the row id. Telegram replies can edit description/tags/category or `/delete`; amount, currency, account, and date are not editable via Telegram. No dedup guard beyond the Gmail history cursor.
- Tests: solid Vitest coverage of routes, queries, env, AI functions (mocked), Gmail parsing/polling, pipeline branches, and the Telegram flow.

### Web app (React 19 + Vite + TanStack Query + Tailwind 4 + ECharts 6)

- Pages: Dashboard (client-computed "Net balance" and "Total spend" cards as per-currency lines, recent transactions, lazy donut of spending by category with the app's only period and currency selectors), Transactions (full ledger grouped by day with per-currency day nets, create/edit dialog, delete confirm, no filters, search, pagination, or sorting), Accounts (flat list, dialog with free-text type and free-text 3-char currency), Categories (flat list, type select limited to expense/income).
- Transaction form: description, signed amount (no expense/income toggle), free 3-char currency defaulting to the first account's currency but not linked to the selected account, account select, category select unfiltered by type, date-time picker defaulting to now, comma-separated tags input with no autocomplete despite the tags API.
- Data layer fetches full lists with no params; `useTags` exists but is unused. No exchange rates, base currency, balances, transfers, budgets, time-series chart, or CSV import/export anywhere.

### Android app (Jetpack Compose, Material 3)

- Screens: summary dashboard, transactions list with create FAB, transaction detail, create/edit form. Calls list/get/create/update/delete on `/api/transactions` plus read-only `/api/accounts`, `/api/categories`, `/api/tags`.
- Mock-only auth via an `x-mock-user` header with a `SessionStore` seam for a future bearer token. No account, category, or tag management screens. Has an i18n string table and unit-test-friendly helpers.

## Gap matrix

| Feature | Reference behavior | Current state | Gap severity | Notes |
| --- | --- | --- | --- | --- |
| Base currency setting | One primary currency per user/installation (Firefly III, PocketSmith, Toshl); converted totals rendered in it | None; totals are per-currency lines | missing | User's base currency is PEN; needs a settings entity |
| Currency as a controlled entity | ISO 4217 code, symbol, name, decimal_places per currency (Firefly III, GnuCash smallest fraction) | Free-text string on accounts and transactions, AI writes whatever the email said | missing | Prerequisite for everything else; decimal_places drives entry and display |
| Exchange rate storage and fetching | Rate per currency pair per day, fetched by daily job, user-editable, never silently 1 (PocketSmith, MMEX, GnuCash price DB) | None | missing | Fetch daily, backfill on demand, allow manual override; avoid Firefly's rate=1 fallback |
| Per-transaction currency with converted display | Original amount is source of truth; optional foreign amount pair; UI shows "USD 20.00 (PEN 74.80)" (Firefly III, Toshl, Spendee) | Transaction has one free-text currency, unrelated to the account's currency; no conversion anywhere | missing | Store the converted-to-base amount frozen at entry (Cashew) with the rate used |
| Cross-currency transfers | One transfer capturing BOTH concrete amounts, rate implied (Firefly III, MMEX, Toshl) | No transfer concept at all; moving money double-counts as expense plus income | missing | Single row with from/to account and from/to amount, excluded from income/expense reports |
| Transaction types (expense/income/transfer) | Explicit type segmented control; sign derived from type; type-adaptive form fields | Sign of amount is the only signal; category type stored but never cross-checked | missing | Type column plus a check against category type |
| Split transactions | Children sum to parent, per-child category and amount, Distribute remainder (Actual Budget) | None | missing | P2 candidate; needs parent/child rows |
| Payee field | Autocomplete, pre-fills last category, doubles as transfer target (YNAB, Actual) | None; description is the only text field | missing | High leverage for the AI extractor too (merchant name) |
| Notes field | Optional free text distinct from payee/description | None | missing | Trivial column plus form field |
| Date of transaction vs created_at | Transaction date is user-set, defaults to today; created_at is metadata | `created_at` doubles as the transaction date (AI writes it, form edits it) | partial | Add `date` (or `occurred_at`); keep `created_at` as insert time |
| Filters: date range | Presets (this month, last month, year, all time) plus custom range (Lunch Money, PocketSmith) | None on transactions; donut chart has 5 period presets | missing | Server-side query params required |
| Filters: account | Multi-select, source vs destination for transfers (Toshl, Firefly III) | None | missing | |
| Filters: category | Multi-select; "uncategorized only" toggle (Firefly III `has_no_category`) | None | missing | |
| Filters: tags | Any/all/none operators (PocketSmith), `tag_is_not` (Firefly III) | None; tags API exists but unused in UI | missing | |
| Filters: amount range | Min/max, absolute-value matching (Ivy, PocketSmith) | None | missing | |
| Filters: currency | `currency_is:` (Firefly III), currency-aware search (Lunch Money) | None | missing | |
| Filters: type | Income/expense/transfer toggles (PocketSmith, Firefly III) | None (no type field to filter on) | missing | Depends on type column |
| Filters: text search | Hits payee, category, amount, notes, tags (Lunch Money) | None | missing | Be explicit about matched fields |
| Saved views / saved filters | First-class saved filters, URL-persisted state (Actual, PocketSmith, Monarch) | None | missing | URL query-string persistence is table stakes for web |
| Bulk edit | Multi-select, shift-click range, bulk recategorize/retag/delete (Monarch, YNAB) | None; single-row edit/delete only | missing | Recategorize and retag are the two that matter |
| Grouped list with subtotals | Day/month headers with per-group net; totals bar with count plus per-currency sums (Toshl, Actual) | Day grouping with per-currency day nets exists on web | partial | Missing totals bar for the filtered set and month subtotals |
| Sorting and pagination | Sortable date/amount/payee; infinite scroll or pages within the filtered set | Entire ledger fetched and rendered, fixed order | missing | Needs server-side pagination |
| Account opening balance | Materialized as a starting-balance transaction; balance computed from transactions (all apps) | No opening balance, no balance shown anywhere | missing | Balance endpoint plus starting-balance row |
| Account archiving | Close/inactive keeps history, separate from delete (Actual, YNAB, Firefly III) | Delete only, and it 500s when transactions reference the account | missing | Add `archived_at`; turn FK failure into a 409 with guidance |
| Account types | Controlled set with per-type behavior; credit cards tracked as negative balances with a credit limit | Free-text type, no behavior attached | partial | A small enum (checking, savings, cash, credit card) is enough at first |
| Credit card semantics | Negative balance, credit limit, payment category (YNAB deepest) | None | missing | Negative-balance display and `credit_limit` land in P1; YNAB-style payment category deliberately unscoped |
| Dashboard multicurrency handling | Every total also converted to base with original preserved; per-currency breakdown available (PocketSmith, Toshl) | Per-currency lines only, no converted total | missing | Convert at each transaction's date rate; show base total plus per-currency detail |
| Net worth / balance over time | Account balances summed over time in base currency (Actual, YNAB) | None | missing | P2 (reports); needs P1 balances plus P0 rates first |
| Budgets | Per-category monthly limits with rollover; currency-aware limits (Firefly III, Toshl) | None | missing | P2 |
| Recurring transactions | Repeat rule on the form or a spawner entity (Toshl, Firefly III, Cashew) | None | missing | P2; the email pipeline already captures most recurring bank spends |
| Reconciliation | Cleared/reconciled states, statement-balance workflow, adjustment transaction (YNAB, Actual, Firefly III) | None | missing | P2; low value until balances exist |
| Category/sign consistency | Category type filters the picker and validates the sign | Category type stored, never used | partial | Filter the category select by the chosen transaction type |
| FK integrity errors | Friendly errors, guarded deletes | Generic 500s on bad ids and referenced deletes | partial | Validate UUIDs and existence, return 409/404 |
| Ingestion dedup | Idempotent capture | Only the Gmail history cursor prevents duplicates | partial | Store a Gmail message id per transaction as an external id |

## Recommended scope

Context for prioritization: single user, base currency PEN, stack is Hono plus Postgres plus React web with a Compose Android client, and an AI ingestion pipeline that already creates transactions with a model-chosen currency. The multicurrency core must therefore be schema-first: every AI-extracted transaction needs a validated currency and a frozen conversion to PEN at insert time.

### P0: multicurrency core, transaction shape, transfers, filtering

1. Currency as a controlled type. A `currencies` table, not an enum: `symbol`, `name`, and `decimal_places` need a home, and adding a currency must not require a migration. Columns: ISO 4217 `code` (primary key), `symbol`, `name`, `decimal_places`; seed with the ISO 4217 list. Convert `accounts.currency` and `transactions.currency` into FKs referencing `currencies.code`. Normalize the AI extractor's output to a code from this list and reject or flag unknowns instead of inserting free text. Respect `decimal_places` in entry, rounding, and display (JPY 0, PEN 2).
2. Base currency setting (PEN) in a single-row `settings` table: `settings(id, base_currency_code FK -> currencies.code, created_at, updated_at)`, enforced single-row via a check on `id = 1`. Every aggregate the API returns carries both the original per-currency amounts and a converted-to-base total.
3. Exchange rates: `exchange_rates(base_code, quote_code, date, rate, source)` with one rate per pair per day. Direction convention: `rate` is how many units of `quote_code` one unit of `base_code` buys (base -> quote), so 1 USD = 3.74 PEN is stored as `(USD, PEN, date, 3.74)`; the inverse is computed, never stored twice. Daily fetch source: the MMEX public ExchangeRate-API mirror (`moneymanagerex.github.io/currency/data/latest_{base}.json`, keyless, refreshed every 24h, covers PEN), run by a daily job (the app already runs a poller loop; add a rates fetch alongside it). On-demand backfill for a missing historical date uses exchangerate.host's historical `/{date}` endpoint (free API key, historical coverage the mirror lacks). Rates are user-editable via CRUD endpoints; `source` distinguishes provenance with values `exchangerate-api`, `exchangerate-host`, and `manual`, and manual rates are never overwritten by the daily job. Never fall back to rate 1; surface "no rate" explicitly.
4. Frozen conversion on the transaction. Add `base_amount` (amount converted to PEN) and `rate_used` columns, computed at insert time from the transaction-date rate and overridable by the user, following Firefly III's rule that a user-entered converted amount beats any computed one. This makes the AI pipeline safe: an extracted USD transaction is converted once, at ingestion, and history never shifts when rates update.
5. Transaction date. Add an `occurred_at` (date of the transaction) distinct from `created_at`. The AI extractor writes `occurred_at`; `created_at` becomes pure insert metadata. All grouping, filtering, and rate lookup use `occurred_at`.
6. Transaction type. Add `type` in (`expense`, `income`, `transfer`). Sign derives from type; the form gets a segmented control instead of a signed amount; the category picker filters by type; the API validates category type against transaction type.
7. Payee. Add a `payee` column, expose it in the form with autocomplete over existing payees, and have the picker pre-fill the last category used for that payee (YNAB/Cashew pattern). Teach the AI extractor to fill payee with the merchant name.
8. Transfers. One row in the `transactions` table with `type = 'transfer'`, not a separate table. Column layout: the existing `account_id`, `amount`, and `currency` hold the source leg (`amount` negative, in the source account's currency); two nullable transfer-only columns are added, `to_account_id` and `to_amount` (positive, in the destination account's currency, whose code comes from that account). Both amounts are always captured, rate implied by the pair, per Firefly III and MMEX; same-currency transfers just repeat the amount. `base_amount` and `rate_used` from P0.4 apply to the source leg only (source amount converted to PEN at the `occurred_at` rate), and `category_id` is relaxed to nullable, required for expense/income, null for transfers. A check constraint enforces `to_account_id`/`to_amount` non-null exactly when `type = 'transfer'`. Transfers are excluded from income/expense totals and render with a distinct icon in both accounts' lists. The form swaps category for a second account picker.
9. Full server-side filtering on `GET /api/transactions`: date range on `occurred_at` with presets (this month, last month, this year, all time) plus a custom from/to range, accounts (multi), categories (multi, plus an uncategorized-only flag), tags (any/all/none), amount min/max matched on absolute value, currency, type, and a text search that matches description, payee, notes, tag names, and amount. Add sorting (date, amount) and cursor pagination keyed on (`occurred_at`, `id`) with a default page size of 50; cursor over offset because the list UI is infinite scroll and rows are inserted continuously by the ingestion pipeline, which makes offsets drift. Encode active filters in the web app's URL query string. Return a totals object for the filtered set: count, per-currency sums, and the base-currency sum.
10. Data hygiene that P0 exposes: validate UUIDs and FK existence with 404/409 responses instead of 500s, block or guide deletes of referenced accounts and categories, and store the Gmail message id on ingested transactions as an external id to dedupe reprocessing.

### P1: balances, accounts that behave like accounts, list UX, dashboard conversion

1. Opening balance per account, materialized as a starting-balance transaction (Actual/Firefly pattern), and a computed balance per account exposed by the API. Show per-account balances in the account's own currency with a PEN-converted total on the accounts page and dashboard.
2. Account archiving: an `archived_at` flag that hides the account from pickers and lists but keeps history, separate from delete. Constrain account `type` to a small enum (checking, savings, cash, credit_card), show credit cards as negative balances, and add an optional `credit_limit` column displayed as balance-against-limit on credit card accounts (BudgetBakers pattern).
3. Notes field on transactions, distinct from description/payee.
4. Tag autocomplete in the web form using the existing `GET /api/tags`, plus type-to-create.
5. List UX: month and day group headers with income/expense/net subtotals, a persistent totals bar (count plus per-currency sums plus PEN sum), bulk select with bulk recategorize and retag, inline category edit on the row, and click-through from any category, tag, or account to the pre-filtered transaction list.
6. Dashboard conversion: net balance and total spend converted to PEN using each transaction's frozen `base_amount`, with the per-currency breakdown preserved as secondary detail. Add a spending-over-time bar chart (income vs expense per month) using the already registered ECharts BarChart, and month-vs-previous-month percentage deltas (Toshl pattern).
7. Saved filters: persist named filter sets server-side and list them above the register (Actual pattern). URL persistence from P0 makes them shareable.
8. Currency picker UX: searchable list with recent currencies pinned, last-used currency sticking as the next default (Toshl), and the transaction currency defaulting to the selected account's currency and updating when the account changes.
9. Telegram edit surface: allow correcting amount, currency, account, and `occurred_at` via reply, since those are exactly the fields the extractor gets wrong.

### P2: budgets, recurring, splits, reconciliation, deeper reports

1. Per-category monthly budgets in PEN with progress bars on the dashboard and an optional rollover toggle (Monarch/Toshl pattern). Convert foreign spends into the budget currency at the day's rate via `base_amount`.
2. Recurring transactions as a spawner entity (Firefly III model) for the few bills that do not arrive by email.
3. Split transactions: parent/child rows, children sum to parent, per-child category, Distribute-remainder helper (Actual pattern).
4. Reconciliation: cleared/reconciled states and a statement-balance workflow that creates an adjustment transaction (YNAB/Actual pattern).
5. Reports: category trends over time, top payees, largest expenses per period, average monthly spend per category, and a net worth / balance-over-time line chart (per-account balances summed per month, converted to PEN, Actual pattern; builds on P1 balances and P0 rates), all in PEN with drill-down to the filtered transaction list.
6. Search grammar: a Firefly-style `field_verb:` query syntax over the same filter params, reusable later for automation rules.
7. Quick entry: transaction templates and duplicate-to-today (Wallet/Cashew pattern), and keyboard shortcuts on the web register (Actual grammar).
8. CSV export of the filtered set, then import.

Deliberately out of scope: bank feeds, investment holdings, multi-user auth beyond the existing seam, FX gain/loss accounting (revalue at latest rate for display and store both legs of every conversion instead, per the consumer-app consensus), and receipt attachments.
