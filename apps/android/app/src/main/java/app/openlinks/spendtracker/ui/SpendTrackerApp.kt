package app.openlinks.spendtracker.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.SwapHoriz
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
    val context = LocalContext.current

    LaunchedEffect(Unit) { viewModel.refresh() }

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
                            icon = { Icon(icon, contentDescription = label) },
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
        NavHost(
            navController = navController,
            startDestination = Routes.SUMMARY,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Routes.SUMMARY) {
                SummaryScreen(
                    state = state,
                    onOpenTransaction = { id -> navController.navigate(Routes.detail(id)) },
                    onUpdateFilters = viewModel::updateFilters,
                    onClearFilters = viewModel::clearFilters,
                    onSetCurrency = viewModel::setCurrency,
                    onSetBucket = viewModel::setBucket,
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
