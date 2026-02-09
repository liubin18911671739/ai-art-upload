import { NextResponse } from 'next/server'

import { uploadObjectToSupabase } from '@/lib/supabase'
import {
  UploadValidationError,
  validateMime,
  validateSize,
} from '@/lib/upload-validation'

export const runtime = 'nodejs'

function resolveKey(raw: string[] | undefined) {
  const key = (raw ?? []).join('/').trim()

  if (!key || !key.startsWith('uploads/')) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      'Invalid storage key',
      400,
    )
  }

  return key
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ key?: string[] }> },
) {
  try {
    const { key: rawKey } = await context.params
    const key = resolveKey(rawKey)
    const contentType = validateMime(
      request.headers.get('content-type') ?? 'application/octet-stream',
    )

    const body = await request.arrayBuffer()
    validateSize(body.byteLength)

    await uploadObjectToSupabase({
      key,
      body,
      contentType,
    })

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      )
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        error: `Failed to upload object: ${message}`,
        code: 'INVALID_PAYLOAD',
      },
      { status: 500 },
    )
  }
}
