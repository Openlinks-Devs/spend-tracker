// Theme store. Deliberately a module-level store rather than React context so
// anything can read it - including the ECharts wrapper, which needs the resolved
// theme at init time, outside any provider tree.

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

// Shared with the inline boot script in index.html and with the standalone legal
// documents, which read the same key so they match the app.
export const THEME_STORAGE_KEY = 'spendtracker-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

// matchMedia is missing in jsdom and in any non-browser environment. Treating
// that as "no dark preference" keeps the module importable everywhere instead of
// throwing at import time, which took the whole test suite down.
function matchDarkQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia(DARK_QUERY)
}

function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return matchDarkQuery()?.matches ? 'dark' : 'light'
}

let preference: ThemePreference = readStoredPreference()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** Tailwind's dark variant here is `.dark`, applied on <html>. */
function applyToDocument() {
  if (typeof document === 'undefined') return
  const isDark = resolveTheme(preference) === 'dark'
  document.documentElement.classList.toggle('dark', isDark)
  // Lets the browser paint form controls, scrollbars and the address bar to
  // match, which is the difference between "dark themed" and "dark app".
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
}

export function getThemePreference(): ThemePreference {
  return preference
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  if (typeof localStorage !== 'undefined') {
    // 'system' is the absence of a choice, so it clears rather than stores.
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  }
  applyToDocument()
  notify()
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Snapshot for useSyncExternalStore: a primitive, so identity stays stable. */
export function getResolvedThemeSnapshot(): ResolvedTheme {
  return resolveTheme(preference)
}

/**
 * Follow the OS while the preference is 'system'. Registered once at startup;
 * without it, changing the system theme leaves an open tab on the stale one.
 */
export function watchSystemTheme(): () => void {
  const mediaQueryList = matchDarkQuery()
  if (!mediaQueryList) return () => {}
  const onChange = () => {
    if (preference === 'system') {
      applyToDocument()
      notify()
    }
  }
  mediaQueryList.addEventListener('change', onChange)
  return () => mediaQueryList.removeEventListener('change', onChange)
}

// Apply immediately on import so the class is right before first paint of the
// React tree. index.html also inlines this to avoid a flash on cold load.
applyToDocument()
