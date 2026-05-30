# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev       # 启动开发服务器 (localhost:3000)
npm run build     # 生产构建
npm start         # 启动生产服务
npm run lint      # ESLint 检查
```

```bash
npm test              # 运行确定性单元测试 (不访问网络, tsx + node:test)
npm run test:integration  # 运行真实 LLM 集成测试 (需要 DEEPSEEK_API_KEY)
```

交付前至少运行 `npm test && npm run build`，除非用户明确要求跳过验证。

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
  providers.tsx          # 客户端 Provider 包装 (CalendarEventsContext)
  globals.css            # Tailwind v4 + shadcn/ui CSS 变量 + vf-* 自定义动画/样式
  page.tsx               # 首页 — 日历主视图 (年/月/日三视图 + 滚轮选择器)
  schedules/page.tsx     # 日程列表页 (展示 SQLite 中的真实数据)
  api/
    command/route.ts     # POST — 文本/语音指令入口 (sessionId + text)
    command/confirm/     # POST — 确认待处理操作 (sessionId + pendingActionId)
    command/cancel/      # POST — 取消待处理操作 (sessionId + pendingActionId)
    session/route.ts     # DELETE — 清除服务端 Session
    events/route.ts      # GET — 获取所有日程
frontend/
  api/
    agentClient.ts       # Agent API 客户端封装
  hooks/
    useAgentSession.ts   # Session 状态管理 Hook
    useVoiceInput.ts     # 语音输入 Hook
    useCalendarEvents.tsx # 日历事件共享 Context + Hook
  infrastructure/asr/    # 浏览器 ASR (Web Speech API)
    webSpeechASRProvider.ts
    noopASRProvider.ts
    asrProviderFactory.ts
    speechRecognition.d.ts
  components/
    AppFrame.tsx          # 应用壳: 侧边导航 + 顶部移动端导航 + VoiceCommandBar
    VoiceCommandBar.tsx   # 底部语音/文字输入栏 (展示与事件绑定)
    ActionPreviewPanel.tsx # 待确认操作预览面板
    calendar/
      buildMonthGrid.ts   # 月历网格计算 (42-cell, 附带 isCurrentMonth/isToday)
backend/
  bootstrap/
    serverAgentRuntime.ts # 懒加载单例 DI 装配 (AgentRunner + Repository)
  app/
    agentRunner.ts        # Agent Loop (ReAct 多步推理)
    commandOrchestrator.ts # 编排 LLM 解析 + 校验 + 错误归因
    toolExecutor.ts       # Hook 管线 + 工具执行
    calendarToolHandlers.ts # 日历 CRUD Handler (create/query/delete)
    toolResultPresenter.ts  # 工具执行结果展示文案
    writeActionPreviewHook.ts # 写操作拦截 → 冲突检测 → PendingAction
    sessionManager.ts     # Session / Message 工厂函数
    sessionStore.ts       # 服务端内存 Session Store
    serverApiHelpers.ts   # createParserContext
    parserUtils.ts       # extractJson, describeSchemaForPrompt (通用解析工具)
    ports/
      commandParser.ts    # CommandParser 接口 (ParserContext)
    types/
      pendingAction.ts    # PendingAction, ActionPreview
      toolExecutionResult.ts # ToolExecutionResult
  domain/
    calendarTypes.ts      # Zod schema + TS 类型 (CalendarEvent 等)
    calendarRepository.ts # CalendarRepository 接口
    toolRegistry.ts       # ToolRegistry 类 + ToolDescriptor 接口
    sessionTypes.ts       # Session, SessionMessage 类型
    commandTypes.ts       # ParseResult discriminated union
    llmProvider.ts        # LLMProvider 接口
    asrProvider.ts        # ASRProvider 接口
    beforeToolExecuteHook.ts # BeforeToolExecuteHook 接口
  infrastructure/
    persistence/
      sqliteCalendarRepository.ts  # SQLite 实现 (better-sqlite3)
    llm/
      deepseekProvider.ts          # DeepSeek API 实现
      mockLLMProvider.ts           # Mock provider (dev/test)
      llmProviderFactory.ts        # LLM provider 工厂
    parser/
      llmCommandParser.ts          # LLM 驱动的命令解析
  shared/
    timeUtils.ts          # 共享时间工具 (基于 epoch 毫秒比较)
lib/
  utils.ts                # cn() (clsx + tailwind-merge)
components.json           # shadcn/ui 配置: new-york 风格, neutral 色系, lucide 图标
```

### 要点

- **全客户端渲染**: 页面使用 `"use client"`, 数据通过 React hooks 和 Context 管理
- **后端 Agent Loop**: 文本/语音输入统一转为 user message，后端执行 ReAct 多步推理
- **Session 由后端持有**: 客户端仅持有 `sessionId`，不发送完整对话历史
- **PendingAction 绑定 Session**: 跨 Session 确认会被拒绝
- **SQLite 是日程唯一数据源**: `SQLiteCalendarRepository` 通过 better-sqlite3 持久化
- **浏览器 ASR 位于前端**: `frontend/infrastructure/asr/` 包含 Web Speech API 实现
- **时间比较使用 epoch 毫秒**: `backend/shared/timeUtils.ts` 统一处理，避免 ISO 字符串比较
- **自定义 CSS 类**: `vf-shell`, `vf-glass`, `vf-voice-bar`, `vf-wheel-mask` 等 `vf-*` 前缀类定义在 `globals.css`
- **日历视图逻辑内聚在 `app/page.tsx`**: MonthView / DayView / YearView / WheelPicker / ViewPanel 均为同一文件内的私有组件

### 路径别名 (`tsconfig.json`)

| Alias | 映射 |
|--------|------|
| `@/*` | 项目根目录 |
| `@/frontend/*` | `frontend/*` |
| `@/backend/*` | `backend/*` |
| `@/shared/*` | `backend/shared/*` |

### 核心架构原则

**分层**: 领域接口/类型在 `backend/domain/`, 应用编排在 `backend/app/`, 基础设施实现在 `backend/infrastructure/`, UI 组件在 `frontend/components/`, DI 装配在 `backend/bootstrap/`。

**外部能力用 Provider/Adapter 封装**: 存储 (Repository 接口 → SQLite 实现), LLM (LLMProvider → DeepSeek/Mock), 语音 (ASRProvider → Web Speech API)。

**端口与适配器**: `backend/app/ports/commandParser.ts` 定义 Parser 接口，由 `backend/infrastructure/parser/llmCommandParser.ts` 实现。

**API 契约**: 客户端发送 `{ sessionId?, text }` → 服务端返回 `{ sessionId, messages, pendingAction?, eventsChanged }`。

**Agent Decision 协议**: 模型输出仅两种类型 — `tool_call` (调用工具) 和 `message` (自然语言回复)。模型自主决定追问、闲聊、失败说明和完成总结，后端负责 Tool schema 校验、PendingAction、冲突检查、删除前查询和 Loop 上限。

**页面保持简约**: 不添加无关文案、装饰或交互。

### 关键依赖

| 类别 | 库 |
|------|---|
| 框架 | Next.js 15, React 19 |
| 样式 | Tailwind CSS v4, shadcn/ui (new-york) |
| 数据校验 | Zod v4 |
| 图标 | lucide-react |
| 数据库 | better-sqlite3 |

### 设计文档

`docs/需求设计/` 目录包含项目背景、功能范围、技术架构决策、数据模型、核心业务流程等设计文档（已 gitignore，本地参考）。
