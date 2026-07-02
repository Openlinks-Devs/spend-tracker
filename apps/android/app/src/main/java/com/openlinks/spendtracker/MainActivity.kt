package com.openlinks.spendtracker

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.SharedPrefsStore
import com.openlinks.spendtracker.ui.SessionViewModel
import com.openlinks.spendtracker.ui.SpendTrackerApp
import com.openlinks.spendtracker.ui.theme.SpendTrackerTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Mock-mode build: no auth gate. The seam is still present (SessionStore +
        // x-mock-user header) so live auth can be added later without reshaping this.
        val sessionStore = SessionStore(SharedPrefsStore(applicationContext))

        setContent {
            SpendTrackerTheme {
                val viewModel: SessionViewModel = viewModel(factory = SessionViewModel.factory(sessionStore))
                SpendTrackerApp(viewModel = viewModel)
            }
        }
    }
}
