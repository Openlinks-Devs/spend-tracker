import pg from 'pg'
import { loadEnv } from '../config/env.js'

export type Queryable = Pick<pg.Pool, 'query'>

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: loadEnv().DATABASE_URL })
  }
  return pool
}
