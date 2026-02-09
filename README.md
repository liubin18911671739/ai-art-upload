# AI Art Upload

一个基于 Next.js 的 AI 艺术风格转换应用。当前已打通上传、RunPod 异步任务提交、Webhook 回调与结果查询链路。

## 文档入口

- 开发与部署步骤：`docs/开发与部署指南.md`

## 当前状态

- 已实现：Supabase Storage 上传、`/api/transform` 任务派发、RunPod 回调入库、前端轮询任务状态与结果展示/下载
- 已实现：Shopify webhook 验签 + 幂等落库 + 异步任务调度
- 已实现：文件双层校验（`jpeg/png/webp`、最大 `10MB`）
- 未实现：历史记录、用户系统
- 详细计划：见 `TODO.md`

## 已验证结果（2026-02-09）

- `pnpm lint` 可运行，当前有 2 条 warning（`actionTypes` 仅用于类型）
- Google Fonts 依赖已移除，离线不再触发字体拉取失败

## 技术栈

- Next.js 16（App Router）
- React 19 + TypeScript
- Tailwind CSS + shadcn/ui（Radix UI）
- lucide-react
- pnpm

## AI 调度策略

- 提供商：`RunPod`
- 模式：`async-webhook`
- 设计原则：所有外部 webhook 快速返回，不等待 AI 生成结果

## Webhook 安全与回写

- RunPod 回调来源校验：`Query Secret`（`RUNPOD_WEBHOOK_SECRET`，参数名默认 `token`）
- Shopify 开关：`SHOPIFY_ENABLED=false` 时，Shopify webhook 与回写逻辑会被跳过
- Shopify 回写方式：`Admin GraphQL` -> `metafieldsSet`
- 回写字段（namespace=`ai_art`）：
  - `status`
  - `runpod_id`
  - `output_image_url`
  - `output_video_url`

## 文件校验规则

- 允许 MIME：`image/jpeg`, `image/png`, `image/webp`
- 大小限制：`10MB`
- 前后端双层校验：
  - 前端：上传前阻断非法类型/超大文件
- 后端：`/api/upload/presigned` + `/api/transform` 双重校验，且 `transform` 会对存储对象做 `HEAD` 最终校验

## 统一错误码

- `INVALID_PAYLOAD`
- `UNSUPPORTED_CONTENT_TYPE`
- `FILE_TOO_LARGE`
- `INVALID_IMAGE_URL`
- `OBJECT_NOT_FOUND`

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 10+

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev
```

打开 `http://localhost:3000`

### 代码检查

```bash
pnpm lint
```

### 生产构建

```bash
pnpm build
pnpm start
```

## PoC 本地 Mock 模式

用于不依赖真实 RunPod / 存储 / Shopify / 数据库 的端到端演示。

### 启动步骤

1. 使用 PoC 环境变量：

```bash
cp .env.local.poc .env.local
```

2. 启动开发服务：

```bash
pnpm dev
```

3. 打开 `http://localhost:3000`，执行上传 -> 提交 -> 轮询 -> 下载流程。

### Mock 模式行为说明

- 开启方式：`POC_MOCK_MODE=true`
- 上传改为本地接口：`PUT/HEAD/GET /api/mock/storage/[...key]`
- `/api/upload/presigned` 直接返回本地 `uploadUrl/publicUrl`
- `/api/transform` 不触发 DB/RunPod，任务写入内存并在 `POC_MOCK_JOB_DELAY_MS` 后自动 `SUCCEEDED`
- `/api/jobs/[runpodId]` 从内存任务表读取状态
- 关闭 `POC_MOCK_MODE` 后，恢复当前真实链路逻辑

## 项目结构（关键部分）

```text
app/
  layout.tsx        # 根布局（当前强制 dark 模式）
  page.tsx          # 核心页面：上传 + 风格选择 + 结果状态展示
  globals.css       # 主题变量和全局样式
  api/              # 上传/任务/Webhook API 路由
components/
  ui/               # shadcn/ui 组件（约 50 个）
  theme-provider.tsx
hooks/
  use-mobile.tsx
  use-toast.ts
lib/
  utils.ts
  db.ts             # 数据库连接（可使用 Supabase Postgres）
  runpod.ts         # 工作流注入与 RunPod 派发
```

## 目前主要问题

- 尚未实现 Shopify fulfillment 发货创建（当前仅回写 AI 资产链接与状态）
- 尚未实现对 Shopify 回写失败的重试队列（当前仅日志记录）
- 尚未接入用户历史记录与结果管理

## License

MIT
