// One-off: assign every ledger row with a NULL user_id to the owner (the first
// email in ALLOWED_EMAILS). The owner must have signed in once so a "user" row
// exists. Run AFTER migration 003, BEFORE migration 004.
import pg from 'pg'

async function backfill(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  const ownerEmail = (process.env.ALLOWED_EMAILS ?? '').split(',')[0]?.trim()
  if (!connectionString || !ownerEmail) {
    console.error('DATABASE_URL and ALLOWED_EMAILS must be set')
    process.exitCode = 1
    return
  }
  const pool = new pg.Pool({ connectionString })
  try {
    const owner = await pool.query('SELECT id FROM "user" WHERE email = $1', [ownerEmail])
    const ownerId = owner.rows[0]?.id as string | undefined
    if (!ownerId) {
      console.error(`No "user" row for ${ownerEmail}. Sign in once with Google, then re-run.`)
      process.exitCode = 1
      return
    }
    for (const table of ['accounts', 'categories', 'transactions']) {
      const result = await pool.query(
        `UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`,
        [ownerId],
      )
      console.log(`Backfilled ${result.rowCount} rows in ${table}`)
    }
  } finally {
    await pool.end()
  }
}

backfill().catch((error) => {
  console.error('Backfill failed:', error.message)
  process.exitCode = 1
})
