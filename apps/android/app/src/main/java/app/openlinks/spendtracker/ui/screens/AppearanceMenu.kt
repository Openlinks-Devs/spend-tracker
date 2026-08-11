package app.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrightnessAuto
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.ThemePreference
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.theme.LocalThemeController

private val appearanceOptions: List<Pair<ThemePreference, StringKey>> = listOf(
    ThemePreference.Light to StringKey.ThemeLight,
    ThemePreference.Dark to StringKey.ThemeDark,
    ThemePreference.System to StringKey.ThemeSystem,
)

private fun iconFor(preference: ThemePreference): ImageVector = when (preference) {
    ThemePreference.Light -> Icons.Filled.LightMode
    ThemePreference.Dark -> Icons.Filled.DarkMode
    ThemePreference.System -> Icons.Filled.BrightnessAuto
}

/**
 * The three-state appearance control: light, dark, or follow the system.
 *
 * Self-contained on purpose. It reads [LocalThemeController] instead of taking a
 * value and a setter, so dropping it into the app bar is a one-line insertion and
 * no composable in between has to carry theme parameters it does not otherwise use.
 *
 * Rendered as a plain labelled option list (a heading plus three menu items with a
 * check on the active one), not chips or micro-caps decoration.
 */
@Composable
fun AppearanceMenu(modifier: Modifier = Modifier) {
    val themeController = LocalThemeController.current
    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier) {
        IconButton(onClick = { expanded = true }) {
            Icon(
                imageVector = iconFor(themeController.preference),
                contentDescription = Strings.get(StringKey.Appearance),
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Text(
                text = Strings.get(StringKey.Appearance),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            appearanceOptions.forEach { (preference, labelKey) ->
                val selected = themeController.preference == preference
                DropdownMenuItem(
                    text = { Text(Strings.get(labelKey)) },
                    leadingIcon = { Icon(iconFor(preference), contentDescription = null) },
                    trailingIcon = {
                        if (selected) {
                            Icon(Icons.Filled.Check, contentDescription = null)
                        }
                    },
                    onClick = {
                        themeController.updatePreference(preference)
                        expanded = false
                    },
                )
            }
        }
    }
}
