import { Pool } from 'pg'

let pool: Pool | null = null
const LEGACY_SSL_MODE_ALIASES = new Set(['prefer', 'require', 'verify-ca'])

function normalizeConnectionString(connectionString: string) {
  try {
    const parsed = new URL(connectionString)
    const sslMode = parsed.searchParams.get('sslmode')?.trim().toLowerCase()
    const useLibpqCompat = parsed.searchParams
      .get('uselibpqcompat')
      ?.trim()
      .toLowerCase()

    if (
      sslMode &&
      LEGACY_SSL_MODE_ALIASES.has(sslMode) &&
      useLibpqCompat !== 'true'
    ) {
      // Keep current pg v8 security behavior explicit and future-proof.
      parsed.searchParams.set('sslmode', 'verify-full')
      return parsed.toString()
    }
  } catch {
    // Keep the original string if URL parsing fails; Pool will throw a clearer error.
  }

  return connectionString
}

function createPool() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('Missing SUPABASE_DB_URL (or DATABASE_URL) environment variable')
  }

  const normalized = connectionString.toLowerCase()
  if (
    !normalized.startsWith('postgres://') &&
    !normalized.startsWith('postgresql://')
  ) {
    throw new Error(
      'SUPABASE_DB_URL (or DATABASE_URL) must be a Postgres connection string (postgres:// or postgresql://)',
    )
  }

  return new Pool({ connectionString: normalizeConnectionString(connectionString) })
}

export function getDb() {
  if (!pool) {
    pool = createPool()
  }

  return pool
}
