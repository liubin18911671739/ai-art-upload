import { serverFetch } from '@/lib/network'

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function decodeJwtPayload(token: string) {
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(base64, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as { role?: string }
    return parsed
  } catch {
    return null
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function encodeStorageKey(key: string) {
  return key
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function getSupabaseUrl() {
  return trimTrailingSlash(getRequiredEnv('SUPABASE_URL'))
}

export function getSupabaseServiceRoleKey() {
  const key = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  const payload = decodeJwtPayload(key)
  const role = payload?.role?.trim().toLowerCase()

  if (role && role !== 'service_role') {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY has role "${role}". Please use the service_role key from Supabase project settings.`,
    )
  }

  return key
}

export function getSupabaseStorageBucket() {
  return getRequiredEnv('SUPABASE_STORAGE_BUCKET')
}

export function getSupabaseStoragePublicDomain() {
  const explicit =
    process.env.SUPABASE_STORAGE_PUBLIC_DOMAIN?.trim() ||
    process.env.S3_PUBLIC_DOMAIN?.trim()

  if (explicit) {
    return trimTrailingSlash(explicit)
  }

  return `${getSupabaseUrl()}/storage/v1/object/public/${getSupabaseStorageBucket()}`
}

export function buildSupabasePublicObjectUrl(key: string) {
  const base = getSupabaseStoragePublicDomain()
  const encodedKey = encodeStorageKey(key)
  return `${base}/${encodedKey}`
}

function buildSupabaseObjectApiUrl(key: string) {
  const bucket = getSupabaseStorageBucket()
  const encodedKey = encodeStorageKey(key)
  return `${getSupabaseUrl()}/storage/v1/object/${bucket}/${encodedKey}`
}

function buildSupabaseServiceRoleHeaders(contentType?: string) {
  const token = getSupabaseServiceRoleKey()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    apikey: token,
  }

  if (contentType) {
    headers['Content-Type'] = contentType
  }

  return headers
}

export async function headObjectInSupabase(key: string) {
  return serverFetch(buildSupabaseObjectApiUrl(key), {
    method: 'HEAD',
    headers: buildSupabaseServiceRoleHeaders(),
    cache: 'no-store',
  })
}

export async function downloadObjectFromSupabase(key: string) {
  const response = await serverFetch(buildSupabaseObjectApiUrl(key), {
    method: 'GET',
    headers: buildSupabaseServiceRoleHeaders(),
    cache: 'no-store',
  })

  if (!response.ok) {
    const raw = await response.text()
    throw new Error(
      `Supabase download failed (${response.status} ${response.statusText}): ${raw}`,
    )
  }

  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') ?? '',
  }
}

export async function uploadObjectToSupabase(args: {
  key: string
  body: ArrayBuffer
  contentType: string
}) {
  const response = await serverFetch(buildSupabaseObjectApiUrl(args.key), {
    method: 'POST',
    headers: {
      ...buildSupabaseServiceRoleHeaders(args.contentType),
      'x-upsert': 'false',
    },
    body: args.body,
  })

  if (!response.ok) {
    const raw = await response.text()
    throw new Error(
      `Supabase upload failed (${response.status} ${response.statusText}): ${raw}`,
    )
  }
}
