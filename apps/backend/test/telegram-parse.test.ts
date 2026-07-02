import { describe, it, expect } from 'vitest'
import { parseTransactionId, parseEdit } from '../src/telegram/parse.js'

describe('telegram parse', () => {
  it('extracts the transaction id from a notification reply', () => {
    expect(parseTransactionId('Nueva\nID: tx-123\nAccount: x')).toBe('tx-123')
  })

  it('returns null when no id line is present', () => {
    expect(parseTransactionId('no id here')).toBeNull()
  })

  it('parses description and bracket tags', () => {
    const result = parseEdit('Almuerzo con equipo\n[food, work]')
    expect(result.description).toBe('Almuerzo con equipo')
    expect(result.tags).toEqual(['food', 'work'])
  })

  it('parses description with no tags', () => {
    expect(parseEdit('Solo descripcion').tags).toEqual([])
  })
})
