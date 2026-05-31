# VocaFlow
demo视频：https://www.bilibili.com/video/BV1y1VD6DEJv

VocaFlow 是一个 AI 驱动的语音日历助手。用户可以通过文字或语音与日历 Agent 对话，查询、创建和删除日程，并在写操作执行前通过界面确认。

项目采用 Next.js 全栈单体架构：页面、Route Handlers、Agent 运行时和 SQLite 持久层位于同一个 TypeScript 仓库中。语音合成由独立的本地 WebSocket 网关代理，浏览器不会持有上游服务密钥。

## 功能

- 年、月、日三种日历视图，以及日程列表页
- 文字输入和浏览器 Web Speech API 语音识别
- 基于 Deep Agents 的多轮日历 Agent
- 查询、创建、删除日程工具
- 创建和删除操作的确认面板
- SSE 流式回复和工具执行状态展示
- SQLite 日程持久化和 LangGraph checkpoint 会话恢复
- 豆包双向流式 TTS 语音播报
- 播报期间的轻量 VAD 自动打断
- 页面打开期间的应用内提醒和可选浏览器通知

## 技术栈

| 类别 | 技术 |
| --- | --- |
| Web 框架 | Next.js 15、React 19、TypeScript |
| UI | Tailwind CSS v4、shadcn/ui、lucide-react |
| Agent | Deep Agents、LangChain、LangGraph |
| LLM | DeepSeek |
| 数据校验 | Zod |
| 持久化 | better-sqlite3、LangGraph SQLite Checkpoint |
| 语音 | Web Speech API、豆包流式 TTS、WebSocket |
| 测试 | Node.js Test Runner、tsx |

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

在项目根目录创建 `.env.local`：

```bash
DEEPSEEK_API_KEY=

VOLCENGINE_TTS_API_KEY=
VOLCENGINE_TTS_SPEAKER=
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0

NEXT_PUBLIC_VOICE_GATEWAY_URL=ws://localhost:3101
VOICE_GATEWAY_HOST=127.0.0.1
VOICE_GATEWAY_PORT=3101
VOICE_GATEWAY_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# 可选：覆盖默认 SQLite 路径 data/vocaflow.sqlite
VOCAFLOW_SQLITE_PATH=
```

`DEEPSEEK_API_KEY` 用于 Agent 对话。豆包 TTS 配置只影响语音播报；网关未启动或 TTS 配置缺失时，文字日历功能仍可使用。

### 启动应用

分别启动 Web 应用和语音网关：

```bash
npm run dev
```

```bash
npm run voice:gateway
```

访问 [http://localhost:3000](http://localhost:3000)。

## 常用命令

```bash
npm run dev               # 启动 Next.js 开发服务器
npm run voice:gateway     # 启动本地 TTS WebSocket 网关
npm test                  # 运行不访问网络的确定性测试
npm run test:integration  # 运行真实 LLM 集成测试
npm run build             # 生产构建
npm start                 # 启动生产服务
```

交付前至少执行：

```bash
npm test
npm run build
```

## 架构

```text
Browser
  ├─ Calendar UI / schedules page
  ├─ Web Speech API ASR
  ├─ SSE Agent client
  └─ PCM audio playback
          │
          ├─ HTTP / SSE
          ▼
Next.js Route Handlers
  ├─ DeepAgentsRuntime
  │   ├─ query_events / create_event / delete_event
  │   └─ LangGraph SQLite checkpoint
  ├─ SQLiteCalendarRepository
  └─ in-app reminder claim

Browser ── WebSocket ── Voice Gateway ── WebSocket ── Doubao TTS
```

Agent 通过 LangChain 原生工具调用管理日程。查询操作直接执行；创建和删除操作先运行确定性校验与预检查，再通过 LangGraph `interrupt()` 暂停，等待用户在界面确认。SQLite 是日程的唯一数据源。

页面内提醒使用 HTTP 轮询：页面挂载时立即领取一次，之后每 30 秒轮询，并在页面重新可见时再次领取。服务端在 SQLite 事务内原子标记已领取提醒，避免重复触发。当前不提供离线推送。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/events` | 获取全部日程 |
| `POST` | `/api/agent/stream` | 发送消息并接收 SSE Agent 事件 |
| `POST` | `/api/agent/resume` | 提交写操作审批结果并恢复 Agent |
| `DELETE` | `/api/session?id=<threadId>` | 清除指定会话 checkpoint |
| `POST` | `/api/reminders/claim-due` | 原子领取到期提醒 |

## 目录结构

```text
app/                    Next.js 页面、布局和 Route Handlers
backend/
  app/                  日历用例编排
  bootstrap/            服务端依赖装配
  domain/               领域类型和端口
  infrastructure/       Agent、SQLite 等适配器
  shared/               时间、SSE 等共享工具
frontend/
  api/                  客户端 API 封装
  components/           UI 组件
  hooks/                客户端状态和浏览器交互
  infrastructure/       ASR、TTS、VAD、通知适配器
scripts/voice-gateway/  豆包 TTS WebSocket 网关
test/                   确定性测试和真实 LLM 集成测试
```

## 数据文件

运行时数据默认写入 `data/`：

- `data/vocaflow.sqlite`：日程数据
- `data/vocaflow-checkpoints.sqlite`：Agent 会话 checkpoint

## 当前限制

- 语音识别依赖浏览器 `SpeechRecognition`，建议使用 Chrome 或 Edge。
- 提醒仅在页面打开期间生效，不支持 Service Worker、Push API 或离线推送。
- 当前不支持周期日程、外部日历同步和多用户协作。
- TTS 网关是独立进程，未启动时不会影响文字交互。
