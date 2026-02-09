export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number]

export type UploadErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_IMAGE_URL'
  | 'OBJECT_NOT_FOUND'

export type UploadErrorShape = {
  code: UploadErrorCode
  message: string
}

export class UploadValidationError extends Error {
  code: UploadErrorCode
  status: number

  constructor(code: UploadErrorCode, message: string, status: number) {
    super(message)
    this.name = 'UploadValidationError'
    this.code = code
    this.status = status
  }
}

export function normalizeMime(contentType: string) {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function validateMime(contentType: string): AllowedImageMime {
  const normalized = normalizeMime(contentType)
  if (!normalized) {
    throw new UploadValidationError(
      'UNSUPPORTED_CONTENT_TYPE',
      'Missing content type',
      415,
    )
  }

  if (!ALLOWED_IMAGE_MIME.includes(normalized as AllowedImageMime)) {
    throw new UploadValidationError(
      'UNSUPPORTED_CONTENT_TYPE',
      `Unsupported content type: ${normalized}`,
      415,
    )
  }

  return normalized as AllowedImageMime
}

export function validateSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      'Invalid content length',
      400,
    )
  }

  if (bytes > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      'FILE_TOO_LARGE',
      `File size exceeds ${MAX_UPLOAD_BYTES} bytes`,
      413,
    )
  }

  return bytes
}

export function sanitizeFilename(filename: string) {
  const normalized = filename
    .trim()
    .replace(/[/\\]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')

  if (!normalized) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      'Invalid filename',
      400,
    )
  }

  return normalized
}

export function mimeToExtension(contentType: AllowedImageMime) {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}
