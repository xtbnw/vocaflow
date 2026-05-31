import { NextResponse } from "next/server";
import { serverDeepAgentsRuntime } from "@/backend/bootstrap/serverDeepAgentsRuntime";

export async function GET() {
  return NextResponse.json({
    events: await serverDeepAgentsRuntime.list(),
  });
}
