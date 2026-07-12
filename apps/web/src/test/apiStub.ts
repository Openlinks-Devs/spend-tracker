import { vi } from 'vitest'

export function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface ApiRoute {
  match: string
  data: unknown | ((url: string) => unknown)
}

export interface ApiStub {
  fetchMock: ReturnType<typeof vi.fn>
  requestedUrls: () => string[]
}

// Replaces global fetch with a router over substring matches. First match wins,
// so list more specific routes first.
export function stubApiFetch(routes: ApiRoute[]): ApiStub {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const route of routes) {
      if (url.includes(route.match)) {
        const data =
          typeof route.data === 'function'
            ? (route.data as (requestUrl: string) => unknown)(url)
            : route.data
        return jsonResponse(data)
      }
    }
    return new Response(JSON.stringify({ error: `Unmatched request: ${url}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    requestedUrls: () => fetchMock.mock.calls.map((call) => String(call[0])),
  }
}
