import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { sortMigrationFileNames } from '../db/migrationFiles.js'

// Its own id, distinct from the connection poller's POLL_LOCK_ID.
const MIGRATION_LOCK_ID = 727402

async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exitCode = 1
    return
  }

  // Resolves to apps/backend/migrations from both places this runs: the source
  // at src/scripts/ under tsx, and the build output at dist/scripts/ in the
  // container. The Dockerfile copies migrations/ into the runtime image for the
  // second case.
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const migrationsDirectory = join(scriptDirectory, '..', '..', 'migrations')
  const migrationFileNames = sortMigrationFileNames(await readdir(migrationsDirectory))

  const pool = new pg.Pool({ connectionString })
  // Held across the whole run. This now executes on every container start, and
  // a rolling deploy can have two containers booting at once: the
  // already-applied check and the INSERT are separate statements, so without
  // this both could decide the same file is pending and try to apply it twice.
  // Blocking rather than pg_try_advisory_lock, because the second container
  // should wait for the schema to be ready, not skip ahead and serve against a
  // half-migrated database.
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    for (const migrationFileName of migrationFileNames) {
      const alreadyApplied = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [migrationFileName],
      )
      if (alreadyApplied.rows.length > 0) {
        console.log(`Skipping already-applied ${migrationFileName}`)
        continue
      }
      const migrationSql = await readFile(join(migrationsDirectory, migrationFileName), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(migrationSql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migrationFileName])
        await client.query('COMMIT')
        console.log(`Applied ${migrationFileName}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
    } catch {
      // The lock dies with the session either way, and pool.end() is next.
    }
    lockClient.release()
    await pool.end()
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
