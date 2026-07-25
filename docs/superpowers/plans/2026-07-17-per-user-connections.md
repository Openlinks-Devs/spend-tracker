# Per-User Connections (Gmail + Telegram) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each signed-in user link their own Gmail account(s) and Telegram chat so transaction imports and Telegram edits are scoped to that user, replacing the single-owner env-based integration.

**Architecture:** A `connection` table holds each linked external account (encrypted Gmail refresh tokens, Telegram chat ids). Linking flows mint single-use DB-backed codes (`pairing_code`); the Gmail OAuth callback lives outside the session guard and trusts only that code. The poller iterates active Gmail connections with an n8n-style timestamp cursor (`messages.list` + `after:`), dedupes via `import_source`, and attributes imports to the connection's user. Premium (`user.is_premium`) caps Gmail connections at 1 free / 5 premium.

**Tech Stack:** Hono + Better Auth + node-postgres on the backend; googleapis for Gmail; node:crypto AES-256-GCM; Vitest; React + TanStack Query on web.

**Spec:** `docs/superpowers/specs/2026-07-17-per-user-connections-design.md` (read it before starting any task).

## Global Constraints

- **Hard prerequisite:** the multi-tenancy plan (`docs/superpowers/plans/2026-07-15-multi-tenancy-prod.md`) is fully executed. This plan consumes its products: `AppVariables`/`getUserId(context)` from `apps/backend/src/http/context.ts`; user-scoped queries `insertTransaction(db, userId, transaction)`, `getTransactionById(db, userId, id)`, `updateTransaction(db, userId, update)`, `deleteTransaction(db, userId, id)`, `getCategories(db, userId)`, `getDistinctTags(db, userId)`; and the migration runner that applies all `NNN_*.sql` files.
- Run backend commands as `pnpm --filter backend <script>` from the repo root. Tests: `pnpm --filter backend test`. Typecheck: `pnpm --filter backend typecheck`. Web: `pnpm --filter web test` / `typecheck`.
- Never use em dashes anywhere (code, comments, commits, docs). Use a hyphen, colon, comma, or two sentences.
- Descriptive variable names always (`connection`, `pairingCode`, `userId`); no single-letter domain bindings.
- Commit each task via `commita --no-push -x "<intent>"`. Never `git add && git commit`.
- Better Auth tables are quoted lowercase: `"user"("id")`. Ledger tables: `accounts`, `categories`, `transactions`.
- Connections are live-mode only: in `APP_MODE=mock`, connection endpoints return `503 { error: 'connections_require_live_mode' }` and the poller does not start.
- Premium caps: free = 1 gmail connection, premium = 5. Telegram = exactly 1 per user. Limit responses use HTTP 402 with `{ error: 'premium_required', limit: <n> }`.
- **Android parity is a separate follow-up plan** (see final section); do not attempt Kotlin changes here.

---

## File Structure

- `apps/backend/migrations/005_connections.sql` - CREATE: `connection`, `import_source`, `pairing_code` tables; `user.is_premium`.
- `apps/backend/src/connections/crypto.ts` - CREATE: versioned AES-256-GCM encrypt/decrypt + key parsing.
- `apps/backend/src/connections/pairingCodes.ts` - CREATE: mint/consume/purge single-use codes.
- `apps/backend/src/connections/queries.ts` - CREATE: connection CRUD, status/cursor updates, premium counting.
- `apps/backend/src/connections/importSource.ts` - CREATE: dedupe guard queries.
- `apps/backend/src/connections/poller.ts` - CREATE: per-connection Gmail polling loop.
- `apps/backend/src/routes/connections.ts` - CREATE: session-gated management endpoints.
- `apps/backend/src/routes/gmailCallback.ts` - CREATE: unguarded OAuth callback. `src/routes/oauth.ts` - DELETE.
- `apps/backend/src/gmail/client.ts` - MODIFY: per-token client + `listMessageIdsSince`.
- `apps/backend/src/telegram/client.ts` - MODIFY: `sendMessage(chatId, ...)` with status-carrying errors.
- `apps/backend/src/telegram/webhook.ts` - MODIFY: `/start` pairing, chat→user resolution, user-scoped edits.
- `apps/backend/src/pipeline/processEmail.ts` - MODIFY: userId + connection context, dedupe-first, notify routing.
- `apps/backend/src/config/env.ts` - MODIFY: new vars; `GOOGLE_REFRESH_TOKEN`/`TELEGRAM_CHAT_ID` become optional.
- `apps/backend/src/index.ts` - MODIFY: replace env poller with connection poller.
- `apps/web/src/pages/IntegrationsPage.tsx`, `apps/web/src/hooks/useConnections.ts` - CREATE; `api.ts`, `types.ts`, `App.tsx`, `AppLayout.tsx` - MODIFY.

---

## Phase 1 - Schema, crypto, codes

### Task 1: Migration 005 (connection, import_source, pairing_code, is_premium)

**Files:**
- Create: `apps/backend/migrations/005_connections.sql`

**Interfaces:**
- Produces: the three tables and `user.is_premium` exactly as below; later tasks' SQL depends on these names/columns.

- [ ] **Step 1: Write the migration**

```sql
-- apps/backend/migrations/005_connections.sql
-- Per-user integrations: linked external accounts, import dedupe, single-use codes.

CREATE TABLE IF NOT EXISTS connection (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  provider          text NOT NULL,
  status            text NOT NULL DEFAULT 'active',
  external_id       text NOT NULL,
  secret_encrypted  bytea,
  key_version       int,
  cursor            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz
);
CREATE INDEX IF NOT EXISTS connection_user_id_idx ON connection(user_id);
-- A user cannot link the same external account twice.
CREATE UNIQUE INDEX IF NOT EXISTS connection_user_provider_external_idx
  ON connection(user_id, provider, external_id);
-- A Telegram chat pairs to at most one user globally (deterministic webhook resolution).
CREATE UNIQUE INDEX IF NOT EXISTS connection_telegram_chat_idx
  ON connection(provider, external_id) WHERE provider = 'telegram';

CREATE TABLE IF NOT EXISTS import_source (
  connection_id  uuid NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
  message_id     text NOT NULL,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, message_id)
);

CREATE TABLE IF NOT EXISTS pairing_code (
  code        text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  purpose     text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Verify against a scratch database (if one is available)**

Run: `DATABASE_URL=<scratch> pnpm --filter backend migrate`
Expected: `Applied 005_connections.sql`. Skip if no scratch DB; downstream tasks exercise the schema.

- [ ] **Step 3: Commit**

```bash
commita --no-push -x "Add connections schema (migration 005): connection, import_source, pairing_code tables and user.is_premium, with telegram chat global uniqueness."
```

---

### Task 2: Token crypto module + env additions

**Files:**
- Create: `apps/backend/src/connections/crypto.ts`
- Modify: `apps/backend/src/config/env.ts`
- Test: `apps/backend/test/connectionsCrypto.test.ts`, `apps/backend/test/env.test.ts`

**Interfaces:**
- Produces: `parseEncryptionKeys(raw: string): VersionedKey[]`; `encryptSecret(plaintext: string, keys: VersionedKey[], aad: string): { blob: Buffer; keyVersion: number }`; `decryptSecret(blob: Buffer, keyVersion: number, keys: VersionedKey[], aad: string): string`. `VersionedKey = { version: number; key: Buffer }`.
- Produces env schema fields: `CONNECTION_ENCRYPTION_KEYS` (required, min 1), `TELEGRAM_BOT_USERNAME` (required), `APP_BASE_URL` (required); `GOOGLE_REFRESH_TOKEN` and `TELEGRAM_CHAT_ID` become `z.string().optional()`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/connectionsCrypto.test.ts
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
```

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm --filter backend test -- connectionsCrypto`
Expected: FAIL, cannot find module `../src/connections/crypto.js`.

- [ ] **Step 3: Implement the crypto module**

```typescript
// apps/backend/src/connections/crypto.ts
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
```

- [ ] **Step 4: Update the env schema**

In `apps/backend/src/config/env.ts`, inside the zod schema: change `GOOGLE_REFRESH_TOKEN: z.string().min(1),` to `GOOGLE_REFRESH_TOKEN: z.string().optional(),` and `TELEGRAM_CHAT_ID: z.string().min(1),` to `TELEGRAM_CHAT_ID: z.string().optional(),` and add:

```typescript
  CONNECTION_ENCRYPTION_KEYS: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  APP_BASE_URL: z.string().min(1),
```

Add matching entries to `apps/backend/.env.example`:

```
# Per-user connections
CONNECTION_ENCRYPTION_KEYS=1:<base64 32-byte key, e.g. openssl rand -base64 32>
TELEGRAM_BOT_USERNAME=
APP_BASE_URL=http://localhost:5173
```

Update `apps/backend/test/env.test.ts`'s valid fixture to include the three new vars (and keep the existing tests passing with `GOOGLE_REFRESH_TOKEN` removed from the required set). Add:

```typescript
it('accepts missing GOOGLE_REFRESH_TOKEN and TELEGRAM_CHAT_ID (env poller retired)', () => {
  const { GOOGLE_REFRESH_TOKEN, TELEGRAM_CHAT_ID, ...withoutLegacy } = validEnv
  expect(() => loadEnv(withoutLegacy)).not.toThrow()
})
```

- [ ] **Step 5: Run to verify PASS**

Run: `pnpm --filter backend test -- connectionsCrypto env`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Add versioned AES-256-GCM crypto for connection tokens and the connections env vars; legacy single-user GOOGLE_REFRESH_TOKEN/TELEGRAM_CHAT_ID become optional."
```

---

### Task 3: Pairing codes (mint, atomic consume, purge)

**Files:**
- Create: `apps/backend/src/connections/pairingCodes.ts`
- Test: `apps/backend/test/pairingCodes.test.ts`

**Interfaces:**
- Produces: `mintPairingCode(db, userId, purpose): Promise<string>`; `consumePairingCode(db, code, purpose): Promise<string | null>` (returns the bound userId, or null when unknown/expired/already used); `purgeExpiredPairingCodes(db): Promise<void>`; `type PairingPurpose = 'gmail_oauth' | 'telegram_pair'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/pairingCodes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mintPairingCode, consumePairingCode } from '../src/connections/pairingCodes.js'

describe('pairing codes', () => {
  it('mints a >=128-bit base64url code bound to the user and purpose', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const code = await mintPairingCode(db, 'user-1', 'telegram_pair')
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(code.length).toBeGreaterThanOrEqual(22)
    const [insertSql, params] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/INSERT INTO pairing_code/i)
    expect(params).toEqual([code, 'user-1', 'telegram_pair'])
  })

  it('consume uses one atomic UPDATE guarded on consumed_at and expiry', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ user_id: 'user-1' }] }) }
    const userId = await consumePairingCode(db, 'code-abc', 'gmail_oauth')
    expect(userId).toBe('user-1')
    const [updateSql] = db.query.mock.calls[0]
    expect(updateSql).toMatch(/UPDATE pairing_code SET consumed_at = now\(\)/i)
    expect(updateSql).toMatch(/consumed_at IS NULL/i)
    expect(updateSql).toMatch(/expires_at > now\(\)/i)
    expect(updateSql).toMatch(/RETURNING user_id/i)
  })

  it('consume returns null when no row matches (expired, used, or unknown)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await consumePairingCode(db, 'stale', 'gmail_oauth')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify FAIL** - `pnpm --filter backend test -- pairingCodes`.

- [ ] **Step 3: Implement**

```typescript
// apps/backend/src/connections/pairingCodes.ts
import { randomBytes } from 'node:crypto'
import type { Queryable } from '../db/pool.js'

export type PairingPurpose = 'gmail_oauth' | 'telegram_pair'

const CODE_TTL_MINUTES = 10

// 24 random bytes = 192 bits, base64url (32 chars): fits Telegram's 64-char
// /start payload and exceeds the 128-bit floor from the spec.
export async function mintPairingCode(
  db: Queryable,
  userId: string,
  purpose: PairingPurpose,
): Promise<string> {
  const code = randomBytes(24).toString('base64url')
  await db.query(
    `INSERT INTO pairing_code (code, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + interval '${CODE_TTL_MINUTES} minutes')`,
    [code, userId, purpose],
  )
  return code
}

// Atomic single-use consumption: the WHERE guards make a concurrent second
// redeem return zero rows, closing the double-redeem race.
export async function consumePairingCode(
  db: Queryable,
  code: string,
  purpose: PairingPurpose,
): Promise<string | null> {
  const result = await db.query(
    `UPDATE pairing_code SET consumed_at = now()
      WHERE code = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [code, purpose],
  )
  return result.rows.length ? (result.rows[0].user_id as string) : null
}

export async function purgeExpiredPairingCodes(db: Queryable): Promise<void> {
  await db.query('DELETE FROM pairing_code WHERE expires_at < now() OR consumed_at IS NOT NULL')
}
```

- [ ] **Step 4: Run to verify PASS** - `pnpm --filter backend test -- pairingCodes`.
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Add DB-backed single-use pairing codes (mint, atomic consume, purge) for Gmail OAuth state and Telegram pairing."
```

---

## Phase 2 - Connection model and routes

### Task 4: Connection queries and premium counting

**Files:**
- Create: `apps/backend/src/connections/queries.ts`
- Test: `apps/backend/test/connectionQueries.test.ts`

**Interfaces:**
- Produces:
  - `interface Connection { id: string; user_id: string; provider: 'gmail' | 'telegram'; status: 'active' | 'needs_reauth' | 'disabled'; external_id: string; key_version: number | null; cursor: string | null; created_at: string }` (no secret in the public shape)
  - `listConnections(db, userId): Promise<Connection[]>`
  - `getConnectionById(db, userId, id): Promise<(Connection & { secret_encrypted: Buffer | null }) | null>`
  - `countGmailConnections(db, userId): Promise<number>` (all non-removed rows, any status)
  - `upsertGmailConnection(db, userId, email, secretBlob, keyVersion): Promise<{ id: string }>` (insert or, on `(user_id, provider, external_id)` conflict, replace token + reactivate)
  - `replaceTelegramConnection(db, userId, chatId): Promise<{ id: string }>` (single statement: delete the user's telegram row, insert the new one)
  - `getTelegramConnectionByChatId(db, chatId): Promise<Connection | null>`
  - `getTelegramConnectionForUser(db, userId): Promise<Connection | null>`
  - `deleteConnection(db, userId, id): Promise<boolean>`
  - `setConnectionStatus(db, connectionId, status): Promise<void>`, `setConnectionCursor(db, connectionId, cursor): Promise<void>`
  - `listActiveGmailConnections(db): Promise<Array<Connection & { secret_encrypted: Buffer }>>` (all users, poller use)
  - `getUserIsPremium(db, userId): Promise<boolean>`
  - `gmailLimitFor(isPremium: boolean): number` (1 or 5)

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/connectionQueries.test.ts
import { describe, it, expect, vi } from 'vitest'
import {
  countGmailConnections,
  gmailLimitFor,
  listConnections,
  replaceTelegramConnection,
  upsertGmailConnection,
} from '../src/connections/queries.js'

describe('connection queries', () => {
  it('lists only the user connections and never selects the secret', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await listConnections(db, 'user-1')
    const [listSql, params] = db.query.mock.calls[0]
    expect(listSql).toMatch(/WHERE user_id = \$1/)
    expect(listSql).not.toMatch(/secret_encrypted/)
    expect(params).toEqual(['user-1'])
  })

  it('upsertGmailConnection replaces the token and reactivates on conflict', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'conn-1' }] }) }
    await upsertGmailConnection(db, 'user-1', 'a@gmail.com', Buffer.from('blob'), 2)
    const [upsertSql, params] = db.query.mock.calls[0]
    expect(upsertSql).toMatch(/ON CONFLICT \(user_id, provider, external_id\)/i)
    expect(upsertSql).toMatch(/status = 'active'/)
    expect(params[0]).toBe('user-1')
    expect(params[1]).toBe('a@gmail.com')
  })

  it('replaceTelegramConnection deletes the old row and inserts in one statement', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'conn-2' }] }) }
    await replaceTelegramConnection(db, 'user-1', 'chat-99')
    const [replaceSql] = db.query.mock.calls[0]
    expect(replaceSql).toMatch(/WITH removed AS \(/i)
    expect(replaceSql).toMatch(/DELETE FROM connection/i)
    expect(replaceSql).toMatch(/INSERT INTO connection/i)
  })

  it('counts gmail connections regardless of status', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ count: '3' }] }) }
    expect(await countGmailConnections(db, 'user-1')).toBe(3)
    const [countSql] = db.query.mock.calls[0]
    expect(countSql).not.toMatch(/status/)
  })

  it('gmailLimitFor returns 1 free and 5 premium', () => {
    expect(gmailLimitFor(false)).toBe(1)
    expect(gmailLimitFor(true)).toBe(5)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** - `pnpm --filter backend test -- connectionQueries`.

- [ ] **Step 3: Implement**

```typescript
// apps/backend/src/connections/queries.ts
import type { Queryable } from '../db/pool.js'

export interface Connection {
  id: string
  user_id: string
  provider: 'gmail' | 'telegram'
  status: 'active' | 'needs_reauth' | 'disabled'
  external_id: string
  key_version: number | null
  cursor: string | null
  created_at: string
}

const PUBLIC_COLUMNS = 'id, user_id, provider, status, external_id, key_version, cursor, created_at'

export function gmailLimitFor(isPremium: boolean): number {
  return isPremium ? 5 : 1
}

export async function listConnections(db: Queryable, userId: string): Promise<Connection[]> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM connection WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )
  return result.rows as Connection[]
}

export async function getConnectionById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<(Connection & { secret_encrypted: Buffer | null }) | null> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, secret_encrypted FROM connection WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Connection & { secret_encrypted: Buffer | null }) : null
}

// All non-removed gmail rows count toward the limit regardless of status, so a
// dead connection still occupies a slot until explicitly removed.
export async function countGmailConnections(db: Queryable, userId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS count FROM connection WHERE user_id = $1 AND provider = 'gmail'`,
    [userId],
  )
  return Number(result.rows[0].count)
}

export async function upsertGmailConnection(
  db: Queryable,
  userId: string,
  email: string,
  secretBlob: Buffer,
  keyVersion: number,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO connection (user_id, provider, status, external_id, secret_encrypted, key_version)
     VALUES ($1, 'gmail', 'active', $2, $3, $4)
     ON CONFLICT (user_id, provider, external_id)
     DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted,
                   key_version = EXCLUDED.key_version,
                   status = 'active',
                   updated_at = now()
     RETURNING id`,
    [userId, email, secretBlob, keyVersion],
  )
  return { id: result.rows[0].id as string }
}

// Exactly one telegram connection per user: pairing replaces any prior chat.
export async function replaceTelegramConnection(
  db: Queryable,
  userId: string,
  chatId: string,
): Promise<{ id: string }> {
  const result = await db.query(
    `WITH removed AS (
       DELETE FROM connection WHERE user_id = $1 AND provider = 'telegram'
     )
     INSERT INTO connection (user_id, provider, status, external_id)
     VALUES ($1, 'telegram', 'active', $2)
     RETURNING id`,
    [userId, chatId],
  )
  return { id: result.rows[0].id as string }
}

export async function getTelegramConnectionByChatId(
  db: Queryable,
  chatId: string,
): Promise<Connection | null> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM connection WHERE provider = 'telegram' AND external_id = $1`,
    [chatId],
  )
  return result.rows.length ? (result.rows[0] as Connection) : null
}

export async function getTelegramConnectionForUser(
  db: Queryable,
  userId: string,
): Promise<Connection | null> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM connection
      WHERE user_id = $1 AND provider = 'telegram' AND status = 'active'`,
    [userId],
  )
  return result.rows.length ? (result.rows[0] as Connection) : null
}

export async function deleteConnection(db: Queryable, userId: string, id: string): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM connection WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId],
  )
  return result.rows.length > 0
}

export async function setConnectionStatus(
  db: Queryable,
  connectionId: string,
  status: Connection['status'],
): Promise<void> {
  await db.query('UPDATE connection SET status = $2, updated_at = now() WHERE id = $1', [
    connectionId,
    status,
  ])
}

export async function setConnectionCursor(
  db: Queryable,
  connectionId: string,
  cursor: string,
): Promise<void> {
  await db.query('UPDATE connection SET cursor = $2, updated_at = now() WHERE id = $1', [
    connectionId,
    cursor,
  ])
}

export async function listActiveGmailConnections(
  db: Queryable,
): Promise<Array<Connection & { secret_encrypted: Buffer }>> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, secret_encrypted FROM connection
      WHERE provider = 'gmail' AND status = 'active' ORDER BY created_at`,
  )
  return result.rows as Array<Connection & { secret_encrypted: Buffer }>
}

export async function getUserIsPremium(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query('SELECT is_premium FROM "user" WHERE id = $1', [userId])
  return Boolean(result.rows[0]?.is_premium)
}
```

- [ ] **Step 4: Run to verify PASS** - `pnpm --filter backend test -- connectionQueries`.
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Add connection queries: user-scoped CRUD, gmail upsert with token replacement, telegram single-row replace, premium counting and caps."
```

---

### Task 5: Connection management routes (list, remove, link-url, pair-code)

**Files:**
- Create: `apps/backend/src/routes/connections.ts`
- Modify: `apps/backend/src/app.ts` (mount `createConnectionsRoute()` with the other `/api` routes)
- Test: `apps/backend/test/connectionsRoute.test.ts`

**Interfaces:**
- Consumes: Task 3 `mintPairingCode`, Task 4 queries, Task 2 crypto (`parseEncryptionKeys`, `decryptSecret`), `getUserId` from `../http/context.js`, `loadEnv`.
- Produces endpoints: `GET /api/connections` → `Connection[]`; `DELETE /api/connections/:id` → `{ success: true }` (best-effort Google revoke first); `POST /api/connections/gmail/link-url` → `{ url: string }` or 402; `POST /api/connections/telegram/pair-code` → `{ deepLink: string }`. All return `503 { error: 'connections_require_live_mode' }` in mock mode.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/connectionsRoute.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createConnectionsRoute } from '../src/routes/connections.js'
import type { AppVariables } from '../src/http/context.js'

// Route tests inject the userId the session guard would set in production.
function appWithUser(routeFactory: () => Hono, userId = 'user-1'): Hono {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('userId', userId)
    await next()
  })
  app.route('/', routeFactory())
  return app
}

const baseEnv = {
  APP_MODE: 'live',
  CONNECTION_ENCRYPTION_KEYS: `1:${Buffer.alloc(32).toString('base64')}`,
  TELEGRAM_BOT_USERNAME: 'SpendTrackerBot',
  APP_BASE_URL: 'https://spend.example.com',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://spend.example.com/connections/gmail/callback',
}

beforeEach(() => {
  for (const [key, value] of Object.entries(baseEnv)) process.env[key] = value
})

describe('connections route', () => {
  it('GET /api/connections lists the user connections', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections')
    expect(response.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toContain('user-1')
  })

  it('POST /api/connections/gmail/link-url returns 402 premium_required at the free limit', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ is_premium: false }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }),
    }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections/gmail/link-url', { method: 'POST' })
    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({ error: 'premium_required', limit: 1 })
  })

  it('POST /api/connections/gmail/link-url mints a state code and returns a Google URL', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ is_premium: true }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections/gmail/link-url', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.url).toContain('accounts.google.com')
    expect(body.url).toContain('gmail.readonly')
    expect(body.url).toContain('state=')
  })

  it('POST /api/connections/telegram/pair-code returns the bot deep link', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections/telegram/pair-code', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.deepLink).toMatch(/^https:\/\/t\.me\/SpendTrackerBot\?start=[A-Za-z0-9_-]+$/)
  })

  it('returns 503 connections_require_live_mode in mock mode', async () => {
    process.env.APP_MODE = 'mock'
    const db = { query: vi.fn() }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'connections_require_live_mode' })
    expect(db.query).not.toHaveBeenCalled()
  })
})
```

Note for the implementer: if `loadEnv` caches or the existing tests set env differently, follow the pattern the current `env.test.ts` uses (pass a source object or reset the module) rather than mutating `process.env`, keeping these assertions intact.

- [ ] **Step 2: Run to verify FAIL** - `pnpm --filter backend test -- connectionsRoute`.

- [ ] **Step 3: Implement the route**

```typescript
// apps/backend/src/routes/connections.ts
import { Hono } from 'hono'
import { google } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'
import { getUserId, type AppVariables } from '../http/context.js'
import { mintPairingCode } from '../connections/pairingCodes.js'
import { decryptSecret, parseEncryptionKeys } from '../connections/crypto.js'
import {
  countGmailConnections,
  deleteConnection,
  getConnectionById,
  getUserIsPremium,
  gmailLimitFor,
  listConnections,
} from '../connections/queries.js'

// Best-effort: a removed connection should not leave a live grant at Google.
async function revokeGoogleToken(refreshToken: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    })
  } catch (error) {
    console.error('Google token revoke failed (continuing with removal):', error)
  }
}

export function createConnectionsRoute(resolveDb: () => Queryable = getPool): Hono<{ Variables: AppVariables }> {
  const route = new Hono<{ Variables: AppVariables }>()

  // Connections write rows that FK to "user"(id); mock mode has no user row.
  route.use('/api/connections/*', async (context, next) => {
    if (loadEnv().APP_MODE === 'mock') {
      return context.json({ error: 'connections_require_live_mode' }, 503)
    }
    return next()
  })
  route.use('/api/connections', async (context, next) => {
    if (loadEnv().APP_MODE === 'mock') {
      return context.json({ error: 'connections_require_live_mode' }, 503)
    }
    return next()
  })

  route.get('/api/connections', async (context) => {
    try {
      const connections = await listConnections(resolveDb(), getUserId(context))
      return context.json(connections)
    } catch (error) {
      console.error('Failed to list connections:', error)
      return context.json({ error: 'Failed to list connections' }, 500)
    }
  })

  route.delete('/api/connections/:id', async (context) => {
    const userId = getUserId(context)
    const connectionId = context.req.param('id')
    try {
      const db = resolveDb()
      const connection = await getConnectionById(db, userId, connectionId)
      if (!connection) return context.json({ error: 'Connection not found' }, 404)
      if (connection.provider === 'gmail' && connection.secret_encrypted && connection.key_version) {
        const keys = parseEncryptionKeys(loadEnv().CONNECTION_ENCRYPTION_KEYS)
        const refreshToken = decryptSecret(
          connection.secret_encrypted,
          connection.key_version,
          keys,
          connection.id,
        )
        await revokeGoogleToken(refreshToken)
      }
      await deleteConnection(db, userId, connectionId)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to remove connection:', error)
      return context.json({ error: 'Failed to remove connection' }, 500)
    }
  })

  route.post('/api/connections/gmail/link-url', async (context) => {
    const userId = getUserId(context)
    try {
      const db = resolveDb()
      const isPremium = await getUserIsPremium(db, userId)
      const limit = gmailLimitFor(isPremium)
      const existing = await countGmailConnections(db, userId)
      if (existing >= limit) {
        return context.json({ error: 'premium_required', limit }, 402)
      }
      const state = await mintPairingCode(db, userId, 'gmail_oauth')
      const env = loadEnv()
      const oauthClient = new google.auth.OAuth2(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        env.GOOGLE_REDIRECT_URI,
      )
      const url = oauthClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/gmail.readonly'],
        state,
      })
      return context.json({ url })
    } catch (error) {
      console.error('Failed to build Gmail link URL:', error)
      return context.json({ error: 'Failed to start Gmail linking' }, 500)
    }
  })

  route.post('/api/connections/telegram/pair-code', async (context) => {
    const userId = getUserId(context)
    try {
      const code = await mintPairingCode(resolveDb(), userId, 'telegram_pair')
      const deepLink = `https://t.me/${loadEnv().TELEGRAM_BOT_USERNAME}?start=${code}`
      return context.json({ deepLink })
    } catch (error) {
      console.error('Failed to mint Telegram pairing code:', error)
      return context.json({ error: 'Failed to start Telegram pairing' }, 500)
    }
  })

  return route
}
```

Mount in `apps/backend/src/app.ts` beside the other data routes:

```typescript
import { createConnectionsRoute } from './routes/connections.js'
// ... inside buildApp(), after createTagsRoute():
app.route('/', createConnectionsRoute())
```

- [ ] **Step 4: Run to verify PASS** - `pnpm --filter backend test -- connectionsRoute`.
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Add session-gated connection management endpoints: list, remove (with best-effort Google revoke), gmail link-url with 402 premium gate, telegram pair-code deep link. Mock mode returns 503."
```

---

### Task 6: Gmail OAuth callback (unguarded) + delete legacy oauth routes

**Files:**
- Create: `apps/backend/src/routes/gmailCallback.ts`
- Delete: `apps/backend/src/routes/oauth.ts`
- Modify: `apps/backend/src/app.ts` (replace `oauthRoute` mounting with `gmailCallbackRoute`)
- Test: `apps/backend/test/gmailCallback.test.ts`

**Interfaces:**
- Consumes: Task 3 `consumePairingCode`, Task 4 `upsertGmailConnection`, Task 2 crypto, `resolveSessionFromRequest` from `../auth/resolveSession.js`.
- Produces: `GET /connections/gmail/callback?code=&state=` mounted OUTSIDE the `/api/*` session guard (like `/telegram/webhook`). On success returns a small HTML interstitial linking to `${APP_BASE_URL}/integrations?linked=gmail`. Failures redirect to `${APP_BASE_URL}/integrations?error=<code>` with `link_invalid` (bad/expired state), `session_mismatch`, or `no_refresh_token`.
- Produces (for testability): the route factory accepts an injectable token exchanger: `createGmailCallbackRoute(resolveDb?, exchange?: (code: string) => Promise<{ refreshToken: string | null; email: string | null }>, resolveSession?)`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/gmailCallback.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createGmailCallbackRoute } from '../src/routes/gmailCallback.js'

const consumedState = { rows: [{ user_id: 'user-1' }] }
const emptyRows = { rows: [] }

function exchangeReturning(refreshToken: string | null, email: string | null) {
  return vi.fn().mockResolvedValue({ refreshToken, email })
}

describe('gmail oauth callback', () => {
  it('rejects an unknown or expired state with a redirect to error=link_invalid', async () => {
    const db = { query: vi.fn().mockResolvedValue(emptyRows) }
    const route = createGmailCallbackRoute(() => db, exchangeReturning('rt', 'a@gmail.com'), async () => null)
    const response = await route.request('/connections/gmail/callback?code=x&state=bad')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('error=link_invalid')
  })

  it('rejects when a web session is present for a DIFFERENT user (anti-phishing)', async () => {
    const db = { query: vi.fn().mockResolvedValue(consumedState) }
    const route = createGmailCallbackRoute(
      () => db,
      exchangeReturning('rt', 'a@gmail.com'),
      async () => ({ user: { id: 'attacker-2' } }),
    )
    const response = await route.request('/connections/gmail/callback?code=x&state=ok')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('error=session_mismatch')
  })

  it('redirects to error=no_refresh_token when Google returns none', async () => {
    const db = { query: vi.fn().mockResolvedValue(consumedState) }
    const route = createGmailCallbackRoute(() => db, exchangeReturning(null, 'a@gmail.com'), async () => null)
    const response = await route.request('/connections/gmail/callback?code=x&state=ok')
    expect(response.headers.get('location')).toContain('error=no_refresh_token')
  })

  it('stores an encrypted connection and returns the return-to-app interstitial', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce(consumedState) // consume state
        .mockResolvedValueOnce({ rows: [{ id: 'conn-1' }] }), // upsert
    }
    const route = createGmailCallbackRoute(() => db, exchangeReturning('refresh-tok', 'a@gmail.com'), async () => null)
    const response = await route.request('/connections/gmail/callback?code=x&state=ok')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('/integrations?linked=gmail')
    const upsertParams = db.query.mock.calls[1][1]
    expect(upsertParams[0]).toBe('user-1')
    expect(upsertParams[1]).toBe('a@gmail.com')
    expect(Buffer.isBuffer(upsertParams[2])).toBe(true)
    expect(upsertParams[2].toString('utf8')).not.toContain('refresh-tok')
  })
})
```

- [ ] **Step 2: Run to verify FAIL** - `pnpm --filter backend test -- gmailCallback`.

- [ ] **Step 3: Implement the callback**

```typescript
// apps/backend/src/routes/gmailCallback.ts
import { Hono } from 'hono'
import { google } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'
import { consumePairingCode } from '../connections/pairingCodes.js'
import { encryptSecret, parseEncryptionKeys } from '../connections/crypto.js'
import { upsertGmailConnection } from '../connections/queries.js'
import { resolveSessionFromRequest } from '../auth/resolveSession.js'

export interface GmailTokenExchange {
  (code: string): Promise<{ refreshToken: string | null; email: string | null }>
}

// Real exchanger: trade the auth code for tokens, then read the linked
// account's email so the connection knows which inbox it represents.
async function exchangeCodeForGmailAccount(code: string): Promise<{
  refreshToken: string | null
  email: string | null
}> {
  const env = loadEnv()
  const oauthClient = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  )
  const { tokens } = await oauthClient.getToken(code)
  if (!tokens.refresh_token) return { refreshToken: null, email: null }
  oauthClient.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: oauthClient })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return { refreshToken: tokens.refresh_token, email: profile.data.emailAddress ?? null }
}

type SessionResolver = (headers: Headers) => Promise<unknown>

// Mounted OUTSIDE the /api/* session guard (like /telegram/webhook): the
// browser arrives here from Google with no app session on Android (Custom
// Tab), so the single-use state code is the authentication.
export function createGmailCallbackRoute(
  resolveDb: () => Queryable = getPool,
  exchange: GmailTokenExchange = exchangeCodeForGmailAccount,
  resolveSession: SessionResolver = resolveSessionFromRequest,
): Hono {
  const route = new Hono()

  route.get('/connections/gmail/callback', async (context) => {
    const env = loadEnv()
    const errorRedirect = (errorCode: string) =>
      context.redirect(`${env.APP_BASE_URL}/integrations?error=${errorCode}`)

    const code = context.req.query('code')
    const state = context.req.query('state')
    if (!code || !state) return errorRedirect('link_invalid')

    try {
      const db = resolveDb()
      const stateUserId = await consumePairingCode(db, state, 'gmail_oauth')
      if (!stateUserId) return errorRedirect('link_invalid')

      // Anti-phishing: a logged-in browser must be the same user the state was
      // minted for, else an attacker link could bind a victim's Gmail to the
      // attacker's account. No session (Android Custom Tab) is fine.
      const session = (await resolveSession(context.req.raw.headers)) as
        | { user?: { id?: string } }
        | null
      if (session?.user?.id && session.user.id !== stateUserId) {
        return errorRedirect('session_mismatch')
      }

      const { refreshToken, email } = await exchange(code)
      if (!refreshToken || !email) return errorRedirect('no_refresh_token')

      const keys = parseEncryptionKeys(env.CONNECTION_ENCRYPTION_KEYS)
      // AAD binds the blob to the user+email identity of the row (stable across
      // upsert, unlike the row id which is unknown before insert).
      const { blob, keyVersion } = encryptSecret(refreshToken, keys, `${stateUserId}:${email}`)
      await upsertGmailConnection(db, stateUserId, email, blob, keyVersion)

      const returnUrl = `${env.APP_BASE_URL}/integrations?linked=gmail`
      // Interstitial instead of a bare 302: Chrome Custom Tabs do not reliably
      // fire Android App Links on server redirects, so give the user a button.
      return context.html(
        `<!doctype html><meta charset="utf-8"><title>Gmail linked</title>
         <body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh">
           <div style="text-align:center">
             <h1>Gmail linked</h1>
             <p>You can return to SpendTracker.</p>
             <p><a href="${returnUrl}">Return to app</a></p>
           </div>
         </body>`,
      )
    } catch (error) {
      console.error('Gmail callback failed:', error)
      return errorRedirect('link_failed')
    }
  })

  return route
}
```

Note: the AAD is `${userId}:${email}` (stable pre-insert), not the row id; Task 5's decrypt call in `DELETE /api/connections/:id` must match. Go back to `apps/backend/src/routes/connections.ts` and change its `decryptSecret(...)` AAD argument from `connection.id` to `` `${userId}:${connection.external_id}` ``.

- [ ] **Step 4: Replace the legacy routes**

Delete `apps/backend/src/routes/oauth.ts` (its callback prints refresh tokens in plaintext, unguarded). In `apps/backend/src/app.ts`: remove `import { oauthRoute } from './routes/oauth.js'` and `app.route('/', oauthRoute)`; add:

```typescript
import { createGmailCallbackRoute } from './routes/gmailCallback.js'
// ... where oauthRoute was mounted (outside the /api guard, beside telegramRoute):
app.route('/', createGmailCallbackRoute())
```

- [ ] **Step 5: Run to verify PASS** - `pnpm --filter backend test -- gmailCallback connectionsRoute` (also fix any test referencing the deleted oauth route).
- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Add the unguarded Gmail OAuth callback authenticated by a single-use state code, with session-mismatch anti-phishing, encrypted token upsert, and a return-to-app interstitial. Delete the legacy /oauth routes that printed refresh tokens."
```

---

## Phase 3 - Import pipeline, Telegram, poller

### Task 7: import_source dedupe + processEmail per-user refactor

**Files:**
- Create: `apps/backend/src/connections/importSource.ts`
- Modify: `apps/backend/src/pipeline/processEmail.ts`
- Test: `apps/backend/test/importSource.test.ts`, `apps/backend/test/processEmail.test.ts`

**Interfaces:**
- Produces: `hasImportSource(db, connectionId, messageId): Promise<boolean>`; `recordImportSource(db, connectionId, messageId, transactionId: string | null): Promise<void>` (ON CONFLICT DO NOTHING).
- Produces: `processEmail(email: { subject: string; text: string; messageId: string }, importContext: { userId: string; connectionId: string }, deps): Promise<void>` where `deps` extends the existing `defaultProcessDeps` with `pool` (a `TransactionalPool` from `db/queries.js`) and `notify: (text: string) => Promise<void>` (already chat-resolved by the caller; a no-op function when the user has no Telegram connection).
- Behavior contract (in order): dedupe check FIRST (skip silently, no AI calls, if `hasImportSource`); detect/extract calls unchanged in their prompts/arguments except lookups (`getAccounts`, `getCategories`, `getDistinctTags`) now pass `userId` per the multi-tenancy signatures; zero accounts or zero categories → `recordImportSource(..., null)` and return (no error, no AI extract attribution attempt); on successful extraction → insert the transaction and the `import_source` row in ONE DB transaction (`BEGIN`/`COMMIT` on a dedicated pool client, mirroring `createTransfer` in `db/queries.js`); non-transaction emails → `recordImportSource(..., null)`; `notify` failures are caught and logged, never failing the import.

- [ ] **Step 1: Write the failing importSource tests**

```typescript
// apps/backend/test/importSource.test.ts
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
```

- [ ] **Step 2: Implement importSource**

```typescript
// apps/backend/src/connections/importSource.ts
import type { Queryable } from '../db/pool.js'

export async function hasImportSource(
  db: Queryable,
  connectionId: string,
  messageId: string,
): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM import_source WHERE connection_id = $1 AND message_id = $2',
    [connectionId, messageId],
  )
  return result.rows.length > 0
}

export async function recordImportSource(
  db: Queryable,
  connectionId: string,
  messageId: string,
  transactionId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO import_source (connection_id, message_id, transaction_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (connection_id, message_id) DO NOTHING`,
    [connectionId, messageId, transactionId],
  )
}
```

- [ ] **Step 3: Refactor processEmail to the new signature**

Open `apps/backend/src/pipeline/processEmail.ts` and restructure it to the behavior contract above, preserving the existing `detect`/`extract` invocations, prompt construction, and `defaultProcessDeps` wiring. The orchestration skeleton (adapt names to the file's existing internals):

```typescript
export async function processEmail(
  email: { subject: string; text: string; messageId: string },
  importContext: { userId: string; connectionId: string },
  deps: ProcessDeps,
): Promise<void> {
  const { userId, connectionId } = importContext

  // Dedupe before any AI work: a crash-replay must cost no tokens and send no
  // duplicate notification.
  if (await hasImportSource(deps.db, connectionId, email.messageId)) return

  const isTransactionEmail = await deps.detect({ subject: email.subject, text: email.text })
  if (!isTransactionEmail) {
    await recordImportSource(deps.db, connectionId, email.messageId, null)
    return
  }

  const [accounts, categories, tags] = await Promise.all([
    getAccounts(deps.db, userId),
    getCategories(deps.db, userId),
    getDistinctTags(deps.db, userId),
  ])
  // Onboarding guard: with no accounts or categories nothing can be attributed;
  // record the message so it is never retried, and skip without error.
  if (accounts.length === 0 || categories.length === 0) {
    await recordImportSource(deps.db, connectionId, email.messageId, null)
    return
  }

  const extracted = await deps.extract(/* existing arguments, using the scoped
    accounts/categories/tags loaded above */)
  if (!extracted) {
    await recordImportSource(deps.db, connectionId, email.messageId, null)
    return
  }

  // Insert transaction + dedupe row atomically, mirroring createTransfer's
  // client/BEGIN/COMMIT pattern in db/queries.ts.
  const client = await deps.pool.connect()
  let insertedId: string
  try {
    await client.query('BEGIN')
    const inserted = await insertTransaction(client, userId, {
      /* existing field mapping from `extracted`, unchanged */
    })
    insertedId = inserted.id
    await recordImportSource(client, connectionId, email.messageId, inserted.id)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  try {
    await deps.notify(/* existing success-message formatting for insertedId */)
  } catch (error) {
    console.error('Import notify failed (import kept):', error)
  }
}
```

- [ ] **Step 4: Update `test/processEmail.test.ts`** to the new signature: pass `importContext = { userId: 'user-1', connectionId: 'conn-1' }` and a mock `pool` (reuse the `fakePool` pattern from `test/transfers.test.ts`); add cases asserting (a) a message already in `import_source` short-circuits before `deps.detect` is called, (b) zero accounts records the message and skips, (c) a notify rejection does not reject the import, and (d) the insert params include `'user-1'`.

- [ ] **Step 5: Run to verify PASS** - `pnpm --filter backend test -- importSource processEmail`.
- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Refactor processEmail to per-user imports: dedupe via import_source before any AI call, user-scoped lookups, atomic insert+dedupe-record, onboarding guard, and notify isolation."
```

---

### Task 8: Telegram per-chat sendMessage, /start pairing, user-scoped webhook

**Files:**
- Modify: `apps/backend/src/telegram/client.ts`, `apps/backend/src/telegram/webhook.ts`
- Test: `apps/backend/test/telegram-client.test.ts`, `apps/backend/test/telegram-webhook.test.ts`

**Interfaces:**
- Produces: `sendMessage(chatId: string, text: string, opts?: { replyToMessageId?: number }): Promise<void>` throwing `TelegramSendError` (with a `status: number` field) on non-OK responses; the env `TELEGRAM_CHAT_ID` fallback is removed.
- Produces webhook behavior: secret-token validation unchanged; `/start <code>` consumes a `telegram_pair` code and calls `replaceTelegramConnection` (rejecting in-chat when `getTelegramConnectionByChatId` finds a different user); all other updates resolve `chat_id` → connection → `userId` and run the existing edit/delete flows with the multi-tenancy scoped signatures (`getTransactionById(db, userId, id)`, `updateTransaction(db, userId, ...)`, `deleteTransaction(db, userId, id)`, `getCategories(db, userId)`, `getDistinctTags(db, userId)`); unpaired chats are ignored; a `TelegramSendError` with `status === 403` flips that telegram connection to `needs_reauth` via `setConnectionStatus`.

- [ ] **Step 1: Extend the webhook update type** in `webhook.ts` so `message` carries `chat: { id: number }` (Telegram always sends it; the current interface omits it).

- [ ] **Step 2: Write the failing tests.** In `test/telegram-client.test.ts`: `sendMessage('123', 'hi')` posts to the Bot API with `chat_id: '123'` and throws a `TelegramSendError` whose `status` is 403 when fetch resolves non-OK 403. In `test/telegram-webhook.test.ts` add: (a) `/start <valid-code>` calls `replaceTelegramConnection(db, 'user-1', '<chat id>')` and confirms in-chat; (b) `/start` with a chat already paired to another user sends the "already linked" message and does not replace; (c) a reply-edit from a paired chat passes that user's id into `getTransactionById`; (d) an update from an unpaired chat performs no queries; (e) a 403 from notify marks the connection `needs_reauth`.

- [ ] **Step 3: Run to verify FAIL** - `pnpm --filter backend test -- telegram-client telegram-webhook`.

- [ ] **Step 4: Implement.** In `client.ts`:

```typescript
export class TelegramSendError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`Telegram sendMessage failed with ${status}: ${body}`)
    this.name = 'TelegramSendError'
    this.status = status
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  opts: { replyToMessageId?: number } = {},
): Promise<void> {
  const env = loadEnv()
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
    }),
  })
  if (!response.ok) {
    throw new TelegramSendError(response.status, await response.text())
  }
}
```

(Keep any existing formatting/parse-mode options the current implementation sends; only the chat-id source and error type change.) In `webhook.ts`, at the top of `handleTelegramUpdate`: read `const chatId = String(update.message?.chat?.id ?? '')`; if the text starts with `/start `, run the pairing flow (consume code → check `getTelegramConnectionByChatId` for a different user → `replaceTelegramConnection` → confirm via `deps.notify`); otherwise resolve `getTelegramConnectionByChatId(deps.db, chatId)`, return silently if null, and thread `connection.user_id` into every scoped query. Wrap each `deps.notify` call so a `TelegramSendError` with `status === 403` triggers `setConnectionStatus(deps.db, connection.id, 'needs_reauth')` instead of propagating.

- [ ] **Step 5: Run to verify PASS** - `pnpm --filter backend test -- telegram-client telegram-webhook`.
- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Telegram goes per-user: sendMessage takes a chat id and typed errors, /start pairs a chat to its user with global-uniqueness rejection, webhook edits are scoped to the paired user, 403 flips the connection to needs_reauth."
```

---

### Task 9: Per-connection Gmail poller + index wiring

**Files:**
- Modify: `apps/backend/src/gmail/client.ts` (add `createGmailClientForToken`, `listMessageIdsSince`)
- Create: `apps/backend/src/connections/poller.ts`
- Modify: `apps/backend/src/index.ts`
- Delete: `apps/backend/src/gmail/poller.ts` (superseded)
- Test: `apps/backend/test/connectionPoller.test.ts`, update `apps/backend/test/poller.test.ts` (delete or repoint)

**Interfaces:**
- Consumes: Tasks 2/4/7 modules; `processEmail` (Task 7 signature); `getTelegramConnectionForUser`; `sendMessage` (Task 8).
- Produces in `gmail/client.ts`: `createGmailClientForToken(refreshToken: string): gmail_v1.Gmail` (OAuth2 client from env GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI + the given token); `listMessageIdsSince(gmail, afterEpochSeconds: string): Promise<string[]>` (paginates `users.messages.list` with `q = \`after:${afterEpochSeconds} -in:scheduled\``).
- Produces in `connections/poller.ts`:
  - `pollConnectionsOnce(deps: ConnectionPollerDeps): Promise<void>` and `startConnectionPolling(deps, intervalMs): () => void` (setTimeout chain like the old poller).
  - `ConnectionPollerDeps = { pool: pg.Pool-like with connect(); db: Queryable; keys: VersionedKey[]; buildGmail: typeof createGmailClientForToken; listSince: typeof listMessageIdsSince; fetchMessage: (gmail, id) => Promise<GmailMessage>; parseMessage: (message) => { subject: string; text: string; internalDateSeconds: string }; importEmail: typeof processEmail; nowSeconds: () => string }` (everything injectable for tests).
  - Behavior: `pg_try_advisory_lock(727401)` on a dedicated client (skip tick when false, `pg_advisory_unlock` + release in `finally`); downgrade enforcement (single UPDATE flipping over-cap active gmail connections to `disabled`, keeping the oldest `CASE WHEN is_premium THEN 5 ELSE 1 END` per user by `created_at`); per connection: decrypt (AAD `` `${connection.user_id}:${connection.external_id}` ``), first-run `cursor=null` → `setConnectionCursor(db, id, nowSeconds())` and continue; else list ids, for each fetch+parse+import, then advance cursor once to the max `internalDateSeconds` seen; auth errors (`status === 401` or message containing `invalid_grant`) → `setConnectionStatus(..., 'needs_reauth')`, any other error logged and left `active`; one connection's failure never stops the loop.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/connectionPoller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { pollConnectionsOnce } from '../src/connections/poller.js'
import { parseEncryptionKeys, encryptSecret } from '../src/connections/crypto.js'

const keys = parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`)

function encryptedConnection(id: string, userId: string, email: string, cursor: string | null) {
  const { blob, keyVersion } = encryptSecret(`token-${id}`, keys, `${userId}:${email}`)
  return {
    id, user_id: userId, provider: 'gmail', status: 'active', external_id: email,
    key_version: keyVersion, cursor, created_at: 'now', secret_encrypted: blob,
  }
}

function fakeLockClient(acquired: boolean) {
  return {
    query: vi.fn(async (sql: string) =>
      /pg_try_advisory_lock/.test(sql) ? { rows: [{ acquired }] } : { rows: [] }),
    release: vi.fn(),
  }
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const lockClient = fakeLockClient(true)
  return {
    lockClient,
    deps: {
      pool: { connect: vi.fn().mockResolvedValue(lockClient) },
      db: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      keys,
      buildGmail: vi.fn().mockReturnValue({}),
      listSince: vi.fn().mockResolvedValue([]),
      fetchMessage: vi.fn(),
      parseMessage: vi.fn(),
      importEmail: vi.fn().mockResolvedValue(undefined),
      nowSeconds: () => '1700000000',
      ...overrides,
    },
  }
}

describe('connection poller', () => {
  it('skips the whole tick when the advisory lock is not acquired', async () => {
    const lockClient = fakeLockClient(false)
    const { deps } = baseDeps({ pool: { connect: vi.fn().mockResolvedValue(lockClient) } })
    await pollConnectionsOnce(deps as never)
    expect(deps.db.query).not.toHaveBeenCalled()
    expect(lockClient.release).toHaveBeenCalled()
  })

  it('first run stores a now cursor and imports nothing', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', null)
    const { deps } = baseDeps()
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [connection] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).not.toHaveBeenCalled()
    const cursorCall = deps.db.query.mock.calls.find(([sql]) => /SET cursor/.test(sql))
    expect(cursorCall[1]).toEqual(['conn-1', '1700000000'])
  })

  it('imports each new message for the connection user and advances the cursor to max internalDate', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi.fn().mockResolvedValue(['m1', 'm2']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi
        .fn()
        .mockReturnValueOnce({ subject: 's1', text: 't1', internalDateSeconds: '1690000100' })
        .mockReturnValueOnce({ subject: 's2', text: 't2', internalDateSeconds: '1690000050' }),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [connection] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).toHaveBeenCalledWith({}, '1690000000')
    expect(deps.importEmail).toHaveBeenCalledTimes(2)
    expect(deps.importEmail.mock.calls[0][1]).toEqual({ userId: 'user-1', connectionId: 'conn-1' })
    const cursorCall = deps.db.query.mock.calls.find(([sql]) => /SET cursor/.test(sql))
    expect(cursorCall[1]).toEqual(['conn-1', '1690000100'])
  })

  it('flips only the failing connection to needs_reauth on invalid_grant and continues', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const healthy = encryptedConnection('conn-ok', 'user-2', 'ok@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { status: 400 }))
        .mockResolvedValueOnce([]),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [failing, healthy] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    const statusCall = deps.db.query.mock.calls.find(([sql]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-bad', 'needs_reauth'])
    expect(deps.listSince).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** - `pnpm --filter backend test -- connectionPoller`.

- [ ] **Step 3: Implement gmail client additions**

```typescript
// add to apps/backend/src/gmail/client.ts
export function createGmailClientForToken(refreshToken: string): gmail_v1.Gmail {
  const env = loadEnv()
  const auth = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  )
  auth.setCredentials({ refresh_token: refreshToken })
  return google.gmail({ version: 'v1', auth })
}

// n8n-style listing: a timestamp query instead of the history API, whose
// cursor expires after about a week. after: is inclusive at the boundary
// second; import_source dedupe absorbs the reappearing edge message.
export async function listMessageIdsSince(
  gmail: gmail_v1.Gmail,
  afterEpochSeconds: string,
): Promise<string[]> {
  const messageIds: string[] = []
  let pageToken: string | undefined
  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterEpochSeconds} -in:scheduled`,
      pageToken,
    })
    for (const message of response.data.messages ?? []) {
      if (message.id) messageIds.push(message.id)
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)
  return messageIds
}
```

- [ ] **Step 4: Implement the poller**

```typescript
// apps/backend/src/connections/poller.ts
import type { gmail_v1 } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import type { VersionedKey } from './crypto.js'
import { decryptSecret } from './crypto.js'
import {
  listActiveGmailConnections,
  setConnectionCursor,
  setConnectionStatus,
  type Connection,
} from './queries.js'

const POLL_LOCK_ID = 727401

interface PoolClientLike extends Queryable {
  release: () => void
}

export interface ConnectionPollerDeps {
  pool: { connect: () => Promise<PoolClientLike> }
  db: Queryable
  keys: VersionedKey[]
  buildGmail: (refreshToken: string) => gmail_v1.Gmail
  listSince: (gmail: gmail_v1.Gmail, afterEpochSeconds: string) => Promise<string[]>
  fetchMessage: (gmail: gmail_v1.Gmail, id: string) => Promise<unknown>
  parseMessage: (message: unknown) => { subject: string; text: string; internalDateSeconds: string }
  importEmail: (
    email: { subject: string; text: string; messageId: string },
    importContext: { userId: string; connectionId: string },
  ) => Promise<void>
  nowSeconds: () => string
}

function isAuthError(error: unknown): boolean {
  const status = (error as { status?: number; code?: number }).status ??
    (error as { code?: number }).code
  const message = error instanceof Error ? error.message : String(error)
  return status === 401 || /invalid_grant/i.test(message)
}

// Keep the oldest connections within each user's tier cap active; billing is
// out of scope, so this UPDATE is the only downgrade enforcement actor.
const DOWNGRADE_SQL = `
  WITH ranked AS (
    SELECT connection.id,
           row_number() OVER (PARTITION BY connection.user_id ORDER BY connection.created_at) AS position,
           CASE WHEN account_owner.is_premium THEN 5 ELSE 1 END AS cap
      FROM connection
      JOIN "user" account_owner ON account_owner.id = connection.user_id
     WHERE connection.provider = 'gmail' AND connection.status = 'active'
  )
  UPDATE connection SET status = 'disabled', updated_at = now()
   WHERE id IN (SELECT id FROM ranked WHERE position > cap)`

export async function pollConnectionsOnce(deps: ConnectionPollerDeps): Promise<void> {
  const lockClient = await deps.pool.connect()
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [POLL_LOCK_ID])
    if (!lock.rows[0]?.acquired) return

    await deps.db.query(DOWNGRADE_SQL)
    const connections = await listActiveGmailConnections(deps.db)

    for (const connection of connections) {
      try {
        await pollOneConnection(connection, deps)
      } catch (error) {
        if (isAuthError(error)) {
          await setConnectionStatus(deps.db, connection.id, 'needs_reauth')
          console.error(`Connection ${connection.id} needs re-auth:`, error)
        } else {
          console.error(`Connection ${connection.id} poll failed (will retry):`, error)
        }
      }
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [POLL_LOCK_ID])
    } catch {
      // The lock dies with the session either way.
    }
    lockClient.release()
  }
}

async function pollOneConnection(
  connection: Connection & { secret_encrypted: Buffer },
  deps: ConnectionPollerDeps,
): Promise<void> {
  if (!connection.cursor) {
    await setConnectionCursor(deps.db, connection.id, deps.nowSeconds())
    return
  }
  const refreshToken = decryptSecret(
    connection.secret_encrypted,
    connection.key_version ?? 0,
    deps.keys,
    `${connection.user_id}:${connection.external_id}`,
  )
  const gmail = deps.buildGmail(refreshToken)
  const messageIds = await deps.listSince(gmail, connection.cursor)

  let maxInternalDateSeconds = connection.cursor
  for (const messageId of messageIds) {
    const rawMessage = await deps.fetchMessage(gmail, messageId)
    const parsed = deps.parseMessage(rawMessage)
    await deps.importEmail(
      { subject: parsed.subject, text: parsed.text, messageId },
      { userId: connection.user_id, connectionId: connection.id },
    )
    if (Number(parsed.internalDateSeconds) > Number(maxInternalDateSeconds)) {
      maxInternalDateSeconds = parsed.internalDateSeconds
    }
  }
  if (maxInternalDateSeconds !== connection.cursor) {
    await setConnectionCursor(deps.db, connection.id, maxInternalDateSeconds)
  }
}

export function startConnectionPolling(deps: ConnectionPollerDeps, intervalMs: number): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      await pollConnectionsOnce(deps)
    } catch (error) {
      console.error('Connection poll cycle failed:', error)
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  void tick()
  return () => {
    stopped = true
  }
}
```

Note: `parseMessage` in `gmail/parse.ts` must expose the message's `internalDate` (milliseconds string from the Gmail payload) converted to seconds; add an `internalDateSeconds` field to its return if absent.

- [ ] **Step 5: Rewire `index.ts`.** Remove: `createGmailClient`, `startPolling`, `ensureStateTable` usage and their imports (delete `src/gmail/poller.ts` and its test, or repoint the test to the new module). Add (only in live mode):

```typescript
import { parseEncryptionKeys } from './connections/crypto.js'
import { startConnectionPolling } from './connections/poller.js'
import { createGmailClientForToken, fetchMessage, listMessageIdsSince } from './gmail/client.js'
import { parseMessage } from './gmail/parse.js'
import { processEmail, defaultProcessDeps } from './pipeline/processEmail.js'
import { getTelegramConnectionForUser } from './connections/queries.js'
import { sendMessage } from './telegram/client.js'

if (env.APP_MODE === 'live') {
  const keys = parseEncryptionKeys(env.CONNECTION_ENCRYPTION_KEYS)
  startConnectionPolling(
    {
      pool: db,
      db,
      keys,
      buildGmail: createGmailClientForToken,
      listSince: listMessageIdsSince,
      fetchMessage,
      parseMessage,
      importEmail: (email, importContext) =>
        processEmail(email, importContext, {
          ...defaultProcessDeps,
          db,
          pool: db,
          notify: async (text) => {
            const telegram = await getTelegramConnectionForUser(db, importContext.userId)
            if (telegram) await sendMessage(telegram.external_id, text)
          },
        }).catch((error) => console.error('processEmail failed:', error)),
      nowSeconds: () => String(Math.floor(Date.now() / 1000)),
    },
    env.GMAIL_POLL_INTERVAL_MS,
  )
}
```

- [ ] **Step 6: Run the full backend suite** - `pnpm --filter backend test`
Expected: all pass (fix any test still importing the deleted `gmail/poller.ts`).
- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Replace the single-owner env poller with the per-connection Gmail poller: try-advisory-lock tick, downgrade cap enforcement, timestamp cursor via messages.list after:, per-user import attribution, invalid_grant isolation to needs_reauth."
```

---

## Phase 4 - Web UI

### Task 10: Integrations page (list, link, pair, remove, upsell)

**Files:**
- Create: `apps/web/src/pages/IntegrationsPage.tsx`, `apps/web/src/hooks/useConnections.ts`
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/types.ts`, `apps/web/src/App.tsx` (route), `apps/web/src/components/layout/AppLayout.tsx` (nav item)
- Test: `apps/web/src/pages/IntegrationsPage.test.tsx` (or the repo's existing web test location/pattern)

**Interfaces:**
- Consumes Task 5/6 endpoints.
- Produces: `Connection` type in `types.ts` (`{ id: string; provider: 'gmail' | 'telegram'; status: 'active' | 'needs_reauth' | 'disabled'; external_id: string; created_at: string }`); `connectionsApi = { list(): Promise<Connection[]>; remove(id): Promise<{ success: boolean }>; gmailLinkUrl(): Promise<{ url: string }>; telegramPairCode(): Promise<{ deepLink: string }> }` in `api.ts`; hooks `useConnections`, `useRemoveConnection`, plus mutations for link/pair in `useConnections.ts`; an `/integrations` route rendered inside `AppLayout` with a "Integrations" nav item (icon `IconPlug` from `@tabler/icons-react`).

- [ ] **Step 1: Add the API client + types.** In `types.ts` add the `Connection` interface above. In `api.ts` add:

```typescript
export const connectionsApi = {
  list: () => request<Connection[]>('/connections'),
  remove: (id: string) => request<{ success: boolean }>(`/connections/${id}`, { method: 'DELETE' }),
  gmailLinkUrl: () => request<{ url: string }>('/connections/gmail/link-url', { method: 'POST' }),
  telegramPairCode: () =>
    request<{ deepLink: string }>('/connections/telegram/pair-code', { method: 'POST' }),
}
```

(Import `Connection` in the existing type-import block.)

- [ ] **Step 2: Add the hooks**

```typescript
// apps/web/src/hooks/useConnections.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionsApi } from '@/lib/api'

const connectionsKey = ['connections'] as const

export function useConnections() {
  return useQuery({ queryKey: connectionsKey, queryFn: connectionsApi.list })
}

export function useRemoveConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) => connectionsApi.remove(connectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  })
}

// Linking navigates away (Google) or out of the app (Telegram); the list is
// refreshed when the user lands back on /integrations.
export function useGmailLinkUrl() {
  return useMutation({ mutationFn: connectionsApi.gmailLinkUrl })
}

export function useTelegramPairCode() {
  return useMutation({ mutationFn: connectionsApi.telegramPairCode })
}
```

- [ ] **Step 3: Build the page**

```tsx
// apps/web/src/pages/IntegrationsPage.tsx
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { IconBrandGmail, IconBrandTelegram, IconTrash, IconRefresh } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  useConnections,
  useGmailLinkUrl,
  useRemoveConnection,
  useTelegramPairCode,
} from '@/hooks/useConnections'
import { ApiError, toErrorMessage } from '@/lib/api'
import type { Connection } from '@/types'

const STATUS_LABELS: Record<Connection['status'], string> = {
  active: 'Active',
  needs_reauth: 'Needs re-authentication',
  disabled: 'Disabled',
}

export function IntegrationsPage() {
  const [searchParams] = useSearchParams()
  const connectionsQuery = useConnections()
  const removeConnection = useRemoveConnection()
  const gmailLink = useGmailLinkUrl()
  const telegramPair = useTelegramPairCode()

  const connections = connectionsQuery.data ?? []
  const justLinked = searchParams.get('linked') === 'gmail'
  const linkErrorCode = searchParams.get('error')

  const premiumRequired =
    gmailLink.error instanceof ApiError && gmailLink.error.status === 402

  const banner = useMemo(() => {
    if (justLinked) return { tone: 'success' as const, text: 'Gmail account linked.' }
    if (linkErrorCode === 'no_refresh_token')
      return {
        tone: 'error' as const,
        text: 'Google returned no refresh token. Remove SpendTracker at myaccount.google.com and retry.',
      }
    if (linkErrorCode)
      return { tone: 'error' as const, text: 'Linking failed. Please try again.' }
    return null
  }, [justLinked, linkErrorCode])

  function startGmailLink() {
    gmailLink.mutate(undefined, {
      onSuccess: ({ url }) => {
        window.location.href = url
      },
    })
  }

  function startTelegramPair() {
    telegramPair.mutate(undefined, {
      onSuccess: ({ deepLink }) => {
        window.open(deepLink, '_blank', 'noopener')
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Link your Gmail to import transactions automatically and Telegram to get notifications.
          Imports start from the moment you link; there is no history backfill.
        </p>
      </div>

      {banner ? (
        <p className={banner.tone === 'success' ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
          {banner.text}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={startGmailLink} loading={gmailLink.isPending}>
          <IconBrandGmail className="h-4 w-4" />
          Link Gmail
        </Button>
        <Button variant="outline" onClick={startTelegramPair} loading={telegramPair.isPending}>
          <IconBrandTelegram className="h-4 w-4" />
          Connect Telegram
        </Button>
      </div>

      {premiumRequired ? (
        <p className="text-sm text-muted-foreground">
          The free plan includes one Gmail account. Upgrade to premium to link more.
        </p>
      ) : gmailLink.isError ? (
        <p className="text-sm text-destructive">{toErrorMessage(gmailLink.error)}</p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {connectionsQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading integrations...</p>
          ) : connections.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing linked yet.</p>
          ) : (
            <ul className="divide-y">
              {connections.map((connection) => (
                <li key={connection.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {connection.provider === 'gmail' ? connection.external_id : 'Telegram'}
                    </p>
                    <p className="text-xs text-muted-foreground">{STATUS_LABELS[connection.status]}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    {connection.provider === 'gmail' && connection.status === 'needs_reauth' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={startGmailLink}
                        aria-label="Re-authenticate"
                      >
                        <IconRefresh className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => removeConnection.mutate(connection.id)}
                      aria-label="Remove connection"
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Wire route + nav.** In `App.tsx` `MainRoutes`, add `<Route path="integrations" element={<IntegrationsPage />} />` (import it). In `AppLayout.tsx` `navigationItems`, add `{ to: '/integrations', label: 'Integrations', icon: IconPlug, end: false, preservesFilters: false }` (import `IconPlug`).

- [ ] **Step 5: Write a smoke test** following the existing web test pattern (see `AppSmoke.test.tsx`): render `IntegrationsPage` inside a `QueryClientProvider` + router with `connectionsApi` fetch mocked, assert the two action buttons render and a listed gmail connection shows its email and a remove button.

- [ ] **Step 6: Run to verify PASS** - `pnpm --filter web test && pnpm --filter web typecheck`.
- [ ] **Step 7: Commit**

```bash
commita --no-push -x "Add the web Integrations page: list connections with status, link Gmail (with 402 premium upsell), connect Telegram deep link, remove and re-authenticate actions."
```

---

## Phase 5 - Verification

### Task 11: Full regression + live smoke

**Files:** none (verification only)

- [ ] **Step 1:** `pnpm --filter backend test` → all pass; `pnpm --filter backend typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter web test && pnpm --filter web typecheck` → pass/clean.
- [ ] **Step 3: Live smoke (requires live mode + real credentials, owner account).** Link your real Gmail via the UI; confirm a `connection` row exists with a bytea secret and null cursor; wait one poll interval, confirm the cursor is set; send yourself a bank-style email, confirm one transaction imports, attributed to your user, with an `import_source` row; pair Telegram via the deep link, confirm the confirmation message arrives and an edit-by-reply still works; remove the Gmail connection and confirm the row is gone. Document each observed result.
- [ ] **Step 4:** Update `CLAUDE.md`'s roadmap: mark connections as shipped on backend/web, still pending on Android.
- [ ] **Step 5: Commit any fixups**

```bash
commita --no-push -x "Regression and live smoke for per-user connections; CLAUDE.md roadmap updated (Android parity still pending)."
```

---

## Follow-up plan (not in this document): Android parity

Android needs: an Integrations screen (list/status), Link Gmail via bearer-fetched URL opened in a Chrome Custom Tab, App-Link/interstitial return handling, Telegram deep link, remove/re-auth actions, and the premium upsell state. Write that plan with the `ship-mobile-app` skill once this plan has landed, reading the Android app's actual navigation/networking patterns first. The API surface it consumes is exactly Tasks 5-6 plus the `?linked=gmail` / `?error=<code>` return-page contract.

---

## Self-review notes

- **Spec coverage:** data model (T1), crypto+env (T2), pairing codes (T3), connection model+premium counting (T4), management endpoints+mock 503+revoke (T5), callback+anti-phishing+legacy deletion (T6), dedupe+pipeline+onboarding guard+notify isolation (T7), telegram per-user+pairing+403 (T8), poller with lock/downgrade/cursor/isolation + owner-transition index rewiring (T9), web UI (T10), verification+rollout smoke (T11). Rollout env/redirect-URI steps live in the spec's Owner transition section and are exercised in T11's live smoke. Android: explicit follow-up plan.
- **Known judgment call:** AAD is `${userId}:${email}` (stable pre-insert) rather than the row id; noted in both T5 and T6 so the two call sites agree.
- The purge of expired pairing codes (T3's `purgeExpiredPairingCodes`) is called opportunistically: wire it into the poller tick in T9 if desired; it is exported and tested either way.
