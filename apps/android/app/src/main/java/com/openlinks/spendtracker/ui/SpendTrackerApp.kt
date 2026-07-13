package com.openlinks.spendtracker.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.screens.SummaryScreen
import com.openlinks.spendtracker.ui.screens.TransactionDetailScreen
import com.openlinks.spendtracker.ui.screens.TransactionFormScreen
import com.openlinks.spendtracker.ui.screens.TransactionsListScreen

private object Routes {
    const val SUMMARY = "summary"
    const val TRANSACTIONS = "transactions"
    const val DETAIL = "transactions/{id}"
    const val CREATE = "create_transaction"
    const val EDIT = "transactions/{id}/edit"

    fun detail(id: String) = "transactions/$id"
    fun edit(id: String) = "transactions/$id/edit"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpendTrackerApp(viewModel: SessionViewModel) {
    val navController = rememberNavController()
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.refresh() }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = currentRoute == Routes.SUMMARY || currentRoute == Routes.TRANSACTIONS
    val topBarTitle = when (currentRoute) {
        Routes.SUMMARY -> Strings.get(StringKey.SummaryTitle)
        Routes.TRANSACTIONS -> Strings.get(StringKey.TransactionsTitle)
        Routes.DETAIL -> Strings.get(StringKey.TransactionDetailTitle)
        Routes.CREATE -> Strings.get(StringKey.FormCreateTitle)
        Routes.EDIT -> Strings.get(StringKey.FormEditTitle)
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
                FloatingActionButton(onClick = { navController.navigate(Routes.CREATE) }) {
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
                )
            }
            composable(Routes.TRANSACTIONS) {
                TransactionsListScreen(
                    state = state,
                    onOpenTransaction = { id -> navController.navigate(Routes.detail(id)) },
                    onUpdateFilters = viewModel::updateFilters,
                    onClearFilters = viewModel::clearFilters,
                )
            }
            composable(Routes.CREATE) {
                TransactionFormScreen(
                    editingId = null,
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
