import { Pool } from '@neondatabase/serverless'

let pool: Pool | null = null

function createPool() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('Missing SUPABASE_DB_URL (or DATABASE_URL) environment variable')
  }

  return new Pool({ connectionString })
}

export function getDb() {
  if (!pool) {
    pool = createPool()
  }

  return pool
}
