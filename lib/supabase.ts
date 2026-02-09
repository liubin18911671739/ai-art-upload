function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
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
  return getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
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

export async function uploadObjectToSupabase(args: {
  key: string
  body: Uint8Array
  contentType: string
}) {
  const bucket = getSupabaseStorageBucket()
  const encodedKey = encodeStorageKey(args.key)
  const url = `${getSupabaseUrl()}/storage/v1/object/${bucket}/${encodedKey}`
  const token = getSupabaseServiceRoleKey()

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      'Content-Type': args.contentType,
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
