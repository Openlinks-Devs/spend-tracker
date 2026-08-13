package app.openlinks.spendtracker.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openlinks.spendtracker.BuildConfig
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.screens.AppearanceMenu
import app.openlinks.spendtracker.ui.screens.ConnectionAlertBanner
import app.openlinks.spendtracker.ui.screens.IntegrationsScreen
import app.openlinks.spendtracker.ui.screens.SummaryScreen
import app.openlinks.spendtracker.ui.screens.TransactionDetailScreen
import app.openlinks.spendtracker.ui.screens.TransactionFormScreen
import app.openlinks.spendtracker.ui.screens.TransactionsListScreen
import app.openlinks.spendtracker.ui.screens.TransferFormScreen
import app.openlinks.spendtracker.ui.screens.openExternalUrl

private object Routes {
    const val SUMMARY = "summary"
    const val TRANSACTIONS = "transactions"
    const val INTEGRATIONS = "integrations"
    const val DETAIL = "transactions/{id}"
    const val CREATE = "create_transaction?from={from}"
    const val EDIT = "transactions/{id}/edit"
    const val TRANSFER = "create_transfer"

    fun detail(id: String) = "transactions/$id"
    fun edit(id: String) = "transactions/$id/edit"

    // A duplicate is a create pre-filled from an existing transaction, so it is
    // the same destination with the template's id attached.
    fun create(templateId: String? = null) =
        if (templateId == null) "create_transaction" else "create_transaction?from=$templateId"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpendTrackerApp(viewModel: SessionViewModel) {
    val navController = rememberNavController()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val connectionsState by viewModel.connectionsState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.refresh()
        // Loaded app-wide, not just when the Integrations screen opens, because
        // the navigation badge and the banner have to report a broken account
        // from anywhere. In mock mode the backend answers 503 and the list stays
        // empty, so both stay silent there by construction.
        viewModel.loadConnections()
    }

    val brokenConnections = brokenGmailConnections(connectionsState.connections)

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val topLevelRoutes = listOf(Routes.SUMMARY, Routes.TRANSACTIONS, Routes.INTEGRATIONS)
    val showBottomBar = currentRoute in topLevelRoutes
    val topBarTitle = when (currentRoute) {
        Routes.SUMMARY -> Strings.get(StringKey.SummaryTitle)
        Routes.TRANSACTIONS -> Strings.get(StringKey.TransactionsTitle)
        Routes.INTEGRATIONS -> Strings.get(StringKey.IntegrationsTitle)
        Routes.DETAIL -> Strings.get(StringKey.TransactionDetailTitle)
        Routes.CREATE -> Strings.get(StringKey.FormCreateTitle)
        Routes.EDIT -> Strings.get(StringKey.FormEditTitle)
        Routes.TRANSFER -> Strings.get(StringKey.TransferTitle)
        else -> Strings.get(StringKey.AppTitle)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(topBarTitle) },
                navigationIcon = {
                    if (!showBottomBar) {
                        androidx.compose.material3.IconButton(onClick = { navController.popBackStack() }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = Strings.get(StringKey.ActionBack),
                            )
                        }
                    }
                },
                actions = {
                    if (currentRoute == Routes.TRANSACTIONS) {
                        androidx.compose.material3.IconButton(
                            onClick = { navController.navigate(Routes.TRANSFER) },
                        ) {
                            Icon(
                                imageVector = Icons.Filled.SwapHoriz,
                                contentDescription = Strings.get(StringKey.ActionTransfer),
                            )
                        }
                    }
                    // The appearance control lives on the top-level screens only, for
                    // the same reason sign-out does: the detail and form screens hand
                    // their action slots to the task at hand, and back is one tap away.
                    // It is not gated on the mock flag, because the preference is a
                    // device setting and has nothing to do with having a session.
                    if (showBottomBar) {
                        AppearanceMenu()
                    }
                    // Sign-out only exists in live builds; a mock build has no session
                    // to end and stays exactly as before.
                    if (!BuildConfig.USE_MOCK_AUTH && showBottomBar) {
                        androidx.compose.material3.IconButton(onClick = { viewModel.signOut(context) }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Logout,
                                contentDescription = Strings.get(StringKey.ActionSignOut),
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    val destinations = listOf(
                        Triple(Routes.SUMMARY, Icons.Filled.Home, Strings.get(StringKey.NavSummary)),
                        Triple(
                            Routes.TRANSACTIONS,
                            Icons.AutoMirrored.Filled.List,
                            Strings.get(StringKey.NavTransactions),
                        ),
                        Triple(
                            Routes.INTEGRATIONS,
                            Icons.Filled.Link,
                            Strings.get(StringKey.NavIntegrations),
                        ),
                    )
                    destinations.forEach { (route, icon, label) ->
                        val selected = backStackEntry?.destination?.hierarchy?.any { it.route == route } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                // A dot on Integrations whenever an account
                                // stopped importing, so the state is reachable
                                // without opening that screen.
                                if (route == Routes.INTEGRATIONS && brokenConnections.isNotEmpty()) {
                                    BadgedBox(
                                        badge = {
                                            Badge(
                                                modifier = Modifier.semantics {
                                                    contentDescription =
                                                        Strings.get(StringKey.ConnectionNeedsAttention)
                                                },
                                            )
                                        },
                                    ) {
                                        Icon(icon, contentDescription = label)
                                    }
                                } else {
                                    Icon(icon, contentDescription = label)
                                }
                            },
                            label = { Text(label) },
                        )
                    }
                }
            }
        },
        floatingActionButton = {
            if (currentRoute == Routes.TRANSACTIONS) {
                FloatingActionButton(onClick = { navController.navigate(Routes.create()) }) {
                    Icon(Icons.Filled.Add, contentDescription = Strings.get(StringKey.ActionAdd))
                }
            }
        },
    ) { innerPadding ->
        Column(modifier = Modifier.padding(innerPadding)) {
            // Mounted in the shell rather than inside a screen so a broken
            // account is visible wherever the user happens to be. The
            // Integrations screen is excluded: it already lists the same
            // accounts row by row, so the banner would only repeat it.
            if (currentRoute != Routes.INTEGRATIONS) {
                ConnectionAlertBanner(
                    brokenConnections = if (connectionsState.alertDismissed) {
                        emptyList()
                    } else {
                        brokenGmailConnections(connectionsState.connections)
                    },
                    onReconnect = { navController.navigate(Routes.INTEGRATIONS) },
                    onDismiss = viewModel::dismissConnectionAlert,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            NavHost(
                navController = navController,
                startDestination = Routes.SUMMARY,
            ) {
            composable(Routes.SUMMARY) {
                SummaryScreen(
                    state = state,
                    onOpenTransaction = { id -> navController.navigate(Routes.detail(id)) },
                    onUpdateFilters = viewModel::updateFilters,
                    onClearFilters = viewModel::clearFilters,
                    onSetCurrency = viewModel::setCurrency,
                    onSetBucket = viewModel::setBucket,
                    // Tapping a day in the heatmap drills into it, the same way
                    // the web client does: narrow the range to that single day
                    // and show the transactions behind the cell. "custom" is not
                    // a backend range preset, which is exactly what makes the
                    // server fall through to using from/to verbatim. The display
                    // currency is pinned because the heatmap charts one currency,
                    // so without it the list would total more than the cell.
                    onSelectDay = { dayKey ->
                        dayFilterWindow(dayKey)?.let { (from, to) ->
                            viewModel.updateFilters { filters ->
                                filters.copy(
                                    range = "custom",
                                    from = from,
                                    to = to,
                                    currency = state.displayCurrency,
                                )
                            }
                            navController.navigate(Routes.TRANSACTIONS)
                        }
                    },
                )
            }
            composable(Routes.TRANSACTIONS) {
                TransactionsListScreen(
                    state = state,
                    onOpenTransaction = { id -> navController.navigate(Routes.detail(id)) },
                    onUpdateFilters = viewModel::updateFilters,
                    onClearFilters = viewModel::clearFilters,
                    onSetCurrency = viewModel::setCurrency,
                )
            }
            composable(
                route = Routes.CREATE,
                arguments = listOf(
                    navArgument("from") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                TransactionFormScreen(
                    editingId = null,
                    templateId = entry.arguments?.getString("from"),
                    state = state,
                    onSubmitCreate = { newTransaction ->
                        viewModel.createTransaction(newTransaction) { success ->
                            if (success) navController.popBackStack()
                        }
                    },
                    onSubmitUpdate = { _, _ -> },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Routes.TRANSFER) {
                TransferFormScreen(
                    state = state,
                    onSubmit = { transfer ->
                        viewModel.createTransfer(transfer) { success ->
                            if (success) navController.popBackStack()
                        }
                    },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Routes.INTEGRATIONS) {
                val connectionsState by viewModel.connectionsState.collectAsStateWithLifecycle()
                // Linking Gmail finishes in a browser, so the only reliable signal
                // that the list changed is the user coming back to this screen.
                LifecycleResumeEffect(Unit) {
                    viewModel.loadConnections()
                    onPauseOrDispose { }
                }
                IntegrationsScreen(
                    state = connectionsState,
                    onLinkGmail = {
                        viewModel.linkGmail { url -> openExternalUrl(context, url) }
                    },
                    onConnectTelegram = {
                        viewModel.pairTelegram { deepLink -> openExternalUrl(context, deepLink) }
                    },
                    onRemove = viewModel::removeConnection,
                )
            }
            composable(Routes.EDIT) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                TransactionFormScreen(
                    editingId = id,
                    state = state,
                    onSubmitCreate = { },
                    onSubmitUpdate = { transactionId, update ->
                        viewModel.updateTransaction(transactionId, update) { success ->
                            if (success) navController.popBackStack()
                        }
                    },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Routes.DETAIL) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                TransactionDetailScreen(
                    transactionId = id,
                    state = state,
                    onEdit = { transactionId -> navController.navigate(Routes.edit(transactionId)) },
                    onDuplicate = { transactionId -> navController.navigate(Routes.create(transactionId)) },
                    onDelete = { transactionId ->
                        viewModel.deleteTransaction(transactionId) { success ->
                            if (success) navController.popBackStack()
                        }
                    },
                )
            }
            }
        }
    }
}
