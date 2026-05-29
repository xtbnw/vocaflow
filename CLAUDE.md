# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev       # 启动开发服务器 (localhost:3000)
npm run build     # 生产构建
npm start         # 启动生产服务
npm run lint      # ESLint 检查
```

尚无测试，后续添加后在此补充测试命令。

## 开发流程

所有新功能必须通过 **分支 → 一系列 commit → PR → 合并到 main** 的方式交付，main 分支随时保持可运行状态。

### 分支策略

- 每个功能/修复从 `main` 拉独立分支开发
- 一个分支只做一件事，粒度尽可能小
- 大功能拆分为多个独立 PR 分步提交

### PR 规范

每个 PR 必须包含以下内容：

1. **标题**：一句话说明本 PR 新增/修改了什么
2. **功能描述**：说明该功能的作用与使用方式
3. **实现思路**：简要说明技术选型或核心实现逻辑
4. **测试方式**：如何验证该功能正常运行

PR 合并后 main 分支代码需保持可运行，随时可复现演示效果。

## 项目架构

VocaFlow 是一个 AI 驱动的语音日历助手，采用 **Next.js 15 App Router 全栈单体架构**。

### 当前结构（初始骨架）

```
app/                # Next.js App Router 页面和路由
  layout.tsx        # 根布局 (Geist 字体, 中文 lang)
  page.tsx          # 首页
  globals.css       # Tailwind v4 + shadcn/ui CSS 变量主题 (light/dark)
lib/
  utils.ts          # cn() 工具函数 (clsx + tailwind-merge)
components.json     # shadcn/ui 配置: new-york 风格, neutral 色系, iconLibrary: lucide
public/             # 静态资源 (manifest.json)
```

### 路径别名

`@/*` → 项目根目录 (`tsconfig.json` paths)

### 核心架构原则（来自技术决策文档）

后续模块扩展按以下分层组织，目前尚未拆分：

```
backend/
  app/              # 应用入口、接口路由适配、配置、服务编排
  domain/           # 核心业务实体和逻辑
  infrastructure/   # 外部能力接入 (LLM, 存储, 语音, 通知)
  shared/           # 共享类型、schema、常量、工具函数
frontend/
  components/       # UI 组件库
```

- **业务逻辑不写在 UI 组件里**，所有外部能力用 Provider / Adapter 模式封装
- API 入口: `app/api/command/route.ts` (待创建)
- 存储: 初期 localStorage + Repository 抽象，后续可切 IndexedDB / SQLite / PostgreSQL
- LLM: 自封装 LLMProvider，支持 DeepSeek / OpenAI / 通义千问 / Gemini 切换
- 语音: Web Speech API + ASRProvider 抽象

### 关键依赖

| 类别 | 库 |
|------|---|
| 框架 | Next.js 15, React 19 |
| 样式 | Tailwind CSS v4, shadcn/ui (new-york) |
| AI/语音 | 无 (待引入) |
| 日历 | FullCalendar React (待引入) |

### 设计文档

`docs/需求设计/` 目录包含项目背景、功能范围、技术架构决策、数据模型、核心业务流程等设计文档（已 gitignore，本地参考）。
