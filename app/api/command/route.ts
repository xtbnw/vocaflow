import { NextRequest, NextResponse } from "next/server";
import { CommandOrchestrator } from "@/backend/app/commandOrchestrator";
import { LLMCommandParser } from "@/backend/infrastructure/parser/llmCommandParser";
import { getLLMProvider } from "@/backend/infrastructure/llm/llmProviderFactory";
import { createDefaultToolRegistry } from "@/backend/domain/toolRegistry";
import { SessionMessageSchema } from "@/backend/domain/sessionTypes";
import type { SessionMessage } from "@/backend/domain/sessionTypes";

const llm = getLLMProvider();
const parser = new LLMCommandParser(llm);
const registry = createDefaultToolRegistry();
const orchestrator = new CommandOrchestrator(llm, parser, registry);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { kind: "error", message: "请求格式无效" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { kind: "error", message: "请求格式无效" },
      { status: 400 },
    );
  }

  const { text, messages } = body as Record<string, unknown>;

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { kind: "error", message: "请输入内容" },
      { status: 400 },
    );
  }

  let history: SessionMessage[] = [];
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const parsed = SessionMessageSchema.safeParse(msg);
      if (!parsed.success) continue;
      history.push(parsed.data as SessionMessage);
    }
  }

  const now = new Date();
  const context = {
    currentTime: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const result = await orchestrator.process(text.trim(), context, history);
  return NextResponse.json(result);
}
