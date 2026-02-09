import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { NextResponse } from 'next/server'
import getRawBody from 'raw-body'

import { getDb } from '@/lib/db'
import { isShopifyEnabled } from '@/lib/feature-flags'
import { serverFetch } from '@/lib/network'
import { isPocMockMode } from '@/lib/poc-config'
import { extractRunpodJobId, submitJob } from '@/lib/runpod'
import {
  UploadValidationError,
  validateMime,
  validateSize,
} from '@/lib/upload-validation'

export const runtime = 'nodejs'

type ShopifyLineItemProperty = {
  name?: string
  value?: string
}

type ShopifyLineItem = {
  image?: { src?: string; url?: string } | string
  featured_image?: { src?: string; url?: string }
  properties?: ShopifyLineItemProperty[]
}

type ShopifyOrderWebhookPayload = {
  id?: string | number
  line_items?: ShopifyLineItem[]
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim())
}

function shouldSkipInMockMode() {
  if (!isPocMockMode()) {
    return false
  }

  return (
    !hasEnv('SHOPIFY_WEBHOOK_SECRET') ||
    !hasEnv('SHOPIFY_STORE_DOMAIN') ||
    !hasEnv('SHOPIFY_ADMIN_ACCESS_TOKEN')
  )
}

function formatOrderId() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const suffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()
  return `ORD-${y}${m}${d}-${suffix}`
}

function asHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

function findLineItemProperty(
  properties: ShopifyLineItemProperty[] | undefined,
  keyWords: RegExp,
) {
  if (!Array.isArray(properties)) {
    return null
  }

  for (const prop of properties) {
    if (!prop || typeof prop.name !== 'string') {
      continue
    }
    if (!keyWords.test(prop.name.toLowerCase())) {
      continue
    }
    if (typeof prop.value === 'string' && prop.value.trim() !== '') {
      return prop.value.trim()
    }
  }

  return null
}

function extractImageUrl(payload: ShopifyOrderWebhookPayload) {
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : []
  for (const item of lineItems) {
    const imageCandidate =
      typeof item.image === 'string'
        ? item.image
        : item.image?.url ?? item.image?.src ?? item.featured_image?.url ?? item.featured_image?.src

    const propertyImage = findLineItemProperty(
      item.properties,
      /(image|img).*(url|src)|^(image|img|url)$/i,
    )

    const resolved = asHttpsUrl(imageCandidate) ?? asHttpsUrl(propertyImage)
    if (resolved) {
      return resolved
    }
  }

  throw new Error('Unable to extract image URL from Shopify line_items')
}

function extractStyle(payload: ShopifyOrderWebhookPayload) {
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : []
  for (const item of lineItems) {
    const style = findLineItemProperty(item.properties, /(style|preset|filter)/i)
    if (style) {
      return style
    }
  }
  return 'default'
}

async function verifyShopifyHmac(rawBody: Buffer, incomingHmac: string) {
  const secret = getRequiredEnv('SHOPIFY_WEBHOOK_SECRET')
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64')

  const expected = Buffer.from(digest, 'base64')
  const received = Buffer.from(incomingHmac, 'base64')

  if (expected.length === 0 || expected.length !== received.length) {
    return false
  }

  return timingSafeEqual(expected, received)
}

async function scheduleRunpodAndPersistJob(args: {
  orderId: string
  imageUrl: string
  style: string
}) {
  const db = getDb()
  const client = await db.connect()

  try {
    const headResponse = await serverFetch(args.imageUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
    })

    if (!headResponse.ok) {
      throw new UploadValidationError(
        'OBJECT_NOT_FOUND',
        `Source image is unavailable: ${headResponse.status}`,
        404,
      )
    }

    const headContentType = headResponse.headers.get('content-type')
    if (!headContentType) {
      throw new UploadValidationError(
        'UNSUPPORTED_CONTENT_TYPE',
        'Source image content-type header is missing',
        415,
      )
    }

    const contentLengthHeader = headResponse.headers.get('content-length')
    if (!contentLengthHeader) {
      throw new UploadValidationError(
        'INVALID_PAYLOAD',
        'Source image content-length header is missing',
        400,
      )
    }

    const contentLength = Number(contentLengthHeader)
    validateMime(headContentType)
    validateSize(contentLength)

    const submitResult = await submitJob({
      imageUrl: args.imageUrl,
      style: args.style,
    })

    const runpodId = extractRunpodJobId(submitResult.response)

    await client.query('BEGIN')
    await client.query(
      `
        INSERT INTO jobs (runpod_id, order_id)
        VALUES ($1, $2)
        ON CONFLICT (runpod_id) DO UPDATE
        SET order_id = EXCLUDED.order_id
      `,
      [runpodId, args.orderId],
    )
    await client.query(
      `
        UPDATE orders
        SET status = 'PROCESSING'
        WHERE id = $1
      `,
      [args.orderId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    await db.query(`UPDATE orders SET status = 'FAILED' WHERE id = $1`, [args.orderId])
    if (error instanceof UploadValidationError) {
      console.warn(
        `Rejected Shopify image for order ${args.orderId}: ${error.code} ${error.message}`,
      )
      return
    }
    console.error('Failed to submit RunPod job from Shopify webhook:', error)
  } finally {
    client.release()
  }
}

export async function POST(request: Request) {
  try {
    if (!isShopifyEnabled()) {
      return NextResponse.json({ ok: true, disabled: true, skipped: true })
    }

    if (shouldSkipInMockMode()) {
      console.warn('Shopify webhook skipped in POC mock mode due to missing Shopify config.')
      return NextResponse.json({ ok: true, mock: true, skipped: true })
    }

    const incomingHmac = request.headers.get('X-Shopify-Hmac-Sha256')
    if (!incomingHmac) {
      return NextResponse.json({ error: 'Missing Shopify HMAC header' }, { status: 401 })
    }

    const eventId = request.headers.get('X-Shopify-Event-Id')
    if (!eventId) {
      return NextResponse.json({ error: 'Missing Shopify event id header' }, { status: 400 })
    }

    const topic = request.headers.get('X-Shopify-Topic') ?? 'unknown'
    if (!request.body) {
      return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
    }

    const bodyStream = Readable.fromWeb(request.body as unknown as NodeReadableStream)
    const rawBody = await getRawBody(bodyStream)
    const isValid = await verifyShopifyHmac(rawBody, incomingHmac)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid Shopify webhook signature' }, { status: 401 })
    }

    const db = getDb()
    const insertEvent = await db.query(
      `
        INSERT INTO webhook_events (event_id, topic)
        VALUES ($1, $2)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `,
      [eventId, topic],
    )

    if (insertEvent.rowCount === 0) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const payload = JSON.parse(rawBody.toString('utf-8')) as ShopifyOrderWebhookPayload
    const shopifyOrderId =
      typeof payload.id === 'number' || typeof payload.id === 'string'
        ? String(payload.id)
        : null

    if (!shopifyOrderId) {
      return NextResponse.json({ error: 'Invalid payload: missing order id' }, { status: 400 })
    }

    const imageUrl = extractImageUrl(payload)
    const style = extractStyle(payload)

    const insertedOrder = await db.query<{ id: string }>(
      `
        INSERT INTO orders (id, shopify_order_id, image_url, style, status)
        VALUES ($1, $2, $3, $4, 'PENDING')
        ON CONFLICT (shopify_order_id) DO UPDATE
        SET image_url = EXCLUDED.image_url,
            style = EXCLUDED.style
        RETURNING id
      `,
      [formatOrderId(), shopifyOrderId, imageUrl, style],
    )

    const orderId = insertedOrder.rows[0]?.id
    if (!orderId) {
      throw new Error('Failed to create or fetch order record')
    }

    // Must acknowledge Shopify quickly (<3s); RunPod dispatch continues asynchronously.
    void scheduleRunpodAndPersistJob({
      orderId,
      imageUrl,
      style,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Shopify webhook failed: ${message}` }, { status: 500 })
  }
}
