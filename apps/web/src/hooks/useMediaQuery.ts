import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query from JS.
 *
 * Used where a layout decision cannot be expressed in CSS because it changes the
 * *data* a component renders rather than how it is painted - the spend heatmap
 * picks how many months of cells to draw, which no stylesheet can do.
 *
 * Prefer a Tailwind breakpoint whenever the change is purely visual.
 */
export function useMediaQuery(query: string): boolean {
  // Same guard as lib/theme: matchMedia is absent in jsdom and non-browser
  // environments, and an unguarded call throws at render.
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false))

  useEffect(() => {
    if (!supported) return
    const mediaQueryList = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    // Re-read on subscribe: the query may already have changed between the
    // initial render and this effect running.
    setMatches(mediaQueryList.matches)
    mediaQueryList.addEventListener('change', onChange)
    return () => mediaQueryList.removeEventListener('change', onChange)
  }, [query, supported])

  return matches
}
