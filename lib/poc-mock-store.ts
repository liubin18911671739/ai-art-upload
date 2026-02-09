import { getMockDataTtlMs } from '@/lib/poc-config'

export type MockJobStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

export type MockStoredObject = {
  key: string
  body: Buffer
  contentType: string
  contentLength: number
  createdAt: number
  expiresAt: number
}

export type MockJobRecord = {
  runpodId: string
  orderId: string
  status: MockJobStatus
  sourceImageUrl: string
  outputImageUrl: string | null
  outputVideoUrl: string | null
  style: string
  seed: number
  createdAt: number
  updatedAt: number
  expiresAt: number
}

type MockStoreState = {
  objects: Map<string, MockStoredObject>
  jobs: Map<string, MockJobRecord>
}

const STORE_KEY = '__AI_ART_POC_MOCK_STORE__'

type GlobalWithMockStore = typeof globalThis & {
  [STORE_KEY]?: MockStoreState
}

function getState() {
  const globalStore = globalThis as GlobalWithMockStore
  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = {
      objects: new Map<string, MockStoredObject>(),
      jobs: new Map<string, MockJobRecord>(),
    }
  }

  return globalStore[STORE_KEY]
}

function cleanupExpiredRecords(state: MockStoreState) {
  const now = Date.now()

  for (const [key, item] of state.objects.entries()) {
    if (item.expiresAt <= now) {
      state.objects.delete(key)
    }
  }

  for (const [key, item] of state.jobs.entries()) {
    if (item.expiresAt <= now) {
      state.jobs.delete(key)
    }
  }
}

function nowWithTtl() {
  const now = Date.now()
  const ttlMs = getMockDataTtlMs()
  return {
    now,
    expiresAt: now + ttlMs,
  }
}

export function putMockStoredObject(args: {
  key: string
  body: Buffer
  contentType: string
  contentLength: number
}) {
  const state = getState()
  cleanupExpiredRecords(state)

  const { now, expiresAt } = nowWithTtl()
  const record: MockStoredObject = {
    key: args.key,
    body: args.body,
    contentType: args.contentType,
    contentLength: args.contentLength,
    createdAt: now,
    expiresAt,
  }
  state.objects.set(args.key, record)

  return record
}

export function getMockStoredObject(key: string) {
  const state = getState()
  cleanupExpiredRecords(state)
  return state.objects.get(key) ?? null
}

export function createMockJob(args: {
  runpodId: string
  orderId: string
  sourceImageUrl: string
  style: string
  seed: number
}) {
  const state = getState()
  cleanupExpiredRecords(state)

  const { now, expiresAt } = nowWithTtl()
  const record: MockJobRecord = {
    runpodId: args.runpodId,
    orderId: args.orderId,
    status: 'PROCESSING',
    sourceImageUrl: args.sourceImageUrl,
    outputImageUrl: null,
    outputVideoUrl: null,
    style: args.style,
    seed: args.seed,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  }

  state.jobs.set(args.runpodId, record)
  return record
}

export function markMockJobSucceeded(args: {
  runpodId: string
  outputImageUrl: string | null
  outputVideoUrl: string | null
}) {
  const state = getState()
  cleanupExpiredRecords(state)
  const existing = state.jobs.get(args.runpodId)
  if (!existing) {
    return null
  }

  const { now, expiresAt } = nowWithTtl()
  const next: MockJobRecord = {
    ...existing,
    status: 'SUCCEEDED',
    outputImageUrl: args.outputImageUrl,
    outputVideoUrl: args.outputVideoUrl,
    updatedAt: now,
    expiresAt,
  }
  state.jobs.set(args.runpodId, next)
  return next
}

export function markMockJobFailed(runpodId: string) {
  const state = getState()
  cleanupExpiredRecords(state)
  const existing = state.jobs.get(runpodId)
  if (!existing) {
    return null
  }

  const { now, expiresAt } = nowWithTtl()
  const next: MockJobRecord = {
    ...existing,
    status: 'FAILED',
    updatedAt: now,
    expiresAt,
  }
  state.jobs.set(runpodId, next)
  return next
}

export function getMockJob(runpodId: string) {
  const state = getState()
  cleanupExpiredRecords(state)
  return state.jobs.get(runpodId) ?? null
}
