import { readFile } from 'node:fs/promises'
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
  const migrationPath = join(scriptDirectory, '..', 'migrations', '001_init.sql')
  const migrationSql = await readFile(migrationPath, 'utf8')

  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(migrationSql)
    console.log('Applied migration 001_init.sql')
  } finally {
    await pool.end()
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
