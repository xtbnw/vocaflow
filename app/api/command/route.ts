import { NextRequest, NextResponse } from "next/server";
import { serverAgentRunner } from "@/backend/bootstrap/serverAgentRuntime";
import { createParserContext } from "@/backend/app/serverApiHelpers";
import { makeUserMessage } from "@/backend/app/sessionManager";
import { sessionStore } from "@/backend/app/sessionStore";
import type { SessionMessage } from "@/backend/domain/sessionTypes";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return invalidRequest();
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ kind: "error", message: "请输入内容" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  const { session, isNew } = sessionStore.getOrCreate(sessionId);

  const userMsg = makeUserMessage(text);
  sessionStore.addMessage(session.id, userMsg);

  const priorHistory = sessionStore.getMessages(session.id).slice(0, -1);

  const result = await serverAgentRunner.runUserMessage(
    userMsg,
    createParserContext(),
    priorHistory,
  );

  const storedIds = new Set(priorHistory.map((m) => m.id));
  for (const msg of result.messages) {
    if (!storedIds.has(msg.id)) {
      sessionStore.addMessage(session.id, msg);
    }
  }

  if (result.pendingAction) {
    sessionStore.bindPendingAction(session.id, result.pendingAction.id);
  }

  return NextResponse.json({
    sessionId: session.id,
    messages: result.messages,
    pendingAction: result.pendingAction ?? undefined,
    eventsChanged: result.eventsChanged,
  });
}

function invalidRequest() {
  return NextResponse.json({ kind: "error", message: "请求格式无效" }, { status: 400 });
}
