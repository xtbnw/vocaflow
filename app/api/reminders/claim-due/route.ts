import { NextResponse } from "next/server";
import { serverDeepAgentsRuntime } from "@/backend/bootstrap/serverDeepAgentsRuntime";

export async function POST() {
  try {
    const now = new Date().toISOString();
    const reminders = await serverDeepAgentsRuntime.claimDueReminders(now);
    return NextResponse.json({ reminders });
  } catch {
    return NextResponse.json(
      { error: "Failed to claim due reminders" },
      { status: 500 },
    );
  }
}
