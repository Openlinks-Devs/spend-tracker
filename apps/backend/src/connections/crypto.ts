import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface VersionedKey {
  version: number
  key: Buffer
}

// CONNECTION_ENCRYPTION_KEYS format: "1:<base64 32-byte key>,2:<base64 32-byte key>".
// New writes use the highest version; reads use the row's key_version, so adding
// a key rotates encryption without forcing users to re-auth.
export function parseEncryptionKeys(raw: string): VersionedKey[] {
  const entries = raw.split(',').filter((entry) => entry.trim() !== '')
  const keys = entries.map((entry) => {
    const separatorIndex = entry.indexOf(':')
    const version = Number(entry.slice(0, separatorIndex))
    const key = Buffer.from(entry.slice(separatorIndex + 1), 'base64')
    if (separatorIndex < 1 || !Number.isInteger(version) || version < 1 || key.length !== 32) {
      throw new Error('CONNECTION_ENCRYPTION_KEYS entries must be "<version>:<base64 32-byte key>"')
    }
    return { version, key }
  })
  if (keys.length === 0) {
    throw new Error('CONNECTION_ENCRYPTION_KEYS must contain at least one key')
  }
  return keys
}

// Blob layout: iv(12) || ciphertext || tag(16). AAD binds the blob to its
// connection row so a ciphertext cannot be swapped onto another row.
export function encryptSecret(
  plaintext: string,
  keys: VersionedKey[],
  aad: string,
): { blob: Buffer; keyVersion: number } {
  const newest = keys.reduce((best, candidate) =>
    candidate.version > best.version ? candidate : best,
  )
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', newest.key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { blob: Buffer.concat([iv, ciphertext, cipher.getAuthTag()]), keyVersion: newest.version }
}

export function decryptSecret(
  blob: Buffer,
  keyVersion: number,
  keys: VersionedKey[],
  aad: string,
): string {
  const matching = keys.find((candidate) => candidate.version === keyVersion)
  if (!matching) {
    throw new Error(`No encryption key configured for version ${keyVersion}`)
  }
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(blob.length - 16)
  const ciphertext = blob.subarray(12, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', matching.key, iv)
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
