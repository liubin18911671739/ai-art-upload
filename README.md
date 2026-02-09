# AI Art Upload

基于 Next.js 16 的 AI 艺术风格转换应用。用户上传图片，选择艺术风格（素描/水彩/油画），通过 RunPod Serverless 异步处理获取结果。

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量（复制并编辑）
cp .env.local.example .env.local

# 启动开发服务器
pnpm dev
```

访问 `http://localhost:3000`

## Mock 模式

不依赖外部服务进行本地开发：

```bash
cp .env.local.poc .env.local
pnpm dev
```

## 技术栈

- **框架**: Next.js 16 (App Router) + React 19 + TypeScript
- **UI**: Tailwind CSS + shadcn/ui (Radix UI)
- **AI 处理**: RunPod Serverless (async-webhook 模式)
- **存储**: Supabase Storage (S3 兼容)
- **数据库**: Supabase Postgres (Neon driver)

## 项目结构

```text
app/
  api/              # API 路由
    transform/      # 提交 AI 转换任务
    jobs/[id]/      # 查询任务状态
    webhooks/       # RunPod/Shopify 回调
  page.tsx          # 主页面：上传 + 风格选择
lib/
  runpod.ts         # RunPod 工作流与任务提交
  storage.ts        # 存储抽象（Supabase/Mock）
  db.ts             # 数据库连接
  upload-validation.ts  # 文件校验
```

## 文件校验规则

- 支持格式: JPEG、PNG、WebP
- 大小限制: 10MB
- 前后端双层校验

## 错误码

- `INVALID_PAYLOAD` - 请求参数无效
- `UNSUPPORTED_CONTENT_TYPE` - 不支持的文件类型
- `FILE_TOO_LARGE` - 文件超过大小限制
- `INVALID_IMAGE_URL` - 图片 URL 无效
- `OBJECT_NOT_FOUND` - 存储对象不存在

## 命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | 运行 ESLint |

## License

MIT
