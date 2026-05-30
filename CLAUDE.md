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

交付前至少运行 `npm run build`，除非用户明确要求跳过验证。

## 开发流程

所有新功能必须通过 **分支 → 一系列 commit → PR → 合并到 main** 的方式交付，main 分支随时保持可运行状态。

### 分支策略

- 每个功能/修复从 `main` 拉独立分支开发
- 一个分支只做一件事，粒度尽可能小
- 大功能拆分为多个独立 PR 分步提交
- 修改前先查看当前 Git 状态，不覆盖用户已有改动
- commit message 使用英文类型前缀 + 中文描述，例如 `chore: 搭建项目目录结构`

### PR 规范

每个 PR 必须包含以下内容：

1. **标题**：一句话说明本 PR 新增/修改了什么
2. **功能描述**：说明该功能的作用与使用方式
3. **实现思路**：简要说明技术选型或核心实现逻辑
4. **测试方式**：如何验证该功能正常运行

PR 合并后 main 分支代码需保持可运行，随时可复现演示效果。

## 项目架构

VocaFlow 是一个 AI 驱动的语音日历助手，采用 **Next.js 15 App Router 全栈单体架构**。

### 当前结构

```
app/                     # Next.js App Router 页面和路由
  layout.tsx             # 根布局 (Geist 字体, lang="zh-CN")
  globals.css            # Tailwind v4 + shadcn/ui CSS 变量 + vf-* 自定义动画/样式
  page.tsx               # 首页 — 日历主视图 (年/月/日三视图 + 滚轮选择器)
  schedules/page.tsx     # 日程列表页
  api/command/route.ts   # POST 占位, 返回 not_implemented
frontend/
  components/
    AppFrame.tsx          # 应用壳: 侧边导航 + 顶部移动端导航 + VoiceCommandBar
    VoiceCommandBar.tsx   # 底部语音/文字输入栏
    calendar/
      buildMonthGrid.ts   # 月历网格计算 (42-cell, 附带 isCurrentMonth/isToday)
backend/
  domain/
    calendarTypes.ts      # Zod schema + TS 类型 (CalendarEvent, ParsedCommand 等)
    calendarRepository.ts # CalendarRepository 接口定义
  infrastructure/
    persistence/
      localStorageCalendarRepository.ts  # localStorage 实现
lib/
  utils.ts                # cn() (clsx + tailwind-merge)
components.json           # shadcn/ui 配置: new-york 风格, neutral 色系, lucide 图标
```

### 要点

- **全客户端渲染**: 当前页面均为 `"use client"`, 数据流通过 props 和 local state 管理
- **自定义 CSS 类**: `vf-shell`, `vf-glass`, `vf-voice-bar`, `vf-wheel-mask` 等 `vf-*` 前缀类定义在 `globals.css`
- **日历视图逻辑内聚在 `app/page.tsx`**: MonthView / DayView / YearView / WheelPicker / ViewPanel 均为同一文件内的私有组件, 状态由 `useState` 在顶层管理
- **领域层已就绪**: `calendarTypes.ts` 使用 Zod discriminatedUnion 定义 ParsedCommand (create_event / query_events / find_events_for_delete / unknown), CalendarRepository 接口已定义并在 localStorage 中落地
- **shadcn/ui 组件暂未使用**: `components.json` 指向 `@/components/ui` 但实际 UI 组件放在 `frontend/components/`, 尚未通过 CLI 添加 shadcn 组件

### 路径别名 (`tsconfig.json`)

| Alias | 映射 |
|--------|------|
| `@/*` | 项目根目录 |
| `@/frontend/*` | `frontend/*` |
| `@/backend/*` | `backend/*` |
| `@/shared/*` | `backend/shared/*` |

`components.json` 还声明了 `@/components` → `components/` 和 `@/hooks` → `hooks/`, 但实际开发中组件放在 `frontend/components/` 下。

### 核心架构原则

**分层**: 业务逻辑写在 `backend/domain/` 和 `backend/infrastructure/`, UI 组件写在 `frontend/components/`, 不在 `app/page.tsx` 中写业务逻辑。

**外部能力用 Provider/Adapter 封装**: 存储 (Repository 接口 → localStorage 实现), LLM (LLMProvider), 语音 (ASRProvider)。

**API 入口**: `app/api/command/route.ts` 当前为占位实现, 返回 `{ status: "not_implemented" }`。

**页面保持简约**: 不添加无关文案、装饰或交互。

### 关键依赖

| 类别 | 库 |
|------|---|
| 框架 | Next.js 15, React 19 |
| 样式 | Tailwind CSS v4, shadcn/ui (new-york) |
| 数据校验 | Zod v4 |
| 图标 | lucide-react |

### 设计文档

`docs/需求设计/` 目录包含项目背景、功能范围、技术架构决策、数据模型、核心业务流程等设计文档（已 gitignore，本地参考）。
