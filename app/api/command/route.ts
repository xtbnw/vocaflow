import { NextRequest, NextResponse } from "next/server";
import { serverAgentRunner } from "@/backend/app/serverAgentRuntime";
import {
  createParserContext,
  parseHistory,
} from "@/backend/app/serverApiHelpers";
import {
  UserMessageSchema,
} from "@/backend/domain/sessionTypes";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  if (!body || typeof body !== "object") return invalidRequest();

  const { message, messages } = body as Record<string, unknown>;
  const parsedMessage = UserMessageSchema.safeParse(message);
  if (!parsedMessage.success || !parsedMessage.data.text.trim()) {
    return NextResponse.json(
      { kind: "error", message: "请输入内容" },
      { status: 400 },
    );
  }

  const result = await serverAgentRunner.runUserMessage(
    parsedMessage.data,
    createParserContext(),
    parseHistory(messages),
  );

  return NextResponse.json(result);
}

function invalidRequest() {
  return NextResponse.json(
    { kind: "error", message: "请求格式无效" },
    { status: 400 },
  );
}
