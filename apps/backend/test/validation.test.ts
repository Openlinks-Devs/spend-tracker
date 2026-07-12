import { describe, it, expect } from 'vitest'
import { isUuid } from '../src/routes/validation.js'

describe('isUuid', () => {
  it('accepts a canonical uuid', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuid('A6E7B8C9-D0E1-42F3-A4B5-C6D7E8F9A0B1')).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isUuid('nope')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('11111111-1111-4111-8111-11111111111')).toBe(false)
    expect(isUuid('11111111-1111-4111-8111-111111111111 ')).toBe(false)
    expect(isUuid('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false)
  })
})
