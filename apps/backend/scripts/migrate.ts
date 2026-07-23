import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { sortMigrationFileNames } from '../src/db/migrationFiles.js'

async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exitCode = 1
    return
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const migrationsDirectory = join(scriptDirectory, '..', 'migrations')
  const migrationFileNames = sortMigrationFileNames(await readdir(migrationsDirectory))

  const pool = new pg.Pool({ connectionString })
  try {
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
    await pool.end()
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
