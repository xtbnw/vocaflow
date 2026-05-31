import { NextRequest, NextResponse } from "next/server";
import { serverDeepAgentsRuntime } from "../../../../backend/bootstrap/serverDeepAgentsRuntime";
import { sseStream, encodeSSE } from "../../../../backend/shared/sseEncoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { kind: "error", message: "请求格式无效" },
      { status: 400 },
    );
  }

  const threadId = typeof body.threadId === "string" && body.threadId.length > 0 ? body.threadId : "";
  if (!threadId) {
    return NextResponse.json(
      { kind: "error", message: "缺少 threadId" },
      { status: 400 },
    );
  }

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { kind: "error", message: "decision 必须是 approve 或 reject" },
      { status: 400 },
    );
  }

  try {
    const events = serverDeepAgentsRuntime.resume(
      { decision },
      threadId,
      request.signal,
    );
    const bodyStream = sseStream(events);

    return new NextResponse(bodyStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const event = {
      type: "error",
      code: "STREAM_ERROR",
      message: err instanceof Error ? err.message : String(err),
    } as const;
    const body = encodeSSE(event);
    return new NextResponse(body, {
      status: 500,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
    },
  });
}
