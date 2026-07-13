package com.openlinks.spendtracker

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.SharedPrefsStore
import com.openlinks.spendtracker.ui.AuthGate
import com.openlinks.spendtracker.ui.SessionViewModel
import com.openlinks.spendtracker.ui.theme.SpendTrackerTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // The AuthGate keeps mock parity: in a mock build (USE_MOCK_AUTH=true) it
        // always renders the Shell, so the default debug flow is unchanged. Only a
        // live build routes a signed-out user to the Google sign-in screen.
        val sessionStore = SessionStore(SharedPrefsStore(applicationContext))

        setContent {
            SpendTrackerTheme {
                val viewModel: SessionViewModel = viewModel(factory = SessionViewModel.factory(sessionStore))
                AuthGate(viewModel = viewModel)
            }
        }
    }
}
