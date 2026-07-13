import { describe, it, expect } from 'vitest'
import { parseAllowedEmails, isEmailAllowed } from '../src/auth/allowlist.js'

describe('allowlist', () => {
  it('parses a comma list, trims, lowercases, drops empties', () => {
    expect(parseAllowedEmails(' A@x.com , b@Y.com ,')).toEqual(['a@x.com', 'b@y.com'])
  })
  it('allows an email on the list case- and space-insensitively', () => {
    const allowed = parseAllowedEmails('misaelabanto@gmail.com')
    expect(isEmailAllowed('  MisaelAbanto@Gmail.com ', allowed)).toBe(true)
  })
  it('rejects an email not on the list', () => {
    expect(isEmailAllowed('intruder@evil.com', ['misaelabanto@gmail.com'])).toBe(false)
  })
  it('rejects when the list is empty', () => {
    expect(isEmailAllowed('anyone@x.com', [])).toBe(false)
  })
})
