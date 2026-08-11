import { useEffect, useSyncExternalStore } from 'react'
import {
  getResolvedThemeSnapshot,
  getThemePreference,
  setThemePreference,
  subscribeToTheme,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'

/** The theme actually in effect, with 'system' already resolved. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribeToTheme,
    getResolvedThemeSnapshot,
    // Server snapshot: the boot script has not run, so assume light.
    () => 'light' as ResolvedTheme,
  )
}

export function useIsDarkTheme(): boolean {
  return useResolvedTheme() === 'dark'
}

/** The stored preference plus a setter, for the theme control itself. */
export function useThemePreference(): {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => void
} {
  const resolved = useResolvedTheme()
  // Subscribed above, so this re-reads on every change.
  const preference = getThemePreference()

  // One OS listener for the whole app; re-subscribing per consumer would be
  // wasteful and the store already fans out to every subscriber.
  useEffect(() => watchSystemTheme(), [])

  return { preference, resolved, setPreference: setThemePreference }
}
