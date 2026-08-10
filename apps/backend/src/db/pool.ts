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
    // pool.on('error') only covers clients sitting idle IN the pool. A client
    // checked out via pool.connect() (the poller's advisory lock, transfers,
    // imports) emits 'error' on itself instead, and an unlistened 'error' on an
    // EventEmitter kills the process. Neon autosuspends and drops idle sockets,
    // so this fires in normal operation, not just on failure. Attach on
    // 'connect' to cover every client for its whole lifetime; pg discards the
    // broken client and the next query transparently opens a new one.
    pool.on('connect', (client) => {
      client.on('error', (error) => {
        console.error('Postgres client error (connection dropped, will reconnect):', error)
      })
    })
  }
  return pool
}
