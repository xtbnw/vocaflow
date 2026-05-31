import { NextRequest, NextResponse } from "next/server";
import { serverDeepAgentsRuntime } from "@/backend/bootstrap/serverDeepAgentsRuntime";

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("id");

  if (!threadId) {
    return NextResponse.json(
      { kind: "error", message: "缺少 threadId" },
      { status: 400 },
    );
  }

  await serverDeepAgentsRuntime.deleteThread(threadId);

  return NextResponse.json({ kind: "ok" });
}
