# VocaFlow

VocaFlow 是一个 AI 驱动的语音日历助手项目。当前版本只完成最小可运行展示，用于确认 Next.js 项目骨架、目录边界和占位接口可以正常构建。

## 技术栈

- **框架**: Next.js 15 + React 19
- **语言**: TypeScript
- **样式**: Tailwind CSS v4 + shadcn/ui
- **运行时**: Node.js

## 当前架构

```text
app/        Next.js 页面与 API Route 入口
frontend/   前端组件、Hooks 与样式边界
backend/    应用服务、领域层、基础设施与共享模块边界
```

## 当前 PR 范围

- 项目初始化
- 分层目录搭建
- API 占位接口
- 首页占位

## 尚未实现

- 日程管理
- LLM
- ASR
- Reminder
- Tool Registry

## 快速开始

```bash
npm install
npm run dev
```

访问 http://localhost:3000

## 构建

```bash
npm run build
npm start
```

## 验证

```bash
npm run build
```
