import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/backend/app/sessionStore";
import { serverAgentRunner } from "@/backend/bootstrap/serverAgentRuntime";

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");

  if (!sessionId) {
    return NextResponse.json(
      { kind: "error", message: "缺少 sessionId" },
      { status: 400 },
    );
  }

  const pendingActionIds = sessionStore.deleteSession(sessionId);
  for (const id of pendingActionIds) {
    serverAgentRunner.removePendingAction(id);
  }

  return NextResponse.json({ kind: "ok" });
}
