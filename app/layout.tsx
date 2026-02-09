import React from "react"
import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'AI Art Upload',
  description: 'Upload an image and generate AI art with RunPod workflows.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
