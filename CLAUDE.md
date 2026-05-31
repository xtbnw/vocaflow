# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev          # 启动开发服务器 (localhost:3000)
npm run voice:gateway # 启动语音 TTS 网关 (localhost:3101)
npm run build        # 生产构建
npm start            # 启动生产服务
npm run lint         # ESLint 检查
```

开发时需要分别启动 `npm run dev` 和 `npm run voice:gateway`。语音网关不可用时，文字日历功能仍可正常使用。

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

### Agent 运行时架构

**Deep Agents + LangGraph Checkpoint**:
- 运行时由 `DeepAgentsRuntime`（`backend/infrastructure/agent/deepAgentsRuntime.ts`）实现 `AgentRuntime` 端口（`backend/domain/agentRuntime.ts`）
- 基于 `deepagents` 包的 `createDeepAgent()` 创建 ReAct 多步推理 Agent
- 使用 `@langchain/langgraph-checkpoint-sqlite` 的 `SqliteSaver` 持久化 thread 状态（存储在 `data/vocaflow-checkpoints.sqlite`）
- 写操作（create_event / delete_event）通过 `interrupt()` 机制暂停执行，等待前端审批
- 写操作刻意在工具内部调用 LangGraph `interrupt()`，而非使用 Deep Agents `interruptOn`：审批前需要执行无副作用的冲突检查并生成领域 `ActionPreview`
- 服务器重启后可通过同一 checkpoint DB 恢复 thread 状态

**SSE 流式协议**:
- `POST /api/agent/stream` — 发送用户消息，返回 SSE 流
- `POST /api/agent/resume` — 提交审批决策（approve/reject），恢复暂停的 Agent 执行
- SSE 事件类型: `thread`, `message_delta`, `tool_started`, `tool_finished`, `tool_error`, `interrupt`, `events_changed`, `done`, `error`
- `encodeSSE()` / `sseStream()`（`backend/shared/sseEncoder.ts`）负责 SSE 编码与 ReadableStream 转换
- `agentClient.ts`（`frontend/api/agentClient.ts`）封装客户端 SSE 读取与事件回调

**threadId 会话模型**:
- 客户端持有 `threadId`，服务端通过 `SqliteSaver` 管理对话状态
- 同一 `threadId` 的多次请求共享上下文（checkpoint 自动恢复历史消息）
- `DELETE /api/session?id=<threadId>` 清除指定 thread 的 checkpoint
- 前端 `useAgentSession` Hook 管理 `threadId` 生命周期与流式状态聚合

**工具动作流式展示**:
- 工具调用通过 SSE `tool_started` / `tool_finished` / `tool_error` 事件实时通知前端
- `isCalendarTool()` 过滤 calendar 业务工具，排除 Deep Agents 内置 internal/subagent 工具
- `ToolActivity` 状态机: running → completed | failed
- 写操作成功执行后发送 `events_changed` 事件，通知前端刷新日程列表

**懒加载 DI 装配**:
- `serverDeepAgentsRuntime`（`backend/bootstrap/serverDeepAgentsRuntime.ts`）全局单例
- 测试用 `__overrideRuntimeForTest()` / `__overrideRepositoryForTest()` / `__resetForTest()` 替换实现

### 首版限制

- 未启用 Tavily search（Deep Agents 默认 StateBackend 保持隔离）
- 未启用 sandbox、shell 或宿主文件系统访问
- 未启用自定义 subagent（使用 Deep Agents 内置 general-purpose subagent，仅共享业务工具集）
- 首版关闭 DeepSeek thinking mode（`DEFAULT_LLM_CONFIG.modelKwargs.thinking.type = "disabled"`）
- 后续根据任务复杂度、token 消耗和维护成本评估是否降级为 LangChain `createAgent()`

### 语音交互架构

**ASR（语音识别）**: 首版使用浏览器原生 `SpeechRecognition` API（`frontend/infrastructure/asr/`），不上报音频数据到服务端。仅 Chrome/Edge 等 Chromium 内核浏览器可用。

**TTS（语音合成）**: 豆包双向流式 TTS API（`seed-tts-2.0-standard`）通过独立 Node WebSocket 网关代理（`scripts/voice-gateway/`），浏览器不持有 API 密钥。网关启动后监听 `VOICE_GATEWAY_HOST:VOICE_GATEWAY_PORT`，浏览器通过 `NEXT_PUBLIC_VOICE_GATEWAY_URL` 连接。

**播报策略**: 仅 `source === "voice"` 的提交触发 TTS 播报；键盘输入保持安静。进入写操作审批时，语音轮次只播报固定短提示"操作已准备好，请在界面确认。"，不朗读完整审批预览，不增加语音审批指令。

**VAD 自动打断**: 首版轻量启发式 VAD（`frontend/infrastructure/vad/`）基于 RMS 能量阈值，播报期间默认开启。提供 UI 开关（通过 localStorage 持久化），关闭后需点击麦克风手动打断。点击麦克风打断始终可用，作为稳定兜底。VAD 权限失败自动降级为仅手动模式。

### 当前结构

```
app/                     # Next.js App Router 页面和路由
  layout.tsx             # 根布局 (Geist 字体, lang="zh-CN")
  providers.tsx          # 客户端 Provider 包装 (CalendarEventsContext)
  globals.css            # Tailwind v4 + shadcn/ui CSS 变量 + vf-* 自定义动画/样式
  page.tsx               # 首页 — 日历主视图 (年/月/日三视图 + 滚轮选择器)
  schedules/page.tsx     # 日程列表页 (展示 SQLite 中的真实数据)
  api/
    agent/
      stream/route.ts    # POST — SSE 流式 Agent 对话入口
      resume/route.ts    # POST — 提交审批决策恢复 Agent 执行
    session/route.ts     # DELETE — 清除指定 thread 的 checkpoint
    events/route.ts      # GET — 获取所有日程
frontend/
  api/
    agentClient.ts       # Agent API 客户端 SSE 封装
  hooks/
    useAgentSession.ts   # threadId 生命周期 + 流式状态聚合 + TTS 审批提示
    useVoiceInput.ts     # 语音输入 Hook (ASR + 自动提交)
    useCalendarEvents.tsx # 日历事件共享 Context + Hook
    voiceAutoSubmitController.ts # 语音 final 防抖 800ms 自动提交控制器
  infrastructure/
    asr/                 # 浏览器 ASR (Web Speech API)
    tts/                 # 客户端 TTS (WebSocket → PCM 播放)
      ttsController.ts   # TTS session 生命周期管理
      pcmPlayer.ts       # Web Audio PCM 播放队列
      voiceGatewayProtocol.ts # 浏览器-网关 JSON 协议
    vad/                 # 轻量 VAD 检测与打断
      vadDetector.ts     # RMS 能量阈值 + VAD 决策逻辑
      vadController.ts   # 浏览器 VAD 生命周期 (getUserMedia)
      bargeIn.ts         # 打断编排 (cancelTts → abortSse → startAsr)
  components/
    AppFrame.tsx          # 应用壳: 侧边导航 + 顶部移动端导航 + VoiceCommandBar
    VoiceCommandBar.tsx   # 底部语音/文字输入栏 (展示与事件绑定)
    ActionPreviewPanel.tsx # 待确认操作预览面板
    calendar/
      buildMonthGrid.ts   # 月历网格计算 (42-cell, 附带 isCurrentMonth/isToday)
backend/
  bootstrap/
    serverDeepAgentsRuntime.ts # 懒加载单例 DI 装配
  app/
    calendarToolHandlers.ts # 日历 CRUD Handler (create/query/delete)
    types/
      pendingAction.ts    # PendingAction, ActionPreview
  domain/
    agentRuntime.ts       # AgentRuntime 接口 + AgentStreamEvent 协议
    calendarTypes.ts      # Zod schema + TS 类型 (CalendarEvent 等)
    calendarRepository.ts # CalendarRepository 接口
    sessionTypes.ts       # Session, SessionMessage 类型
    asrProvider.ts        # ASRProvider 接口
  infrastructure/
    agent/
      deepAgentsRuntime.ts  # Deep Agents 运行时 + classifyStreamError
      calendarWriteTools.ts  # create_event / delete_event 工具（含 interrupt 审批）
    persistence/
      sqliteCalendarRepository.ts  # SQLite 实现 (better-sqlite3)
  shared/
    timeUtils.ts          # 共享时间工具 (基于 epoch 毫秒比较)
    sseEncoder.ts         # SSE 编码与 ReadableStream 转换
scripts/
  voice-gateway/          # 豆包双向流式 TTS WebSocket 网关 (独立 Node 进程)
    server.ts             # 网关入口 + WebSocket 服务器
    doubaoProtocol.ts     # 豆包二进制协议帧编码/解码
    sessionStateMachine.ts # 单活跃 session 状态机
    gatewayConfig.ts      # 网关配置解析
    abortSocket.ts        # 安全 WebSocket 中止
test/                     # 测试文件 (tsx + node:test)
  scripts/voice-gateway/  # 网关协议 + 状态机测试
  frontend/               # 前端 TTS/VAD/自动提交测试
  backend/                # 后端 Agent/API 测试
lib/
  utils.ts                # cn() (clsx + tailwind-merge)
components.json           # shadcn/ui 配置: new-york 风格, neutral 色系, lucide 图标
```

### 要点

- **全客户端渲染**: 页面使用 `"use client"`, 数据通过 React hooks 和 Context 管理
- **Deep Agents 运行时**: 基于 `deepagents` 包的 `createDeepAgent()` 实现 ReAct 多步推理
- **threadId 会话模型**: 客户端持有 `threadId`，服务端通过 `SqliteSaver` 管理对话状态，同一 threadId 共享上下文
- **SSE 流式协议**: `POST /api/agent/stream` 发起对话，`POST /api/agent/resume` 提交审批，事件类型含 `thread`, `message_delta`, `tool_started`, `tool_finished`, `tool_error`, `interrupt`, `events_changed`, `done`, `error`
- **写操作审批**: create_event / delete_event 通过 `interrupt()` 暂停执行，等待前端 approve/reject
- **SQLite 是日程唯一数据源**: `SQLiteCalendarRepository` 通过 better-sqlite3 持久化
- **浏览器 ASR 位于前端**: `frontend/infrastructure/asr/` 包含 Web Speech API 实现
- **时间比较使用 epoch 毫秒**: `backend/shared/timeUtils.ts` 统一处理，避免 ISO 字符串比较
- **自定义 CSS 类**: `vf-shell`, `vf-glass`, `vf-voice-bar`, `vf-wheel-mask` 等 `vf-*` 前缀类定义在 `globals.css`
- **日历视图逻辑内聚在 `app/page.tsx`**: MonthView / DayView / YearView / WheelPicker / ViewPanel 均为同一文件内的私有组件
- **ASR 为浏览器 SpeechRecognition**: 仅 Chrome/Edge 等 Chromium 内核浏览器可用，不上报音频数据
- **豆包 TTS 通过独立网关代理**: 浏览器不持有 API 密钥，密钥仅配置在网关端
- **仅语音发起轮次播报**: 键盘输入保持安静，写操作审批时只播报固定短提示
- **VAD 自动打断为可关闭的首版启发式能力**: 基于 RMS 能量阈值，点击麦克风打断始终可用
- **语音网关不可用不影响文字日历**: TTS 和 Agent 独立运行，网关关闭后文字功能仍可用

### 路径别名 (`tsconfig.json`)

| Alias | 映射 |
|--------|------|
| `@/*` | 项目根目录 |
| `@/frontend/*` | `frontend/*` |
| `@/backend/*` | `backend/*` |
| `@/shared/*` | `backend/shared/*` |

### 核心架构原则

**分层**: 领域接口/类型在 `backend/domain/`, 应用编排在 `backend/app/`, 基础设施实现在 `backend/infrastructure/`, UI 组件在 `frontend/components/`, DI 装配在 `backend/bootstrap/`。

**外部能力用 Provider/Adapter 封装**: 存储 (Repository 接口 → SQLite 实现), 语音 (ASRProvider → Web Speech API), Agent 运行时 (AgentRuntime 接口 → DeepAgentsRuntime)。

**端口与适配器**: `backend/domain/agentRuntime.ts` 定义 AgentRuntime 接口，由 `backend/infrastructure/agent/deepAgentsRuntime.ts` 实现。

**API 契约**: 客户端通过 SSE 流与 Agent 交互 — `POST /api/agent/stream` 发送消息并接收 `AgentStreamEvent` 流，`POST /api/agent/resume` 提交审批决策并接收后续事件流。

**Agent Decision**: 模型通过 LangChain 原生 tool calling 决定调用业务工具或直接回复自然语言。后端负责 schema 校验、写操作 interrupt 审批、checkpoint 持久化和错误分类。

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
