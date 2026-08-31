import { NextResponse } from "next/server";
import { checkNeonConnection } from "@/lib/neon/connection";

export async function GET() {
  const status = await checkNeonConnection();
  const statusCode = status.connected ? 200 : status.configured ? 502 : 501;
  return NextResponse.json(
    { service: "neon", ...status },
    { status: statusCode }
  );
}
