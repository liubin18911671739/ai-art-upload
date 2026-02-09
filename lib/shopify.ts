type ShopifyAdminConfig = {
  storeDomain: string
  adminAccessToken: string
  apiVersion: string
}

type ShopifyGraphqlResponse<T> = {
  data?: T
  errors?: Array<{ message?: string }>
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function normalizeStoreDomain(value: string) {
  const trimmed = value.trim()
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '')
  const domainOnly = withoutProtocol.split('/')[0]

  if (!domainOnly) {
    throw new Error('Invalid SHOPIFY_STORE_DOMAIN')
  }

  return domainOnly
}

export function getShopifyAdminConfig(): ShopifyAdminConfig {
  return {
    storeDomain: normalizeStoreDomain(getRequiredEnv('SHOPIFY_STORE_DOMAIN')),
    adminAccessToken: getRequiredEnv('SHOPIFY_ADMIN_ACCESS_TOKEN'),
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || '2025-10',
  }
}

export function orderIdToGid(shopifyOrderId: string) {
  const raw = shopifyOrderId.trim()
  if (!raw) {
    throw new Error('shopifyOrderId is required')
  }

  if (raw.startsWith('gid://shopify/Order/')) {
    return raw
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid Shopify order id: ${shopifyOrderId}`)
  }

  return `gid://shopify/Order/${raw}`
}

export async function shopifyGraphql<TData>(
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const config = getShopifyAdminConfig()
  const url = `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.adminAccessToken,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed (${response.status}): ${raw}`)
  }

  let parsed: ShopifyGraphqlResponse<TData>
  try {
    parsed = JSON.parse(raw) as ShopifyGraphqlResponse<TData>
  } catch {
    throw new Error('Shopify GraphQL response is not valid JSON')
  }

  if (parsed.errors?.length) {
    throw new Error(
      `Shopify GraphQL errors: ${parsed.errors.map((e) => e.message || 'unknown').join('; ')}`,
    )
  }

  if (!parsed.data) {
    throw new Error('Shopify GraphQL response missing data')
  }

  return parsed.data
}
