type ErrorWithCause = {
  code?: string
  message?: string
  cause?: unknown
}

const TLS_CERT_ERROR_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

const TLS_CERT_ERROR_PATTERNS = [
  /self-signed certificate/i,
  /unable to verify/i,
  /certificate chain/i,
  /tls/i,
]

let insecureTlsInitialized = false

function parseBooleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function enableInsecureTlsIfConfigured() {
  if (insecureTlsInitialized) {
    return
  }

  insecureTlsInitialized = true

  if (!parseBooleanEnv(process.env.ALLOW_SELF_SIGNED_TLS)) {
    return
  }

  // Dev-only escape hatch for environments with intercepting proxies.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

export function serverFetch(input: RequestInfo | URL, init?: RequestInit) {
  enableInsecureTlsIfConfigured()
  return fetch(input, init)
}

function findTlsCertError(error: unknown): ErrorWithCause | null {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current && !seen.has(current)) {
    seen.add(current)

    if (typeof current !== 'object') {
      break
    }

    const candidate = current as ErrorWithCause
    if (
      typeof candidate.code === 'string' &&
      TLS_CERT_ERROR_CODES.has(candidate.code)
    ) {
      return candidate
    }

    const message = typeof candidate.message === 'string' ? candidate.message : null
    if (
      message &&
      TLS_CERT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ) {
      return candidate
    }

    current = candidate.cause
  }

  return null
}

export function formatTlsErrorMessage(error: unknown) {
  const tlsError = findTlsCertError(error)
  if (!tlsError) {
    return null
  }

  const details = tlsError.message?.trim() || 'certificate validation failed'

  return (
    `TLS certificate validation failed while calling an external service: ${details}. ` +
    'If your network uses an intercepting proxy, configure NODE_EXTRA_CA_CERTS ' +
    'with your proxy/root CA and restart. For local-only testing, you can set ' +
    'ALLOW_SELF_SIGNED_TLS=true and restart the server (insecure).'
  )
}
