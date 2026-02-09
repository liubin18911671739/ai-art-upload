# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 16 application using React 19, TypeScript, and Tailwind CSS. The UI is built with shadcn/ui components (Radix UI primitives). The app is an AI art transformation interface where users upload images and select art styles (sketch, watercolor, oil painting).

## Commands

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

**Note**: TypeScript build errors are ignored in `next.config.mjs` (`ignoreBuildErrors: true`).

## Architecture

### App Structure (Next.js App Router)

- `app/` - App Router pages and layouts
  - `layout.tsx` - Root layout, defaults to dark mode (`className="dark"`)
  - `page.tsx` - Main page with drag-and-drop upload and style selection
  - `globals.css` - Global styles with CSS custom properties for theming

### Components

- `components/ui/` - shadcn/ui components (50+ Radix-based components)
  - Use `@/components/ui/*` imports
  - All use Tailwind with CSS variables for theming
- `components/theme-provider.tsx` - Wrapper around `next-themes`

### Styling System

Uses HSL color values via CSS custom properties defined in `globals.css`:
- Dark mode is forced at root (`html className="dark"` in layout.tsx)
- Primary color in dark mode: `214 100% 60%` (blue)
- Theme colors referenced via Tailwind: `bg-primary`, `text-foreground`, etc.
- Custom animations: `accordion-down`, `accordion-up`

### Path Aliases

```typescript
"@/*": ["./*"]
```

Common imports:
- `@/components/*` - Components
- `@/lib/utils` - Utilities (includes `cn()` for class merging)
- `@/hooks/*` - Custom hooks

### Key Patterns

1. **Utility function**: `cn()` from `@/lib/utils` merges clsx and tailwind-merge
2. **Icons**: lucide-react for all icon components
3. **Forms**: react-hook-form with zod validation via @hookform/resolvers
4. **Client components**: Pages use `'use client'` directive for interactivity

## Configuration Notes

- `next.config.mjs` has TypeScript errors ignored and image optimization disabled
- Tailwind uses `tailwindcss-animate` plugin
- Uses pnpm as package manager
- Components configured via `components.json` for shadcn/ui CLI
