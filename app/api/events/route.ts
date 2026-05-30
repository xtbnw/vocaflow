import { NextResponse } from "next/server";
import { serverCalendarRepository } from "@/backend/app/serverAgentRuntime";

export async function GET() {
  return NextResponse.json({
    events: await serverCalendarRepository.list(),
  });
}
