import { NextResponse } from "next/server";
import { getCreds, hasCreds } from "@/lib/alpaca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasCreds()) {
    return NextResponse.json({ configured: false });
  }
  try {
    const creds = getCreds();
    return NextResponse.json({
      configured: true,
      paper: creds.isPaper,
      baseUrl: creds.baseUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
