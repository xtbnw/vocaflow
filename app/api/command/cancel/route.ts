import { NextRequest, NextResponse } from "next/server";
import { serverAgentRunner } from "@/backend/app/serverAgentRuntime";
import { parseHistory } from "@/backend/app/serverApiHelpers";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return invalidRequest();
  }
  if (typeof body.pendingActionId !== "string") {
    return invalidRequest();
  }

  const result = serverAgentRunner.cancelPendingAction(
    body.pendingActionId,
    parseHistory(body.messages),
  );
  return NextResponse.json(result);
}

function invalidRequest() {
  return NextResponse.json(
    { kind: "error", message: "请求格式无效" },
    { status: 400 },
  );
}
