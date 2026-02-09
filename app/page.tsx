'use client'

import React from "react"

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Upload, Sparkles, Wand2, Palette, Droplets } from 'lucide-react'
import {
  ALLOWED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
  normalizeMime,
} from '@/lib/upload-validation'

type ArtStyle = 'sketch' | 'watercolor' | 'oil' | null

type PresignedUploadResponse = {
  uploadUrl: string
  publicUrl: string
  key: string
  maxBytes: number
  allowedContentTypes: readonly string[]
}

type TransformResponse = {
  ok: boolean
  orderId: string
  runpodId: string
  seed: number
  status: string
  provider: string
  mode: string
}

type JobStatusResponse = {
  ok: boolean
  runpodId: string
  orderId: string
  status: string
  outputImageUrl: string | null
  outputVideoUrl: string | null
}

type ApiErrorResponse = {
  error?: string
  code?: string
}

const POLL_INTERVAL_MS = 2500
const POLL_MAX_ATTEMPTS = 120
const POLL_MAX_HARD_ERROR_RETRIES = 3
const POLL_MAX_TRANSIENT_ERROR_RETRIES = 8
const NON_RETRYABLE_ERROR_CODES = new Set([
  'TLS_CERT_ERROR',
  'DB_CONNECTIVITY_ERROR',
  'INTERNAL_ERROR',
])

export default function Page() {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedStyle, setSelectedStyle] = useState<ArtStyle>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [runpodId, setRunpodId] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState<string | null>(null)
  const [outputImageUrl, setOutputImageUrl] = useState<string | null>(null)
  const [outputVideoUrl, setOutputVideoUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDownloadingImage, setIsDownloadingImage] = useState(false)
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingSessionRef = useRef(0)

  useEffect(() => {
    return () => {
      pollingSessionRef.current += 1
    }
  }, [])

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })

  const getErrorText = (error: unknown) => {
    if (error instanceof Error) {
      return error.message
    }
    return '未知错误'
  }

  const validateFileInput = (file: File) => {
    const normalizedMime = normalizeMime(file.type || '')
    if (!ALLOWED_IMAGE_MIME.includes(normalizedMime as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new Error(`仅支持 ${ALLOWED_IMAGE_MIME.join(', ')} 格式`)
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`文件大小不能超过 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`)
    }
  }

  const getExtensionFromUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      const filename = parsed.pathname.split('/').pop() ?? ''
      const ext = filename.split('.').pop()?.toLowerCase()
      return ext || null
    } catch {
      return null
    }
  }

  const triggerDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }

  const downloadOutput = async (url: string, kind: 'image' | 'video') => {
    const setLoading = kind === 'image' ? setIsDownloadingImage : setIsDownloadingVideo
    const styleName = selectedStyle ?? 'style'

    setLoading(true)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('下载失败')
      }

      const blob = await response.blob()
      const ext = getExtensionFromUrl(url) ?? (kind === 'image' ? 'png' : 'mp4')
      const filename = `ai-art-${styleName}-${Date.now()}.${ext}`
      triggerDownload(blob, filename)
    } catch {
      setErrorMessage(
        `下载${kind === 'image' ? '图片' : '视频'}失败，请使用“新标签页打开”链接重试。`,
      )
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setLoading(false)
    }
  }

  const pollJobStatus = async (jobId: string, session: number, attempt = 0): Promise<void> => {
    if (session !== pollingSessionRef.current) {
      return
    }

    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => ({}))) as ApiErrorResponse
        const message =
          typeof payload.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : `任务状态查询失败（HTTP ${response.status}）`
        const code = payload.code?.trim().toUpperCase()
        const isNonRetryableCode = code
          ? NON_RETRYABLE_ERROR_CODES.has(code)
          : false
        const shouldRetry =
          !isNonRetryableCode &&
          (response.status === 404 ||
          response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504 ||
          (response.status >= 500 && attempt < POLL_MAX_HARD_ERROR_RETRIES)
          )

        if (
          shouldRetry &&
          attempt < POLL_MAX_ATTEMPTS &&
          attempt < POLL_MAX_TRANSIENT_ERROR_RETRIES
        ) {
          await sleep(POLL_INTERVAL_MS)
          return pollJobStatus(jobId, session, attempt + 1)
        }

        setIsUploading(false)
        if (isNonRetryableCode) {
          setErrorMessage(message)
          return
        }
        setErrorMessage(`${message}（runpodId: ${jobId}）`)
        return
      }

      const data = (await response.json()) as JobStatusResponse
      setOrderStatus(data.status)
      setOutputImageUrl(data.outputImageUrl)
      setOutputVideoUrl(data.outputVideoUrl)

      if (data.status === 'SUCCEEDED') {
        setUploadProgress(100)
        setIsUploading(false)
        return
      }

      if (data.status === 'FAILED') {
        setIsUploading(false)
        setErrorMessage('任务执行失败，请更换图片或风格后重试。')
        return
      }

      setUploadProgress((prev) => Math.min(95, prev + 3))
      await sleep(POLL_INTERVAL_MS)
      return pollJobStatus(jobId, session, attempt + 1)
    } catch {
      if (attempt < POLL_MAX_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS)
        return pollJobStatus(jobId, session, attempt + 1)
      }
      setIsUploading(false)
      setErrorMessage('网络异常，无法获取任务状态。')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const handleFileUpload = (file: File) => {
    if (!selectedStyle) {
      setErrorMessage('请先选择艺术风格，再上传图像。')
      return
    }

    try {
      validateFileInput(file)
    } catch (error) {
      setErrorMessage(getErrorText(error))
      return
    }

    const session = Date.now()
    pollingSessionRef.current = session

    setUploadedFile(file)
    setSourceImageUrl(null)
    setRunpodId(null)
    setOrderStatus(null)
    setOutputImageUrl(null)
    setOutputVideoUrl(null)
    setErrorMessage(null)
    setIsUploading(true)
    setUploadProgress(5)

    void (async () => {
      try {
        const presignedResponse = await fetch('/api/upload/presigned', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
          }),
        })

        if (!presignedResponse.ok) {
          const error = await presignedResponse.json().catch(() => ({}))
          throw new Error(error.error ?? '获取上传地址失败')
        }

        const presigned = (await presignedResponse.json()) as PresignedUploadResponse
        const allowedTypes = new Set(presigned.allowedContentTypes)
        const normalizedFileType = normalizeMime(file.type || '')
        if (!allowedTypes.has(normalizedFileType)) {
          throw new Error('文件类型与服务端策略不匹配')
        }
        if (file.size > presigned.maxBytes) {
          throw new Error(`文件大小超限（最大 ${Math.floor(presigned.maxBytes / (1024 * 1024))}MB）`)
        }

        setUploadProgress(30)

        const uploadResponse = await fetch(presigned.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        })

        if (!uploadResponse.ok) {
          const errorPayload = await uploadResponse.json().catch(() => ({}))
          throw new Error(errorPayload.error ?? '上传文件到存储服务失败')
        }

        setSourceImageUrl(presigned.publicUrl)
        setUploadProgress(60)

        const transformResponse = await fetch('/api/transform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageUrl: presigned.publicUrl,
            style: selectedStyle,
          }),
        })

        if (!transformResponse.ok) {
          const error = await transformResponse.json().catch(() => ({}))
          throw new Error(error.error ?? '提交 AI 任务失败')
        }

        const transform = (await transformResponse.json()) as TransformResponse
        setRunpodId(transform.runpodId)
        setOrderStatus(transform.status)
        setUploadProgress(75)

        await pollJobStatus(transform.runpodId, session)
      } catch (error) {
        setIsUploading(false)
        setUploadProgress(0)
        setErrorMessage(getErrorText(error))
      }
    })()
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const artStyles = [
    {
      id: 'sketch' as const,
      name: '素描',
      description: '经典铅笔素描风格',
      icon: Wand2,
    },
    {
      id: 'watercolor' as const,
      name: '水彩',
      description: '流动的水彩质感',
      icon: Droplets,
    },
    {
      id: 'oil' as const,
      name: '油画',
      description: '厚重的油画笔触',
      icon: Palette,
    },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-4xl space-y-8">
        {/* 标题区域 */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="w-8 h-8 text-primary" />
            <h1 className="text-4xl font-bold text-foreground text-balance">
              AI 艺术工作室
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            上传您的图像，让 AI 为您重新诠释艺术
          </p>
        </div>

        {/* 上传区域 */}
        <Card
          className={`relative overflow-hidden transition-all duration-300 ${
            isDragging
              ? 'border-primary ring-2 ring-primary/20 scale-[1.02]'
              : 'border-border hover:border-primary/50'
          } ${
            isUploading ? 'bg-card/50' : 'bg-card cursor-pointer'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={!isUploading ? handleClick : undefined}
        >
          <div className="relative p-16">
            {/* 记忆扫描动效背景 */}
            {isDragging && (
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
              </div>
            )}

            {!isUploading ? (
              <div className="relative z-10 flex flex-col items-center justify-center space-y-6">
                {/* 上传图标 */}
                <div className="relative">
                  <div className="absolute inset-0 animate-pulse blur-xl opacity-50 bg-primary/20 rounded-full" />
                  <div className="relative w-24 h-24 rounded-full bg-secondary flex items-center justify-center border border-border">
                    <Upload className="w-12 h-12 text-primary" />
                  </div>
                </div>

                {/* 上传文本 */}
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-semibold text-foreground">
                    {uploadedFile ? uploadedFile.name : '拖拽图像到此处'}
                  </h3>
                  <p className="text-muted-foreground">
                    或点击选择文件 · 支持 JPG, PNG, WebP（最大 10MB）
                  </p>
                </div>

                {/* 扫描线动效 */}
                {isDragging && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-[scan_1.5s_ease-in-out_infinite]" />
                )}
              </div>
            ) : (
              <div className="relative z-10 flex flex-col items-center justify-center space-y-6">
                {/* 处理图标 */}
                <div className="relative">
                  <div className="absolute inset-0 animate-spin blur-xl opacity-50 bg-primary/20 rounded-full" />
                  <div className="relative w-24 h-24 rounded-full bg-secondary flex items-center justify-center border border-primary/50">
                    <Sparkles className="w-12 h-12 text-primary animate-pulse" />
                  </div>
                </div>

                {/* 进度文本 */}
                <div className="text-center space-y-4 w-full max-w-md">
                  <h3 className="text-2xl font-semibold text-foreground">
                    正在解析光影情感...
                  </h3>
                  <Progress value={uploadProgress} className="h-2" />
                  <p className="text-sm text-muted-foreground">
                    {uploadProgress}% 完成
                  </p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </Card>

        {/* 艺术风格选择器 */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground text-center">
            选择艺术风格
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {artStyles.map((style) => {
              const Icon = style.icon
              const isSelected = selectedStyle === style.id
              
              return (
                <Card
                  key={style.id}
                  className={`relative overflow-hidden transition-all duration-300 cursor-pointer group ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/20 bg-primary/5 scale-105'
                      : 'border-border hover:border-primary/50 hover:scale-[1.02]'
                  }`}
                  onClick={() => setSelectedStyle(style.id)}
                >
                  <div className="p-6 flex flex-col items-center text-center space-y-4">
                    {/* 图标 */}
                    <div
                      className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground group-hover:text-primary'
                      }`}
                    >
                      <Icon className="w-8 h-8" />
                    </div>

                    {/* 文本 */}
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold text-foreground">
                        {style.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {style.description}
                      </p>
                    </div>

                    {/* 选中指示器 */}
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        </div>

        {/* 状态与结果 */}
        {(runpodId || outputImageUrl || outputVideoUrl || errorMessage) && (
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold text-foreground">任务状态</h2>
            {errorMessage && (
              <p className="text-sm text-red-400">{errorMessage}</p>
            )}
            {runpodId && (
              <p className="text-sm text-muted-foreground break-all">
                RunPod Job ID: {runpodId}
              </p>
            )}
            {orderStatus && (
              <p className="text-sm text-muted-foreground">
                当前状态: {orderStatus}
              </p>
            )}
            {sourceImageUrl && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">原图</p>
                <img
                  src={sourceImageUrl}
                  alt="原图"
                  className="w-full max-h-96 object-contain rounded-md border border-border"
                />
              </div>
            )}
            {outputImageUrl && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">生成结果</p>
                <img
                  src={outputImageUrl}
                  alt="生成结果"
                  className="w-full max-h-96 object-contain rounded-md border border-border"
                />
                <div className="flex gap-3 items-center">
                  <Button
                    type="button"
                    onClick={() => {
                      void downloadOutput(outputImageUrl, 'image')
                    }}
                    disabled={isDownloadingImage}
                  >
                    {isDownloadingImage ? '下载中...' : '下载图片'}
                  </Button>
                  <a
                    href={outputImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground underline"
                  >
                    新标签页打开图片
                  </a>
                </div>
              </div>
            )}
            {outputVideoUrl && (
              <div className="space-y-2">
                <div className="flex gap-3 items-center">
                  <Button
                    type="button"
                    onClick={() => {
                      void downloadOutput(outputVideoUrl, 'video')
                    }}
                    disabled={isDownloadingVideo}
                  >
                    {isDownloadingVideo ? '下载中...' : '下载视频'}
                  </Button>
                  <a
                    href={outputVideoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground underline"
                  >
                    新标签页打开视频
                  </a>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* 添加自定义动画 */}
      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        @keyframes scan {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(100vh);
          }
        }
      `}</style>
    </div>
  )
}
