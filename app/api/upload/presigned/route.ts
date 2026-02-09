import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { isPocMockMode } from '@/lib/poc-config'
import { getS3PublicDomain } from '@/lib/storage'
import {
  ALLOWED_IMAGE_MIME,
  UploadValidationError,
  mimeToExtension,
  sanitizeFilename,
  validateMime,
  MAX_UPLOAD_BYTES,
} from '@/lib/upload-validation'

export const runtime = 'nodejs'

function parseRequestBody(value: unknown): PresignedUploadRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Partial<PresignedUploadRequest>

  if (
    typeof payload.filename !== 'string' ||
    payload.filename.trim() === '' ||
    typeof payload.contentType !== 'string' ||
    payload.contentType.trim() === ''
  ) {
    return null
  }

  return {
    filename: payload.filename,
    contentType: payload.contentType,
  }
}

type PresignedUploadRequest = {
  filename: string
  contentType: string
}

function createObjectKey(contentType: string) {
  const ext = mimeToExtension(validateMime(contentType))
  return `uploads/${Date.now()}-${randomUUID()}.${ext}`
}

function createInternalUploadUrl(key: string) {
  return `/api/upload/object/${key}`
}

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json()
    const body = parseRequestBody(rawBody)

    if (!body) {
      return NextResponse.json(
        {
          error: 'Invalid payload. Expected: { filename, contentType }',
          code: 'INVALID_PAYLOAD',
        },
        { status: 400 },
      )
    }

    sanitizeFilename(body.filename)
    const normalizedMime = validateMime(body.contentType)

    const publicDomain = getS3PublicDomain()
    const key = createObjectKey(normalizedMime)
    const publicUrl = `${publicDomain}/${key}`

    if (isPocMockMode()) {
      return NextResponse.json({
        uploadUrl: publicUrl,
        publicUrl,
        key,
        maxBytes: MAX_UPLOAD_BYTES,
        allowedContentTypes: ALLOWED_IMAGE_MIME,
      })
    }

    const uploadUrl = createInternalUploadUrl(key)

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      key,
      maxBytes: MAX_UPLOAD_BYTES,
      allowedContentTypes: ALLOWED_IMAGE_MIME,
    })
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
        error: `Failed to create upload URL: ${message}`,
        code: 'INVALID_PAYLOAD',
      },
      { status: 500 },
    )
  }
}
