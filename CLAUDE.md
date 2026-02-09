# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI art transformation app (Next.js 16 + React 19) where users upload images and select art styles (sketch, watercolor, oil painting). Processing uses RunPod Serverless with async webhook callbacks.

## Commands

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint (flat config)

## Architecture Overview

### Async Processing Flow

1. Frontend uploads image to Supabase Storage via pre-signed URL
2. Frontend calls `/api/transform` with imageUrl and style
3. Backend submits RunPod job with webhook URL
4. RunPod calls `/api/webhooks/runpod` when complete
5. Frontend polls `/api/jobs/[runpodId]` for status/results

### Dual Storage Strategy

- **Production**: Supabase Storage (S3-compatible)
- **Mock Mode**: In-memory storage (`POC_MOCK_MODE=true`)

All storage operations go through `lib/storage.ts` which routes to the appropriate backend based on `isPocMockMode()`.

### Key API Routes

| Route | Purpose |
|-------|---------|
| `/api/upload/presigned` | Generate Supabase pre-signed upload URL |
| `/api/transform` | Submit AI transformation job to RunPod |
| `/api/jobs/[runpodId]` | Poll job status from database |
| `/api/webhooks/runpod` | Receive RunPod completion callbacks |
| `/api/webhooks/shopify` | Optional Shopify order processing |

### Core Libraries (`lib/`)

| File | Purpose |
|------|---------|
| `runpod.ts` | Workflow template loading, seed injection, job submission |
| `db.ts` | Neon database connection pool singleton |
| `storage.ts` | Storage abstraction (Supabase vs mock) |
| `poc-config.ts` | Mock mode configuration |
| `upload-validation.ts` | File type/size validation, error codes |

### Workflow Templates

Style-specific ComfyUI workflows stored at repo root:
- `workflow_api_sketch.json`
- `workflow_api_watercolor.json`
- `workflow_api_oil.json`
- `workflow_api.json` (default fallback)

`lib/runpod.ts` handles: template loading, seed injection, checkpoint replacement, `{{style}}` placeholder substitution.

## Error Handling

Unified error codes via `UploadValidationError` class:
- `INVALID_PAYLOAD`
- `UNSUPPORTED_CONTENT_TYPE`
- `FILE_TOO_LARGE`
- `INVALID_IMAGE_URL`
- `OBJECT_NOT_FOUND`

## Styling System

Uses HSL color values via CSS custom properties defined in `app/globals.css`:
- Dark mode forced at root (`html className="dark"` in `app/layout.tsx`)
- Theme colors: `bg-primary`, `text-foreground`, etc.
- Custom animations: `accordion-down`, `accordion-up`

## Path Aliases

```typescript
"@/*": ["./*"]
```

## Important Configuration

- `next.config.mjs`: 10MB body limit for Server Actions, images unoptimized
- ESLint flat config with custom rules (allows `console.warn/error`)
- `pnpm` as package manager
