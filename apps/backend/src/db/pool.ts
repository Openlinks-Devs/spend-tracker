import pg from 'pg'
import { loadEnv } from '../config/env.js'

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>
}

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: loadEnv().DATABASE_URL })
    // Without a listener, an error on an idle client (e.g. the hosted Postgres
    // dropping a connection) is an unhandled 'error' event that kills the process.
    pool.on('error', (error) => {
      console.error('Idle Postgres client error:', error)
    })
  }
  return pool
}
