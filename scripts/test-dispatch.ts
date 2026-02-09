import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { extractRunpodJobId, submitJob } from '../lib/runpod'

function log(message: string) {
  process.stdout.write(`${message}\n`)
}

function parseEnvFile(content: string) {
  const result: Record<string, string> = {}
  const lines = content.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const equalIndex = normalized.indexOf('=')
    if (equalIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, equalIndex).trim()
    let value = normalized.slice(equalIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }

  return result
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error(`.env.local not found at ${envPath}`)
  }

  const content = readFileSync(envPath, 'utf-8')
  const parsed = parseEnvFile(content)

  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value
  }
}

async function main() {
  loadEnvLocal()

  const payload = {
    imageUrl: 'https://example.com/test.jpg',
    style: 'sketch',
  }

  log('Dispatching test RunPod job...')
  log(`Payload: ${JSON.stringify(payload)}`)

  const result = await submitJob(payload)
  const jobId = extractRunpodJobId(result.response)

  log(`jobId: ${jobId}`)
  log('Please check the RunPod console for job status and output progress.')
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Dispatch test failed: ${message}`)
  process.exitCode = 1
})
