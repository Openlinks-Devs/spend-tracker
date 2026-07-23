import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { parseEncryptionKeys, encryptSecret, decryptSecret } from '../src/connections/crypto.js'

function keyEntry(version: number): string {
  return `${version}:${randomBytes(32).toString('base64')}`
}

describe('connection token crypto', () => {
  it('round-trips a secret and never stores plaintext', () => {
    const keys = parseEncryptionKeys(keyEntry(1))
    const { blob, keyVersion } = encryptSecret('refresh-token-abc', keys, 'conn-1')
    expect(keyVersion).toBe(1)
    expect(blob.toString('utf8')).not.toContain('refresh-token-abc')
    expect(decryptSecret(blob, keyVersion, keys, 'conn-1')).toBe('refresh-token-abc')
  })

  it('still decrypts v1 blobs after a v2 key is added, and writes with the newest key', () => {
    const version1 = keyEntry(1)
    const keysV1 = parseEncryptionKeys(version1)
    const { blob, keyVersion } = encryptSecret('older-secret', keysV1, 'conn-2')
    const keysBoth = parseEncryptionKeys(`${version1},${keyEntry(2)}`)
    expect(decryptSecret(blob, keyVersion, keysBoth, 'conn-2')).toBe('older-secret')
    expect(encryptSecret('newer-secret', keysBoth, 'conn-2').keyVersion).toBe(2)
  })

  it('fails to decrypt with the wrong AAD (blob bound to its connection)', () => {
    const keys = parseEncryptionKeys(keyEntry(1))
    const { blob, keyVersion } = encryptSecret('secret', keys, 'conn-a')
    expect(() => decryptSecret(blob, keyVersion, keys, 'conn-b')).toThrow()
  })

  it('rejects malformed key config', () => {
    expect(() => parseEncryptionKeys('')).toThrow()
    expect(() => parseEncryptionKeys('1:short')).toThrow()
    expect(() => parseEncryptionKeys('x:' + randomBytes(32).toString('base64'))).toThrow()
  })
})
