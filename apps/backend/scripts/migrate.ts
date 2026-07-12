import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exitCode = 1
    return
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const migrationsDirectory = join(scriptDirectory, '..', 'migrations')
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    )

    for (const fileName of migrationFiles) {
      const alreadyApplied = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [fileName],
      )
      if (alreadyApplied.rows.length) {
        console.log(`Skipping ${fileName} (already applied)`)
        continue
      }
      const migrationSql = await readFile(join(migrationsDirectory, fileName), 'utf8')
      await pool.query(migrationSql)
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [fileName])
      console.log(`Applied migration ${fileName}`)
    }
  } finally {
    await pool.end()
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
