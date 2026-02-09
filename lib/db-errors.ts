type ErrorWithCode = {
  code?: string
  hostname?: string
  cause?: unknown
}

const DB_DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN'])

function getConnectionString() {
  return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || ''
}

function getConnectionHost(connectionString: string) {
  try {
    const parsed = new URL(connectionString)
    return parsed.hostname || ''
  } catch {
    return ''
  }
}

function findDbDnsError(error: unknown): ErrorWithCode | null {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current && !seen.has(current)) {
    seen.add(current)

    if (typeof current === 'object') {
      const candidate = current as ErrorWithCode
      if (typeof candidate.code === 'string' && DB_DNS_ERROR_CODES.has(candidate.code)) {
        return candidate
      }
      current = candidate.cause
      continue
    }

    break
  }

  return null
}

export function formatDbConnectivityMessage(error: unknown) {
  const dnsError = findDbDnsError(error)
  if (!dnsError) {
    return null
  }

  const hostFromEnv = getConnectionHost(getConnectionString())
  const host = dnsError.hostname || hostFromEnv || 'unknown-host'

  if (host.endsWith('.supabase.co')) {
    return (
      `Database host lookup failed for "${host}". ` +
      'Update SUPABASE_DB_URL using the current connection string from Supabase Dashboard ' +
      '(Project Settings -> Database -> Connection string). ' +
      'If direct host "db.<project-ref>.supabase.co" does not resolve, use the Transaction Pooler URL ' +
      '(host like "aws-0-<region>.pooler.supabase.com", port 6543, user "postgres.<project-ref>").'
    )
  }

  return `Database host lookup failed for "${host}". Check SUPABASE_DB_URL / DATABASE_URL and DNS settings.`
}
