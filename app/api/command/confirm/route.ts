import { NextRequest, NextResponse } from "next/server";
import { serverAgentRunner } from "@/backend/bootstrap/serverAgentRuntime";
import { createParserContext } from "@/backend/app/serverApiHelpers";
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
  const result = await serverAgentRunner.confirmPendingAction(
    pendingActionId,
    createParserContext(),
    history,
  );

  sessionStore.removePendingAction(sessionId, pendingActionId);

  const storedIds = new Set(history.map((m) => m.id));
  for (const msg of result.messages) {
    if (!storedIds.has(msg.id)) {
      sessionStore.addMessage(sessionId, msg);
    }
  }

  if (result.pendingAction) {
    sessionStore.bindPendingAction(sessionId, result.pendingAction.id);
  }

  return NextResponse.json({
    sessionId,
    messages: result.messages,
    pendingAction: result.pendingAction ?? undefined,
    eventsChanged: result.eventsChanged,
  });
}

function invalidRequest() {
  return NextResponse.json({ kind: "error", message: "请求格式无效" }, { status: 400 });
}
