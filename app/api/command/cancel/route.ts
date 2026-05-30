import { NextRequest, NextResponse } from "next/server";
import { serverAgentRunner } from "@/backend/bootstrap/serverAgentRuntime";
import { sessionStore } from "@/backend/app/sessionStore";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return invalidRequest();
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const pendingActionId = typeof body.pendingActionId === "string" ? body.pendingActionId : "";
  if (!sessionId || !pendingActionId) {
    return invalidRequest();
  }

  if (!sessionStore.validatePendingAction(sessionId, pendingActionId)) {
    return NextResponse.json(
      { kind: "error", message: "操作已过期或不属于当前会话" },
      { status: 400 },
    );
  }

  const history = sessionStore.getMessages(sessionId);
  const result = serverAgentRunner.cancelPendingAction(pendingActionId, history);

  sessionStore.removePendingAction(sessionId, pendingActionId);
  serverAgentRunner.removePendingAction(pendingActionId);

  const storedIds = new Set(history.map((m) => m.id));
  for (const msg of result.messages) {
    if (!storedIds.has(msg.id)) {
      sessionStore.addMessage(sessionId, msg);
    }
  }

  return NextResponse.json({
    sessionId,
    messages: result.messages,
    eventsChanged: result.eventsChanged,
  });
}

function invalidRequest() {
  return NextResponse.json({ kind: "error", message: "请求格式无效" }, { status: 400 });
}
