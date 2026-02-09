import { randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { isPocMockMode } from '@/lib/poc-config'
import { serverFetch } from '@/lib/network'
import { extractStorageKeyFromPublicUrl } from '@/lib/storage'
import { downloadObjectFromSupabase } from '@/lib/supabase'
import {
  mimeToExtension,
  validateMime,
  validateSize,
} from '@/lib/upload-validation'

const DEFAULT_WORKFLOW_FILE_NAME = 'workflow_api.json'
const STYLE_WORKFLOW_FILES: Record<string, string> = {
  sketch: 'workflow_api_sketch.json',
  watercolor: 'workflow_api_watercolor.json',
  oil: 'workflow_api_oil.json',
}
const DEFAULT_WEBHOOK_PATH = '/api/webhooks/runpod'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

type NodeObject = {
  class_type?: string
  inputs?: Record<string, JsonValue>
  [key: string]: JsonValue | undefined
}

type RunpodImageInput = {
  name: string
  image: string
}

type ImageTransport = 'url' | 'images'

export type PreparePayloadInput = {
  imageUrl: string
  style: string
  seed?: number
}

export type PreparedPayload = {
  workflow: JsonValue
  seed: number
  images: RunpodImageInput[]
  imageTransport: ImageTransport
  comfyOrgApiKey: string | null
}

export type SubmitJobResult = {
  seed: number
  webhookUrl: string
  response: Record<string, unknown>
}

export type OrderJobStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function asObject(value: JsonValue): JsonObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }
  return null
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function isNodeObject(value: JsonObject): value is JsonObject & NodeObject {
  const classType = value.class_type
  const inputs = value.inputs
  if (typeof classType !== 'string') {
    return false
  }

  return !!asObject(inputs as JsonValue)
}

function walkJson(value: JsonValue, visitor: (node: JsonObject) => void) {
  const obj = asObject(value)
  if (obj) {
    visitor(obj)
    for (const nested of Object.values(obj)) {
      walkJson(nested, visitor)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(item, visitor)
    }
  }
}

function getAllNodes(workflow: JsonValue) {
  const nodes: NodeObject[] = []
  walkJson(workflow, (node) => {
    if (isNodeObject(node)) {
      nodes.push(node)
    }
  })
  return nodes
}

function normalizeSeed(seed?: number) {
  if (typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0) {
    return seed
  }

  return randomInt(0, 2_147_483_647)
}

function resolveImageTargetNode(nodes: NodeObject[]) {
  const byClassType = nodes.find((node) => {
    const classType = node.class_type?.toLowerCase() ?? ''
    const inputs = asObject(node.inputs as JsonValue)
    return (
      !!inputs &&
      typeof inputs.image === 'string' &&
      /(load.?image|image.?load|url.*image|image.*url)/i.test(classType)
    )
  })

  const fallback = nodes.find((node) => {
    const inputs = asObject(node.inputs as JsonValue)
    return !!inputs && typeof inputs.image === 'string'
  })

  const targetNode = byClassType ?? fallback
  const targetInputs = targetNode ? asObject(targetNode.inputs as JsonValue) : null

  if (!targetNode || !targetInputs) {
    throw new Error('Unable to find an image loader node with an `image` input')
  }

  return {
    node: targetNode,
    inputs: targetInputs,
  }
}

function parseImageTransport(value: string | undefined): 'auto' | ImageTransport {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'url') {
    return 'url'
  }
  if (normalized === 'images' || normalized === 'base64') {
    return 'images'
  }
  return 'auto'
}

function resolveImageTransport(targetNode: NodeObject): ImageTransport {
  const fromEnv = parseImageTransport(process.env.RUNPOD_IMAGE_TRANSPORT)
  if (fromEnv !== 'auto') {
    return fromEnv
  }

  const classType = targetNode.class_type?.toLowerCase() ?? ''
  if (/(url|http)/i.test(classType)) {
    return 'url'
  }

  return 'images'
}

function resolveComfyOrgApiKey() {
  const override = process.env.RUNPOD_COMFY_ORG_API_KEY?.trim()
  if (override) {
    return override
  }

  const fallback = process.env.COMFY_ORG_API_KEY?.trim()
  if (fallback) {
    return fallback
  }

  return null
}

async function buildRunpodImageInput(imageUrl: string): Promise<RunpodImageInput> {
  let body: ArrayBuffer | null = null
  let contentTypeRaw = ''
  let storageError: Error | null = null

  try {
    const key = extractStorageKeyFromPublicUrl(imageUrl)
    const downloaded = await downloadObjectFromSupabase(key)
    body = downloaded.body
    contentTypeRaw = downloaded.contentType
  } catch (error) {
    storageError = error instanceof Error ? error : new Error(String(error))
  }

  if (!body) {
    const response = await serverFetch(imageUrl, {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      const hint = storageError ? `; auth fetch failed: ${storageError.message}` : ''
      throw new Error(
        `Failed to load source image for RunPod images input: ${response.status} ${response.statusText}${hint}`,
      )
    }

    body = await response.arrayBuffer()
    contentTypeRaw = response.headers.get('content-type') ?? ''
  }

  const bytes = new Uint8Array(body)
  validateSize(bytes.byteLength)

  const contentType = validateMime(contentTypeRaw)
  const ext = mimeToExtension(contentType)
  const fileNameBase = process.env.RUNPOD_INPUT_IMAGE_NAME?.trim() || 'input-image'
  const fileName = fileNameBase.includes('.')
    ? fileNameBase
    : `${fileNameBase}.${ext}`

  return {
    name: fileName,
    image: Buffer.from(bytes).toString('base64'),
  }
}

function ensureRunRequestSizeLimit(requestBody: string) {
  const fallbackMax = 10 * 1024 * 1024
  const rawMax = process.env.RUNPOD_RUN_MAX_REQUEST_BYTES?.trim()
  const parsed = rawMax ? Number.parseInt(rawMax, 10) : Number.NaN
  const max = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMax
  const actual = Buffer.byteLength(requestBody, 'utf8')

  if (actual > max) {
    throw new Error(
      `RunPod /run payload is too large (${actual} bytes > ${max}). Reduce image size or set RUNPOD_IMAGE_TRANSPORT=url.`,
    )
  }
}

function injectSeed(nodes: NodeObject[], seed: number) {
  const seedKeys = ['seed', 'noise_seed', 'random_seed'] as const
  let applied = 0

  for (const node of nodes) {
    const classType = node.class_type?.toLowerCase() ?? ''
    const inputs = asObject(node.inputs as JsonValue)
    if (!inputs) {
      continue
    }

    const isSeedNode = /(randomnoise|ksampler)/i.test(classType)
    if (!isSeedNode) {
      continue
    }

    for (const key of seedKeys) {
      if (key in inputs) {
        inputs[key] = seed
        applied += 1
      }
    }
  }

  if (applied === 0) {
    throw new Error('Unable to find RandomNoise/KSampler node to inject seed')
  }
}

function injectStylePlaceholders(workflow: JsonValue, style: string) {
  if (!style.trim()) {
    return
  }

  walkJson(workflow, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && value.includes('{{style}}')) {
        node[key] = value.replaceAll('{{style}}', style) as JsonValue
      }
    }
  })
}

function resolveCheckpointName(style: string) {
  const normalizedStyle = normalizeStyleKey(style)
  const styleEnvKey = normalizedStyle
    ? `RUNPOD_CHECKPOINT_${normalizedStyle.toUpperCase()}`
    : ''
  const styleCheckpoint = styleEnvKey ? process.env[styleEnvKey] : ''
  const globalCheckpoint = process.env.RUNPOD_CHECKPOINT_NAME
  const resolved = styleCheckpoint?.trim() || globalCheckpoint?.trim() || ''

  if (!resolved) {
    return null
  }

  // Guardrail: audio checkpoints will crash image workflows with conv1d shape errors.
  if (/(audio|music|vocoder|encodec|mel|wav)/i.test(resolved)) {
    throw new Error(
      `Invalid checkpoint for image workflow: ${resolved}. Please set RUNPOD_CHECKPOINT_NAME to an image checkpoint.`,
    )
  }

  return resolved
}

function injectCheckpointName(nodes: NodeObject[], style: string) {
  const checkpointName = resolveCheckpointName(style)
  if (!checkpointName) {
    return
  }

  const checkpointNodes = nodes.filter((node) => {
    const inputs = asObject(node.inputs as JsonValue)
    return !!inputs && typeof inputs.ckpt_name === 'string'
  })

  for (const node of checkpointNodes) {
    const inputs = asObject(node.inputs as JsonValue)
    if (!inputs) {
      continue
    }
    inputs.ckpt_name = checkpointName
  }
}

function normalizeDim(value: JsonValue | undefined, fallback = 1024) {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN

  if (!Number.isFinite(numeric) || numeric < 64) {
    return fallback
  }

  const rounded = Math.floor(numeric / 8) * 8
  return rounded >= 64 ? rounded : fallback
}

function normalizeBatchSize(value: JsonValue | undefined) {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN

  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1
  }

  return Math.floor(numeric)
}

function ensureLatentImageConfig(nodes: NodeObject[]) {
  for (const node of nodes) {
    if (node.class_type?.toLowerCase() !== 'emptylatentimage') {
      continue
    }

    const inputs = asObject(node.inputs as JsonValue)
    if (!inputs) {
      continue
    }

    inputs.width = normalizeDim(inputs.width, 1024)
    inputs.height = normalizeDim(inputs.height, 1024)
    inputs.batch_size = normalizeBatchSize(inputs.batch_size)
  }
}

function ensureVideoOutputName(nodes: NodeObject[], style: string) {
  const videoNode = nodes.find(
    (node) => node.class_type?.toLowerCase() === 'vhs_videocombine',
  )

  if (!videoNode) {
    return
  }

  const inputs = asObject(videoNode.inputs as JsonValue)
  if (!inputs) {
    return
  }

  const existing = inputs.filename_prefix
  if (typeof existing === 'string' && existing.trim() !== '') {
    return
  }

  const styleSlug = style.trim().replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase() || 'style'
  inputs.filename_prefix = `runpod-${styleSlug}-${Date.now()}`
}

function normalizeStyleKey(style: string) {
  return style.trim().toLowerCase().replace(/[-_\s]+/g, '')
}

function resolveWorkflowCandidates(style: string) {
  const normalized = normalizeStyleKey(style)
  let preferred: string | undefined

  if (normalized === 'sketch' || normalized === 'pencil' || normalized === 'lineart') {
    preferred = STYLE_WORKFLOW_FILES.sketch
  } else if (
    normalized === 'watercolor' ||
    normalized === 'watercolour' ||
    normalized === 'aquarelle'
  ) {
    preferred = STYLE_WORKFLOW_FILES.watercolor
  } else if (
    normalized === 'oil' ||
    normalized === 'oilpaint' ||
    normalized === 'oilpainting'
  ) {
    preferred = STYLE_WORKFLOW_FILES.oil
  }

  if (!preferred) {
    preferred = STYLE_WORKFLOW_FILES[normalized]
  }

  if (!preferred || preferred === DEFAULT_WORKFLOW_FILE_NAME) {
    return [DEFAULT_WORKFLOW_FILE_NAME]
  }

  return [preferred, DEFAULT_WORKFLOW_FILE_NAME]
}

async function loadWorkflowTemplateFromFile(fileName: string, forceRefresh: boolean) {
  const workflowPath = path.join(process.cwd(), fileName)
  const rawContent = await readFile(workflowPath, 'utf-8')
  const parsed = JSON.parse(rawContent) as JsonValue
  if (forceRefresh) {
    // Kept for API compatibility. Templates are reloaded on every request.
  }
  return structuredClone(parsed)
}

export async function loadWorkflowTemplate(
  forceRefresh = false,
  style = '',
): Promise<JsonValue> {
  const candidates = resolveWorkflowCandidates(style)
  let parseError: Error | null = null

  for (const fileName of candidates) {
    try {
      return await loadWorkflowTemplateFromFile(fileName, forceRefresh)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        continue
      }

      parseError = new Error(`Invalid or unreadable JSON in ${fileName}: ${String(error)}`)
      break
    }
  }

  if (parseError) {
    throw parseError
  }

  throw new Error(
    `Failed to read workflow template. Tried: ${candidates.join(', ')}`,
  )
}

export async function preparePayload({
  imageUrl,
  style,
  seed,
}: PreparePayloadInput): Promise<PreparedPayload> {
  if (!imageUrl.trim()) {
    throw new Error('`imageUrl` is required')
  }

  const workflow = await loadWorkflowTemplate(false, style)
  const nodes = getAllNodes(workflow)

  if (nodes.length === 0) {
    throw new Error('No workflow nodes found in workflow_api.json')
  }

  const resolvedSeed = normalizeSeed(seed)
  const imageTarget = resolveImageTargetNode(nodes)
  const imageTransport = resolveImageTransport(imageTarget.node)
  const images: RunpodImageInput[] = []

  if (imageTransport === 'images') {
    const inputImage = await buildRunpodImageInput(imageUrl)
    imageTarget.inputs.image = inputImage.name
    images.push(inputImage)
  } else {
    imageTarget.inputs.image = imageUrl
  }

  injectCheckpointName(nodes, style)
  ensureLatentImageConfig(nodes)
  injectSeed(nodes, resolvedSeed)
  injectStylePlaceholders(workflow, style)
  ensureVideoOutputName(nodes, style)

  return {
    workflow,
    seed: resolvedSeed,
    images,
    imageTransport,
    comfyOrgApiKey: resolveComfyOrgApiKey(),
  }
}

function buildWebhookUrl() {
  const baseUrl = getRequiredEnv('NEXT_PUBLIC_BASE_URL').replace(/\/+$/, '')
  const webhookSecret = getRequiredEnv('RUNPOD_WEBHOOK_SECRET')
  const tokenParam = process.env.RUNPOD_WEBHOOK_TOKEN_PARAM?.trim() || 'token'
  const parsed = new URL(baseUrl)
  const isLocalhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1'

  if (isLocalhost && !isPocMockMode()) {
    throw new Error(
      'NEXT_PUBLIC_BASE_URL must be a production domain (not localhost) for RunPod webhooks',
    )
  }

  const webhookUrl = new URL(`${baseUrl}${DEFAULT_WEBHOOK_PATH}`)
  webhookUrl.searchParams.set(tokenParam, webhookSecret)

  return webhookUrl.toString()
}

export function extractRunpodJobId(response: Record<string, unknown>) {
  const directCandidates = [
    response.id,
    response.jobId,
    response.requestId,
    response.executionId,
  ]

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate
    }
  }

  const nested = response.output
  if (nested && typeof nested === 'object') {
    const nestedObj = nested as Record<string, unknown>
    const nestedCandidates = [
      nestedObj.id,
      nestedObj.jobId,
      nestedObj.requestId,
      nestedObj.executionId,
    ]
    for (const candidate of nestedCandidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return candidate
      }
    }
  }

  throw new Error(
    `Unable to extract RunPod job id from response: ${JSON.stringify(response)}`,
  )
}

function normalizeRunpodErrorText(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  const limit = 500
  if (compact.length <= limit) {
    return compact
  }
  return `${compact.slice(0, limit)}...`
}

function stringifyUnknown(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function tryAssetUrl(value: unknown) {
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

function collectUrlsFromText(text: string) {
  const urls = text.match(/https?:\/\/[^\s"')]+/g) ?? []
  let imageUrl: string | null = null
  let videoUrl: string | null = null

  for (const candidate of urls) {
    const url = tryAssetUrl(candidate)
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

function findFirstAssetUrlByKeys(
  value: unknown,
  keyPattern: RegExp,
  visited = new Set<unknown>(),
): string | null {
  if (visited.has(value)) {
    return null
  }
  visited.add(value)

  const direct = tryAssetUrl(value)
  if (direct) {
    return direct
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstAssetUrlByKeys(item, keyPattern, visited)
      if (nested) {
        return nested
      }
    }
    return null
  }

  const obj = asUnknownRecord(value)
  if (!obj) {
    return null
  }

  for (const [key, nestedValue] of Object.entries(obj)) {
    if (keyPattern.test(key.toLowerCase())) {
      const candidate = findFirstAssetUrlByKeys(nestedValue, keyPattern, visited)
      if (candidate) {
        return candidate
      }
    }
  }

  for (const nestedValue of Object.values(obj)) {
    const candidate = findFirstAssetUrlByKeys(nestedValue, keyPattern, visited)
    if (candidate) {
      return candidate
    }
  }

  return null
}

export function extractRunpodOutputUrls(message: unknown) {
  const imageFromKeys = findFirstAssetUrlByKeys(
    message,
    /(image|img|output_image|preview|result)/i,
  )
  const videoFromKeys = findFirstAssetUrlByKeys(
    message,
    /(video|timelapse|time_lapse|output_video)/i,
  )

  let imageUrl = imageFromKeys
  let videoUrl = videoFromKeys

  if (typeof message === 'string') {
    const fromText = collectUrlsFromText(message)
    imageUrl = imageUrl ?? fromText.imageUrl
    videoUrl = videoUrl ?? fromText.videoUrl
  }

  return {
    imageUrl,
    videoUrl,
  }
}

export function mapRunpodStatusToOrderStatus(status: unknown): OrderJobStatus | null {
  const normalized = typeof status === 'string' ? status.trim().toUpperCase() : ''
  if (!normalized) {
    return null
  }

  if (normalized === 'COMPLETED') {
    return 'SUCCEEDED'
  }

  if (
    normalized === 'FAILED' ||
    normalized === 'CANCELLED' ||
    normalized === 'TIMED_OUT'
  ) {
    return 'FAILED'
  }

  if (
    normalized === 'IN_QUEUE' ||
    normalized === 'IN_PROGRESS' ||
    normalized === 'INITIALIZING' ||
    normalized === 'QUEUED'
  ) {
    return 'PROCESSING'
  }

  return null
}

export function extractRunpodFailureReason(response: Record<string, unknown>) {
  const output = asUnknownRecord(response.output)
  const nestedOutputError = asUnknownRecord(output?.error)
  const nestedOutputMessage = asUnknownRecord(output?.message)

  const candidates: unknown[] = [
    response.error,
    response.message,
    output?.error,
    output?.message,
    nestedOutputError?.message,
    nestedOutputMessage?.message,
    nestedOutputMessage?.error,
  ]

  for (const candidate of candidates) {
    const text = stringifyUnknown(candidate)
    if (typeof text === 'string' && text.trim() !== '') {
      return normalizeRunpodErrorText(text)
    }
  }

  return null
}

export async function fetchRunpodJobStatus(runpodId: string) {
  if (!runpodId.trim()) {
    throw new Error('`runpodId` is required')
  }

  if (isPocMockMode()) {
    return {
      id: runpodId,
      status: 'MOCK',
      mock: true,
    }
  }

  const endpointId = getRequiredEnv('RUNPOD_ENDPOINT_ID')
  const apiKey = getRequiredEnv('RUNPOD_API_KEY')
  const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(runpodId)}`

  const response = await serverFetch(statusUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  const raw = await response.text()
  let parsed: Record<string, unknown> = {}
  if (raw) {
    try {
      const decoded = JSON.parse(raw)
      parsed = asUnknownRecord(decoded) ?? { raw: decoded }
    } catch {
      parsed = { raw }
    }
  }

  if (!response.ok) {
    throw new Error(
      `RunPod status query failed (${response.status} ${response.statusText}): ${JSON.stringify(parsed)}`,
    )
  }

  return parsed
}

export async function submitJob(input: PreparePayloadInput): Promise<SubmitJobResult> {
  const webhookUrl = buildWebhookUrl()
  const seed = normalizeSeed(input.seed)

  if (isPocMockMode()) {
    return {
      seed,
      webhookUrl,
      response: {
        id: `mock-${randomUUID()}`,
        status: 'IN_QUEUE',
        mock: true,
      },
    }
  }

  const endpointId = getRequiredEnv('RUNPOD_ENDPOINT_ID')
  const apiKey = getRequiredEnv('RUNPOD_API_KEY')
  const prepared = await preparePayload({ ...input, seed })

  const url = `https://api.runpod.ai/v2/${endpointId}/run`
  const runpodInput: Record<string, unknown> = {
    workflow: prepared.workflow,
  }
  if (prepared.images.length > 0) {
    runpodInput.images = prepared.images
  }
  if (prepared.comfyOrgApiKey) {
    runpodInput.comfy_org_api_key = prepared.comfyOrgApiKey
  }

  const requestBody = JSON.stringify({
    input: runpodInput,
    webhook: webhookUrl,
  })
  ensureRunRequestSizeLimit(requestBody)

  const response = await serverFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
  })

  const raw = await response.text()
  let parsed: Record<string, unknown> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      parsed = { raw }
    }
  }

  if (!response.ok) {
    throw new Error(
      `RunPod submit failed (${response.status} ${response.statusText}): ${JSON.stringify(parsed)}`,
    )
  }

  return {
    seed,
    webhookUrl,
    response: parsed,
  }
}
