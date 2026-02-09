import { randomInt, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

import { AI_EXECUTION_MODE, AI_PROVIDER } from '@/lib/ai-config'
import { getDb } from '@/lib/db'
import { createMockJob, markMockJobSucceeded } from '@/lib/poc-mock-store'
import { getMockJobDelayMs, isPocMockMode } from '@/lib/poc-config'
import { extractRunpodJobId, submitJob } from '@/lib/runpod'
import { extractStorageKeyFromPublicUrl, headStoredObject } from '@/lib/storage'
import {
  UploadValidationError,
  validateMime,
  validateSize,
} from '@/lib/upload-validation'

export const runtime = 'nodejs'

type TransformRequestBody = {
  imageUrl?: string
  style?: string
  seed?: number
}

function tryAssetRef(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
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

function extractImmediateOutputFromSubmitResponse(response: Record<string, unknown>) {
  const output = response.output
  if (!output || typeof output !== 'object') {
    return { imageUrl: null, videoUrl: null }
  }

  const outputRecord = output as Record<string, unknown>
  const message = outputRecord.message
  if (typeof message !== 'string') {
    return { imageUrl: null, videoUrl: null }
  }

  const ref = tryAssetRef(message)
  if (!ref) {
    return { imageUrl: null, videoUrl: null }
  }

  if (/^data:video\/|\.mp4(\?|$)|\.mov(\?|$)|\.webm(\?|$)|\.mkv(\?|$)/i.test(ref)) {
    return { imageUrl: null, videoUrl: ref }
  }

  return { imageUrl: ref, videoUrl: null }
}

function formatOrderId() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const suffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()
  return `ORD-${y}${m}${d}-${suffix}`
}

function createManualOrderRef() {
  return `MANUAL-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

function resolveSeed(seed?: number) {
  if (typeof seed === 'number') {
    return seed
  }

  return randomInt(0, 2_147_483_647)
}

function parseBody(value: unknown): TransformRequestBody | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as TransformRequestBody
}

function validateInput(body: TransformRequestBody) {
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : ''
  const style = typeof body.style === 'string' ? body.style.trim() : ''

  if (!imageUrl) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      '`imageUrl` is required',
      400,
    )
  }

  if (!style) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      '`style` is required',
      400,
    )
  }

  let seed: number | undefined
  if (body.seed !== undefined) {
    if (!Number.isSafeInteger(body.seed) || body.seed < 0) {
      throw new UploadValidationError(
        'INVALID_PAYLOAD',
        '`seed` must be a non-negative safe integer',
        400,
      )
    }
    seed = body.seed
  }

  return {
    imageUrl,
    style,
    seed,
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.json()
    const body = parseBody(raw)
    if (!body) {
      return NextResponse.json(
        {
          error: 'Invalid payload. Expected { imageUrl, style, seed? }',
          code: 'INVALID_PAYLOAD',
        },
        { status: 400 },
      )
    }

    const input = validateInput(body)
    const objectKey = extractStorageKeyFromPublicUrl(input.imageUrl)
    const objectMeta = await headStoredObject(objectKey)
    validateMime(objectMeta.contentType)
    validateSize(objectMeta.contentLength)

    const orderId = formatOrderId()

    if (isPocMockMode()) {
      const runpodId = `mock-${randomUUID()}`
      const seed = resolveSeed(input.seed)

      createMockJob({
        runpodId,
        orderId,
        sourceImageUrl: input.imageUrl,
        style: input.style,
        seed,
      })

      const timer = setTimeout(() => {
        markMockJobSucceeded({
          runpodId,
          outputImageUrl: input.imageUrl,
          outputVideoUrl: null,
        })
      }, getMockJobDelayMs())
      timer.unref?.()

      return NextResponse.json({
        ok: true,
        orderId,
        runpodId,
        seed,
        status: 'PROCESSING',
        provider: AI_PROVIDER,
        mode: AI_EXECUTION_MODE,
      })
    }

    const db = getDb()
    const manualRef = createManualOrderRef()

    await db.query(
      `
        INSERT INTO orders (id, shopify_order_id, image_url, style, status)
        VALUES ($1, $2, $3, $4, 'PENDING')
      `,
      [orderId, manualRef, input.imageUrl, input.style],
    )

    try {
      const submitResult = await submitJob({
        imageUrl: input.imageUrl,
        style: input.style,
        seed: input.seed,
      })

      const runpodId = extractRunpodJobId(submitResult.response)
      const responseStatus =
        typeof submitResult.response.status === 'string'
          ? submitResult.response.status.toUpperCase()
          : 'IN_QUEUE'
      const isImmediatelyCompleted = responseStatus === 'COMPLETED'
      const immediateOutput = extractImmediateOutputFromSubmitResponse(
        submitResult.response,
      )
      await db.query(
        `
          INSERT INTO jobs (runpod_id, order_id, output_image_url, output_video_url)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (runpod_id) DO UPDATE
          SET order_id = EXCLUDED.order_id,
              output_image_url = COALESCE(EXCLUDED.output_image_url, jobs.output_image_url),
              output_video_url = COALESCE(EXCLUDED.output_video_url, jobs.output_video_url)
        `,
        [
          runpodId,
          orderId,
          immediateOutput.imageUrl,
          immediateOutput.videoUrl,
        ],
      )
      await db.query(
        `
          UPDATE orders
          SET status = $2
          WHERE id = $1
        `,
        [orderId, isImmediatelyCompleted ? 'SUCCEEDED' : 'PROCESSING'],
      )

      return NextResponse.json({
        ok: true,
        orderId,
        runpodId,
        seed: submitResult.seed,
        status: isImmediatelyCompleted ? 'SUCCEEDED' : 'PROCESSING',
        provider: AI_PROVIDER,
        mode: AI_EXECUTION_MODE,
      })
    } catch (error) {
      await db.query(
        `
          UPDATE orders
          SET status = 'FAILED'
          WHERE id = $1
        `,
        [orderId],
      )
      throw error
    }
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      )
    }

    console.error('Transform API failed:', error)

    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        error: `Failed to submit transform job: ${message}`,
        code: 'INVALID_PAYLOAD',
      },
      { status: 500 },
    )
  }
}
