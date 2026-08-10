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
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    // Re-read on subscribe: the query may already have changed between the
    // initial render and this effect running.
    setMatches(mediaQueryList.matches)
    mediaQueryList.addEventListener('change', onChange)
    return () => mediaQueryList.removeEventListener('change', onChange)
  }, [query])

  return matches
}
