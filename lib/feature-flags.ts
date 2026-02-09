function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

export function isShopifyEnabled() {
  return parseBoolean(process.env.SHOPIFY_ENABLED, true)
}
