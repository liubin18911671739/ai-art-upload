import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { formatDbConnectivityMessage } from '@/lib/db-errors'
import { formatTlsErrorMessage } from '@/lib/network'
import { getMockJob } from '@/lib/poc-mock-store'
import { isPocMockMode } from '@/lib/poc-config'
import {
  extractRunpodFailureReason,
  extractRunpodOutputUrls,
  fetchRunpodJobStatus,
  mapRunpodStatusToOrderStatus,
} from '@/lib/runpod'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  context: { params: Promise<{ runpodId: string }> },
) {
  const { runpodId: rawRunpodId } = await context.params
  const runpodId = rawRunpodId?.trim()
  if (!runpodId) {
    return NextResponse.json({ error: 'runpodId is required' }, { status: 400 })
  }

  try {
    if (isPocMockMode()) {
      const job = getMockJob(runpodId)
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      return NextResponse.json({
        ok: true,
        runpodId,
        orderId: job.orderId,
        status: job.status,
        outputImageUrl: job.outputImageUrl,
        outputVideoUrl: job.outputVideoUrl,
        failureReason: null,
      })
    }

    const db = getDb()
    const result = await db.query<{
      order_id: string
      status: string
      output_image_url: string | null
      output_video_url: string | null
    }>(
      `
        SELECT
          o.id AS order_id,
          o.status AS status,
          j.output_image_url AS output_image_url,
          j.output_video_url AS output_video_url
        FROM jobs j
        INNER JOIN orders o ON o.id = j.order_id
        WHERE j.runpod_id = $1
        LIMIT 1
      `,
      [runpodId],
    )

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const row = result.rows[0]
    let resolvedStatus = row.status
    let resolvedImageUrl = row.output_image_url
    let resolvedVideoUrl = row.output_video_url
    let failureReason: string | null = null

    if (row.status !== 'SUCCEEDED') {
      try {
        const runpodStatus = await fetchRunpodJobStatus(runpodId)
        const runpodOrderStatus = mapRunpodStatusToOrderStatus(runpodStatus.status)

        if (row.status === 'PROCESSING' && runpodOrderStatus) {
          resolvedStatus = runpodOrderStatus
        }

        const runpodOutput =
          runpodStatus.output && typeof runpodStatus.output === 'object'
            ? (runpodStatus.output as Record<string, unknown>)
            : null
        const realtimeOutput = extractRunpodOutputUrls(
          runpodOutput?.message ?? runpodOutput ?? runpodStatus.output ?? null,
        )
        resolvedImageUrl = realtimeOutput.imageUrl ?? resolvedImageUrl
        resolvedVideoUrl = realtimeOutput.videoUrl ?? resolvedVideoUrl

        if (resolvedStatus === 'FAILED') {
          failureReason = extractRunpodFailureReason(runpodStatus)
        }
      } catch (error) {
        console.error(
          `Failed to fetch RunPod live status for job ${runpodId}:`,
          error,
        )
      }
    }

    if (resolvedStatus !== row.status) {
      await db.query(
        `
          UPDATE orders
          SET status = $2
          WHERE id = $1
            AND status <> $2
        `,
        [row.order_id, resolvedStatus],
      )
    }

    if (
      resolvedImageUrl !== row.output_image_url ||
      resolvedVideoUrl !== row.output_video_url
    ) {
      await db.query(
        `
          UPDATE jobs
          SET output_image_url = COALESCE($2, output_image_url),
              output_video_url = COALESCE($3, output_video_url)
          WHERE runpod_id = $1
        `,
        [runpodId, resolvedImageUrl, resolvedVideoUrl],
      )
    }

    return NextResponse.json({
      ok: true,
      runpodId,
      orderId: row.order_id,
      status: resolvedStatus,
      outputImageUrl: resolvedImageUrl,
      outputVideoUrl: resolvedVideoUrl,
      failureReason,
    })
  } catch (error) {
    const dbConnectivityMessage = formatDbConnectivityMessage(error)
    if (dbConnectivityMessage) {
      return NextResponse.json(
        {
          error: dbConnectivityMessage,
          code: 'DB_CONNECTIVITY_ERROR',
        },
        { status: 503 },
      )
    }

    const tlsErrorMessage = formatTlsErrorMessage(error)
    if (tlsErrorMessage) {
      return NextResponse.json(
        {
          error: tlsErrorMessage,
          code: 'TLS_CERT_ERROR',
        },
        { status: 502 },
      )
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to load job status: ${message}` },
      { status: 500 },
    )
  }
}
