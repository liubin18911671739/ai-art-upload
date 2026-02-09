'use client'

import React from "react"

import { useState, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Upload, Sparkles, Wand2, Palette, Droplets } from 'lucide-react'

type ArtStyle = 'sketch' | 'watercolor' | 'oil' | null

export default function Page() {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedStyle, setSelectedStyle] = useState<ArtStyle>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setUploadedFile(file)
    setIsUploading(true)
    setUploadProgress(0)

    // 模拟上传进度
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setTimeout(() => setIsUploading(false), 500)
          return 100
        }
        return prev + 10
      })
    }, 200)
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
                    或点击选择文件 · 支持 JPG, PNG, WebP
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
              accept="image/*"
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
