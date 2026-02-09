import { NextResponse } from 'next/server'

import { getMockStoredObject, putMockStoredObject } from '@/lib/poc-mock-store'
import { isPocMockMode } from '@/lib/poc-config'
import {
  UploadValidationError,
  validateMime,
  validateSize,
} from '@/lib/upload-validation'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    key: string[]
  }>
}

async function resolveObjectKey(context: RouteContext) {
  const { key: segments } = await context.params
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new UploadValidationError('INVALID_PAYLOAD', 'Object key is required', 400)
  }

  const key = segments.map((segment) => segment.trim()).filter(Boolean).join('/')
  if (!key || !key.startsWith('uploads/')) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      'Object key must start with uploads/',
      400,
    )
  }

  return key
}

function ensureMockMode() {
  if (!isPocMockMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return null
}

function asValidationErrorResponse(error: unknown) {
  if (error instanceof UploadValidationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json(
    { error: `Mock storage request failed: ${message}`, code: 'INVALID_PAYLOAD' },
    { status: 500 },
  )
}

export async function PUT(request: Request, context: RouteContext) {
  const disabledResponse = ensureMockMode()
  if (disabledResponse) {
    return disabledResponse
  }

  try {
    const key = await resolveObjectKey(context)
    const contentType = validateMime(request.headers.get('content-type') ?? '')
    const body = Buffer.from(await request.arrayBuffer())
    validateSize(body.length)

    putMockStoredObject({
      key,
      body,
      contentType,
      contentLength: body.length,
    })

    return NextResponse.json({
      ok: true,
      key,
      contentType,
      contentLength: body.length,
    })
  } catch (error) {
    return asValidationErrorResponse(error)
  }
}

export async function HEAD(_request: Request, context: RouteContext) {
  const disabledResponse = ensureMockMode()
  if (disabledResponse) {
    return disabledResponse
  }

  try {
    const key = await resolveObjectKey(context)
    const stored = getMockStoredObject(key)
    if (!stored) {
      return new NextResponse(null, { status: 404 })
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Length': String(stored.contentLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return asValidationErrorResponse(error)
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const disabledResponse = ensureMockMode()
  if (disabledResponse) {
    return disabledResponse
  }

  try {
    const key = await resolveObjectKey(context)
    const stored = getMockStoredObject(key)
    if (!stored) {
      return NextResponse.json(
        { error: 'Object not found', code: 'OBJECT_NOT_FOUND' },
        { status: 404 },
      )
    }

    return new NextResponse(stored.body, {
      status: 200,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Length': String(stored.contentLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return asValidationErrorResponse(error)
  }
}
