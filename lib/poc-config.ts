const DEFAULT_MOCK_JOB_DELAY_MS = 2500
const DEFAULT_MOCK_DATA_TTL_MS = 60 * 60 * 1000

function parseBoolean(value: string | undefined) {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

export function isPocMockMode() {
  return parseBoolean(process.env.POC_MOCK_MODE)
}

export function getMockJobDelayMs() {
  return parsePositiveInteger(process.env.POC_MOCK_JOB_DELAY_MS, DEFAULT_MOCK_JOB_DELAY_MS)
}

export function getMockDataTtlMs() {
  return parsePositiveInteger(process.env.POC_MOCK_DATA_TTL_MS, DEFAULT_MOCK_DATA_TTL_MS)
}

export type PocMockConfig = {
  enabled: boolean
  jobDelayMs: number
  dataTtlMs: number
}

export function getPocMockConfig(): PocMockConfig {
  return {
    enabled: isPocMockMode(),
    jobDelayMs: getMockJobDelayMs(),
    dataTtlMs: getMockDataTtlMs(),
  }
}
