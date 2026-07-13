import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchDailyRates, backfillRate, startRateFetching } from '../src/currency/fetchRates.js'

function fakeResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as unknown as Response
}

// ExchangeRate-API v6 shape as served by the MMEX mirror.
// 1783814401 is 2026-07-12T00:00:01Z, so the snapshot date is 2026-07-12.
const dailyPayload = {
  base_code: 'USD',
  time_last_update_unix: 1783814401,
  conversion_rates: { PEN: 3.74, EUR: 0.92, USD: 1, XXX: 5.5 },
}

describe('fetchDailyRates', () => {
  it('upserts every known non-USD code and skips unknown codes', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'PEN' }, { code: 'EUR' }, { code: 'USD' }] })
        .mockResolvedValue({ rows: [{}] }),
    }
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(dailyPayload))

    const result = await fetchDailyRates(db, fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://moneymanagerex.org/currency/data/latest_USD.json',
    )
    // 1 currencies select + 2 upserts (PEN, EUR); USD and unknown XXX skipped.
    expect(db.query).toHaveBeenCalledTimes(3)
    const [penSql, penParams] = db.query.mock.calls[1]
    expect(penSql).toMatch(/insert into exchange_rates/i)
    expect(penSql).toMatch(/on conflict \(base_code, quote_code, date\) do update/i)
    expect(penParams).toEqual(['USD', 'PEN', '2026-07-12', 3.74, 'exchangerate-api'])
    expect(result).toEqual({ upserted: 2 })
  })

  it('never overwrites manual rows and does not count blocked upserts', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'PEN' }, { code: 'EUR' }] })
        .mockResolvedValueOnce({ rows: [{}] }) // PEN written
        .mockResolvedValueOnce({ rows: [] }), // EUR blocked by manual guard
    }
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(dailyPayload))

    const result = await fetchDailyRates(db, fetchImpl as unknown as typeof fetch)

    const [upsertSql] = db.query.mock.calls[1]
    expect(upsertSql).toMatch(/where exchange_rates\.source <> 'manual'/i)
    expect(result).toEqual({ upserted: 1 })
  })

  it('throws on a non-ok response', async () => {
    const db = { query: vi.fn() }
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 503))
    await expect(fetchDailyRates(db, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/)
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('backfillRate', () => {
  const originalKey = process.env.EXCHANGERATE_HOST_KEY

  beforeEach(() => {
    process.env.EXCHANGERATE_HOST_KEY = 'test-key'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.EXCHANGERATE_HOST_KEY
    else process.env.EXCHANGERATE_HOST_KEY = originalKey
  })

  it('returns null without fetching when the key is absent', async () => {
    delete process.env.EXCHANGERATE_HOST_KEY
    const db = { query: vi.fn() }
    const fetchImpl = vi.fn()

    const stored = await backfillRate(db, 'PEN', '2026-01-15', fetchImpl as unknown as typeof fetch)

    expect(stored).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(db.query).not.toHaveBeenCalled()
  })

  it('fetches the historical quote and stores it as exchangerate-host', async () => {
    const storedRow = {
      base_code: 'USD',
      quote_code: 'PEN',
      date: '2026-01-15',
      rate: 3.7101,
      source: 'exchangerate-host',
    }
    const db = { query: vi.fn().mockResolvedValue({ rows: [storedRow] }) }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ success: true, quotes: { USDPEN: 3.7101 } }))

    const stored = await backfillRate(db, 'PEN', '2026-01-15', fetchImpl as unknown as typeof fetch)

    const requestedUrl = fetchImpl.mock.calls[0][0] as string
    expect(requestedUrl).toContain('https://api.exchangerate.host/historical')
    expect(requestedUrl).toContain('date=2026-01-15')
    expect(requestedUrl).toContain('source=USD')
    expect(requestedUrl).toContain('access_key=test-key')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into exchange_rates/i)
    expect(params).toEqual(['USD', 'PEN', '2026-01-15', 3.7101, 'exchangerate-host'])
    expect(stored).toEqual(storedRow)
  })

  it('returns null when the payload has no quote for the code', async () => {
    const db = { query: vi.fn() }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ success: true, quotes: { USDEUR: 0.92 } }))

    const stored = await backfillRate(db, 'PEN', '2026-01-15', fetchImpl as unknown as typeof fetch)

    expect(stored).toBeNull()
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('startRateFetching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches once at startup and again after the interval, surviving failures', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [] }), // currencies select empty: zero upserts
    }
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down')) // startup tick fails, loop must survive
      .mockResolvedValue(fakeResponse(dailyPayload))

    const stop = startRateFetching(db, 24 * 60 * 60 * 1000, fetchImpl as unknown as typeof fetch)

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
