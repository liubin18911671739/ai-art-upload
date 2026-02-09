import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { isShopifyEnabled } from '@/lib/feature-flags'
import { orderIdToGid, shopifyGraphql } from '@/lib/shopify'

export const runtime = 'nodejs'

type RunpodWebhookPayload = {
  id?: string
  jobId?: string
  status?: string
  output?: {
    message?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

type OrderRecord = {
  order_id: string
  shopify_order_id: string
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function verifyRunpodWebhookToken(request: Request) {
  const secret = getRequiredEnv('RUNPOD_WEBHOOK_SECRET')
  const tokenParam = process.env.RUNPOD_WEBHOOK_TOKEN_PARAM?.trim() || 'token'
  const url = new URL(request.url)
  const token = url.searchParams.get(tokenParam) || ''

  const expected = Buffer.from(secret)
  const received = Buffer.from(token)

  if (expected.length === 0 || expected.length !== received.length) {
    return false
  }

  return timingSafeEqual(expected, received)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function tryUrl(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  const trimmed = value.trim()

  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    return trimmed
  }

  if (/^data:video\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

function collectUrlsFromString(text: string) {
  const urls = text.match(/https?:\/\/[^\s"')]+/g) ?? []
  let imageUrl: string | null = null
  let videoUrl: string | null = null

  for (const candidate of urls) {
    const url = tryUrl(candidate)
    if (!url) {
      continue
    }
    if (!imageUrl && /\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(url)) {
      imageUrl = url
    }
    if (!videoUrl && /\.(mp4|mov|webm|mkv)(\?|$)/i.test(url)) {
      videoUrl = url
    }
  }

  return { imageUrl, videoUrl }
}

function findFirstUrlByKeys(
  value: unknown,
  keyPattern: RegExp,
  visited = new Set<unknown>(),
): string | null {
  if (visited.has(value)) {
    return null
  }
  visited.add(value)

  const direct = tryUrl(value)
  if (direct) {
    return direct
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstUrlByKeys(item, keyPattern, visited)
      if (nested) {
        return nested
      }
    }
    return null
  }

  const obj = asRecord(value)
  if (!obj) {
    return null
  }

  for (const [key, nestedValue] of Object.entries(obj)) {
    if (keyPattern.test(key.toLowerCase())) {
      const candidate = findFirstUrlByKeys(nestedValue, keyPattern, visited)
      if (candidate) {
        return candidate
      }
    }
  }

  for (const nestedValue of Object.values(obj)) {
    const candidate = findFirstUrlByKeys(nestedValue, keyPattern, visited)
    if (candidate) {
      return candidate
    }
  }

  return null
}

function extractRunpodId(payload: RunpodWebhookPayload) {
  const candidates = [payload.id, payload.jobId]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate
    }
  }
  throw new Error('Missing runpod id in webhook payload')
}

function extractOutputUrls(message: unknown) {
  const imageFromKeys = findFirstUrlByKeys(
    message,
    /(image|img|output_image|preview|result)/i,
  )
  const videoFromKeys = findFirstUrlByKeys(
    message,
    /(video|timelapse|time_lapse|output_video)/i,
  )

  let imageUrl = imageFromKeys
  let videoUrl = videoFromKeys

  if (typeof message === 'string') {
    const fromText = collectUrlsFromString(message)
    imageUrl = imageUrl ?? fromText.imageUrl
    videoUrl = videoUrl ?? fromText.videoUrl
  }

  return {
    imageUrl,
    videoUrl,
  }
}

async function writeShopifyAiArtMetafields(params: {
  shopifyOrderId: string
  status: 'SUCCEEDED' | 'FAILED'
  runpodId: string
  imageUrl: string | null
  videoUrl: string | null
}) {
  if (!isShopifyEnabled()) {
    return
  }

  if (!params.shopifyOrderId || params.shopifyOrderId.startsWith('MANUAL-')) {
    return
  }

  const ownerId = orderIdToGid(params.shopifyOrderId)
  const mutation = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }
  `

  const metafields = [
    {
      ownerId,
      namespace: 'ai_art',
      key: 'status',
      type: 'single_line_text_field',
      value: params.status,
    },
    {
      ownerId,
      namespace: 'ai_art',
      key: 'runpod_id',
      type: 'single_line_text_field',
      value: params.runpodId,
    },
    {
      ownerId,
      namespace: 'ai_art',
      key: 'output_image_url',
      type: 'single_line_text_field',
      value: params.imageUrl ?? '',
    },
    {
      ownerId,
      namespace: 'ai_art',
      key: 'output_video_url',
      type: 'single_line_text_field',
      value: params.videoUrl ?? '',
    },
  ]

  const result = await shopifyGraphql<{
    metafieldsSet: {
      userErrors: Array<{ field?: string[]; message?: string }>
    }
  }>(mutation, { metafields })

  const userErrors = result.metafieldsSet.userErrors
  if (userErrors.length > 0) {
    throw new Error(
      `Shopify metafieldsSet userErrors: ${userErrors
        .map((e) => e.message || 'unknown')
        .join('; ')}`,
    )
  }
}

export async function POST(request: Request) {
  try {
    if (!verifyRunpodWebhookToken(request)) {
      return NextResponse.json({ error: 'Invalid webhook token' }, { status: 401 })
    }

    const payload = (await request.json()) as RunpodWebhookPayload
    const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : ''
    const runpodId = extractRunpodId(payload)
    const db = getDb()

    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      const failedOrder = await db.query<OrderRecord>(
        `
          UPDATE orders o
          SET status = 'FAILED'
          FROM jobs j
          WHERE j.order_id = o.id
            AND j.runpod_id = $1
          RETURNING o.id AS order_id, o.shopify_order_id AS shopify_order_id
        `,
        [runpodId],
      )

      const failedRow = failedOrder.rows[0]
      if (failedRow) {
        writeShopifyAiArtMetafields({
          shopifyOrderId: failedRow.shopify_order_id,
          status: 'FAILED',
          runpodId,
          imageUrl: null,
          videoUrl: null,
        }).catch((error) => {
          console.error(
            `Failed to write Shopify metafields for runpod failed job ${runpodId}:`,
            error,
          )
        })
      }

      return NextResponse.json({
        ok: true,
        runpodId,
        status: 'FAILED',
        orderId: failedRow?.order_id ?? null,
      })
    }

    if (status !== 'COMPLETED') {
      return NextResponse.json({ ok: true, ignored: true, runpodId, status })
    }

    const { imageUrl, videoUrl } = extractOutputUrls(payload.output?.message)

    const updatedJob = await db.query<{ order_id: string }>(
      `
        UPDATE jobs
        SET output_image_url = COALESCE($2, output_image_url),
            output_video_url = COALESCE($3, output_video_url)
        WHERE runpod_id = $1
        RETURNING order_id
      `,
      [runpodId, imageUrl, videoUrl],
    )

    if (updatedJob.rowCount === 0) {
      return NextResponse.json({ ok: true, warning: 'Job not found' })
    }

    const orderId = updatedJob.rows[0]?.order_id
    if (!orderId) {
      throw new Error('Missing order_id after updating job')
    }

    const updatedOrder = await db.query<OrderRecord>(
      `
        UPDATE orders o
        SET status = 'SUCCEEDED'
        WHERE o.id = $1
        RETURNING o.id AS order_id, o.shopify_order_id AS shopify_order_id
      `,
      [orderId],
    )

    const orderRow = updatedOrder.rows[0]
    if (orderRow) {
      writeShopifyAiArtMetafields({
        shopifyOrderId: orderRow.shopify_order_id,
        status: 'SUCCEEDED',
        runpodId,
        imageUrl,
        videoUrl,
      }).catch((error) => {
        console.error(
          `Failed to write Shopify metafields for runpod completed job ${runpodId}:`,
          error,
        )
      })
    }

    return NextResponse.json({
      ok: true,
      runpodId,
      orderId,
      imageUrl,
      videoUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `RunPod webhook failed: ${message}` }, { status: 500 })
  }
}
