import { describe, it, expect, vi } from 'vitest'
import { hasImportSource, recordImportSource } from '../src/connections/importSource.js'

describe('import source dedupe', () => {
  it('hasImportSource checks the composite key', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ exists: 1 }] }) }
    expect(await hasImportSource(db, 'conn-1', 'msg-9')).toBe(true)
    expect(db.query.mock.calls[0][1]).toEqual(['conn-1', 'msg-9'])
  })

  it('recordImportSource is idempotent via ON CONFLICT DO NOTHING', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await recordImportSource(db, 'conn-1', 'msg-9', null)
    const [insertSql] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/ON CONFLICT/i)
    expect(insertSql).toMatch(/DO NOTHING/i)
  })
})
