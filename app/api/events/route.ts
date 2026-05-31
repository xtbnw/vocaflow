import { NextResponse } from "next/server";
import { serverDeepAgentsRuntime } from "@/backend/bootstrap/serverDeepAgentsRuntime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      events: await serverDeepAgentsRuntime.list(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
