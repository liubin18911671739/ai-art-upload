import { getSupabaseStoragePublicDomain, headObjectInSupabase } from '@/lib/supabase'
import { getMockStoredObject } from '@/lib/poc-mock-store'
import { isPocMockMode } from '@/lib/poc-config'
import { UploadValidationError } from '@/lib/upload-validation'

export function getS3PublicDomain() {
  return getSupabaseStoragePublicDomain()
}

export function extractStorageKeyFromPublicUrl(imageUrl: string) {
  let targetUrl: URL
  let baseUrl: URL

  try {
    targetUrl = new URL(imageUrl)
    baseUrl = new URL(getS3PublicDomain())
  } catch {
    throw new UploadValidationError('INVALID_IMAGE_URL', 'Invalid image URL', 400)
  }

  if (targetUrl.origin !== baseUrl.origin) {
    throw new UploadValidationError(
      'INVALID_IMAGE_URL',
      'imageUrl must match storage public domain',
      400,
    )
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, '')
  const pathname = targetUrl.pathname
  const pathPrefix = basePath ? `${basePath}/` : '/'

  if (!pathname.startsWith(pathPrefix)) {
    throw new UploadValidationError(
      'INVALID_IMAGE_URL',
      'imageUrl path must be under storage public domain base path',
      400,
    )
  }

  const key = decodeURIComponent(pathname.slice(pathPrefix.length))
  if (!key || !key.startsWith('uploads/')) {
    throw new UploadValidationError(
      'INVALID_IMAGE_URL',
      'imageUrl key must start with uploads/',
      400,
    )
  }

  return key
}

export async function headStoredObject(key: string) {
  if (isPocMockMode()) {
    const mockObject = getMockStoredObject(key)
    if (!mockObject) {
      throw new UploadValidationError(
        'OBJECT_NOT_FOUND',
        'Uploaded object not found in mock storage',
        404,
      )
    }

    return {
      contentType: mockObject.contentType,
      contentLength: mockObject.contentLength,
    }
  }

  const response = await headObjectInSupabase(key)

  if (!response.ok) {
    if (response.status === 404) {
      throw new UploadValidationError(
        'OBJECT_NOT_FOUND',
        'Uploaded object not found in storage',
        404,
      )
    }

    throw new Error(
      `Failed to read storage object metadata: ${response.status} ${response.statusText}`,
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  const contentLength = Number(response.headers.get('content-length') ?? Number.NaN)

  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new UploadValidationError(
      'INVALID_PAYLOAD',
      'Object content length is unavailable',
      400,
    )
  }

  return {
    contentType,
    contentLength,
  }
}
