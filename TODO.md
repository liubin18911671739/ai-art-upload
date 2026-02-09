# TODO - AI Art Upload

> 最后更新：2026-02-09（基于当前代码与命令验证）

## 现状结论

- 已打通最小闭环：上传 -> 提交 RunPod -> 回调写库 -> 前端轮询展示结果
- 已具备 Shopify webhook 验签与幂等处理
- `pnpm lint` 通过（2 条 warning）
- Google Fonts 依赖已移除

## 已完成

### 基础框架

- [x] Next.js 16 + React 19 + TypeScript 初始化
- [x] Tailwind CSS + shadcn/ui 集成（约 50 个 UI 组件）
- [x] 深色主题变量与基础布局
- [x] ESLint 配置（Flat Config）

### 页面交互

- [x] 拖拽/点击上传入口
- [x] 上传进度与任务状态反馈
- [x] 风格选择卡片（素描 / 水彩 / 油画）
- [x] 基础响应式布局

## P0（必须先完成，形成可用闭环）

- [x] 设计并实现最小后端接口：`POST /api/transform`
- [x] 确定 AI 服务提供商与调用策略（同步/异步）
- [x] 增加文件校验（类型、大小、异常输入）
- [x] 将“模拟进度”替换为真实任务状态
- [x] 增加结果展示区域（原图、结果图、失败态）
- [x] 增加结果下载能力

## P1（体验增强）

- [ ] 结果对比组件（滑块或并排视图）
- [ ] 处理过程反馈文案与错误提示优化
- [ ] 历史记录（先本地存储，后续可接数据库）
- [ ] 支持“重新生成/切换风格后重试”

## P2（工程治理与可维护性）

- [x] 去除 `next.config.mjs` 的 `ignoreBuildErrors: true`
- [x] 修正模板残留信息
- [x] `package.json` name: `my-project` -> `ai-art-upload`
- [x] `app/layout.tsx` metadata: `v0 App` -> 真实产品信息
- [x] 处理离线构建问题（本地字体或可选字体策略）
- [ ] 清理重复代码
- [x] 合并 `components/ui/use-mobile.tsx` 与 `hooks/use-mobile.tsx`
- [x] 合并 `components/ui/use-toast.ts` 与 `hooks/use-toast.ts`
- [x] 删除未使用的 `styles/globals.css` 或改为唯一全局样式入口
- [x] 增加 RunPod 回调来源校验（Query Secret）
- [x] 接入 Shopify 订单资产回写（metafields）
- [ ] 接入 Shopify fulfillment 发货流程
- [ ] 增加测试（优先为上传流程与 API 路径补测试）
- [x] 增加 `.env.example` 与配置说明

## 当前阻塞

- [x] AI 提供商策略已确定：RunPod + async-webhook
- [ ] 尚未确定图片存储方案（本地/S3/Supabase/Cloudinary）
- [ ] 尚未定义接口契约（请求字段、错误码、超时策略）

## 建议执行顺序

1. 打通最小链路：上传 -> 变换 -> 返回结果
2. 完成错误处理和结果下载，保证“可用”
3. 再做历史记录、对比视图、测试与重构清理
